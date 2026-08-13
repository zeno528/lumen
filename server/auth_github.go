package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ── PKCE + state 会话存储（内存，不过期） ──────────────

type oauthState struct {
	codeVerifier string
	createdAt    time.Time
}

var (
	oauthStates   = make(map[string]*oauthState)
	oauthStatesMu sync.Mutex
)

const oauthStateTTL = 10 * time.Minute

// oauthClient GitHub OAuth 出站请求客户端（换 access_token + 取用户信息）。
// 带超时防 GitHub API hang 拖垮回调 goroutine（http.DefaultClient 无超时是技术债）。
var oauthClient = &http.Client{Timeout: 15 * time.Second}

// storeState 生成随机 state 并关联 codeVerifier
func storeState(codeVerifier string) string {
	b := make([]byte, 32)
	rand.Read(b)
	state := base64.URLEncoding.EncodeToString(b)

	oauthStatesMu.Lock()
	// 清理过期
	now := time.Now()
	for k, v := range oauthStates {
		if now.Sub(v.createdAt) > oauthStateTTL {
			delete(oauthStates, k)
		}
	}
	oauthStates[state] = &oauthState{codeVerifier: codeVerifier, createdAt: now}
	oauthStatesMu.Unlock()
	return state
}

// consumeState 取出并删除 state（一次性）
func consumeState(state string) (string, bool) {
	oauthStatesMu.Lock()
	defer oauthStatesMu.Unlock()
	entry, ok := oauthStates[state]
	if !ok {
		return "", false
	}
	delete(oauthStates, state)
	if time.Since(entry.createdAt) > oauthStateTTL {
		return "", false
	}
	return entry.codeVerifier, true
}

// ── GitHub OAuth 端点 ──────────────────────────────

// handleGitHubAuth GET /api/auth/github — 重定向到 GitHub 授权页
func (s *Server) handleGitHubAuth(w http.ResponseWriter, r *http.Request) {
	if s.config.GitHub.ClientID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "GitHub OAuth 未配置"})
		return
	}

	// 生成 PKCE code_verifier
	vb := make([]byte, 32)
	rand.Read(vb)
	codeVerifier := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(vb)

	// code_challenge = BASE64URL(SHA256(code_verifier))
	h := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(h[:])

	// 生成 state（CSRF 防护）并关联 codeVerifier
	state := storeState(codeVerifier)

	// 构造回调 URL（当前请求的 origin + 固定路径）
	redirectURI := s.getOrigin(r) + "/api/auth/github/callback"

	u := url.Values{}
	u.Set("client_id", s.config.GitHub.ClientID)
	u.Set("redirect_uri", redirectURI)
	u.Set("state", state)
	u.Set("code_challenge", codeChallenge)
	u.Set("code_challenge_method", "S256")
	// scope 留空：/user 公开信息不需要 scope

	http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+u.Encode(), http.StatusFound)
}

// handleGitHubCallback GET /api/auth/github/callback — GitHub 授权回调
func (s *Server) handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	if s.config.GitHub.ClientID == "" {
		http.Redirect(w, r, "/?error=github_not_configured", http.StatusFound)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Redirect(w, r, "/?error=oauth_missing_params", http.StatusFound)
		return
	}

	// 校验 state 并取出 code_verifier
	codeVerifier, ok := consumeState(state)
	if !ok {
		http.Redirect(w, r, "/?error=oauth_invalid_state", http.StatusFound)
		return
	}

	// 用授权码换 access_token
	redirectURI := s.getOrigin(r) + "/api/auth/github/callback"
	accessToken, err := exchangeGitHubToken(code, codeVerifier, redirectURI, s.config)
	if err != nil {
		log.Printf("GitHub OAuth 换 token 失败: %v", err)
		http.Redirect(w, r, "/?error=oauth_token_failed", http.StatusFound)
		return
	}

	// 获取 GitHub 用户信息
	username, err := fetchGitHubUser(accessToken)
	if err != nil {
		log.Printf("GitHub OAuth 获取用户信息失败: %v", err)
		http.Redirect(w, r, "/?error=oauth_user_failed", http.StatusFound)
		return
	}

	// 白名单校验
	if !strings.EqualFold(username, s.config.GitHub.AllowedUser) {
		log.Printf("GitHub OAuth 用户 %q 不在白名单（期望 %q）", username, s.config.GitHub.AllowedUser)
		http.Redirect(w, r, "/?error=oauth_unauthorized", http.StatusFound)
		return
	}

	// 签发 JWT（和密码登录同一个 token；jti 此处不用，GitHub 登录不标记"密码已验证"）
	token, _, err := GenerateToken(s.config.JWTSecret, s.GetTokenVersion())
	if err != nil {
		log.Printf("GitHub OAuth 生成 token 失败: %v", err)
		http.Redirect(w, r, "/?error=oauth_token_failed", http.StatusFound)
		return
	}

	// 设置 cookie（和密码登录一致）；Lax 允许 OAuth 回调跨站跳转携带 cookie
	s.setSessionCookie(w, token, http.SameSiteLaxMode)

	// 跳转首页，token 通过 URL 参数传递给前端
	http.Redirect(w, r, "/?token="+token, http.StatusFound)
}

// handleGitHubStatus GET /api/auth/github/status — 前端查询 GitHub OAuth 是否可用
func (s *Server) handleGitHubStatus(w http.ResponseWriter, r *http.Request) {
	enabled := s.config.GitHub.ClientID != "" && s.config.GitHub.ClientSecret != "" && s.config.GitHub.AllowedUser != ""
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

// ── 内部辅助函数 ────────────────────────────────────

// getOrigin 返回 GitHub OAuth 回调 origin（http(s)://host）。
// 优先用 OAUTH_REDIRECT_BASE（生产显式配置，防 Host/X-Forwarded-Proto 伪造致开放重定向）；
// 未配置则从请求推断（dev 兼容）。
func (s *Server) getOrigin(r *http.Request) string {
	if s.config.OAuthRedirectBase != "" {
		return strings.TrimRight(s.config.OAuthRedirectBase, "/")
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// exchangeGitHubToken 用授权码 + PKCE code_verifier 换 access_token
func exchangeGitHubToken(code, codeVerifier, redirectURI string, cfg *Config) (string, error) {
	body := url.Values{}
	body.Set("client_id", cfg.GitHub.ClientID)
	body.Set("client_secret", cfg.GitHub.ClientSecret)
	body.Set("code", code)
	body.Set("redirect_uri", redirectURI)
	body.Set("code_verifier", codeVerifier)

	req, err := http.NewRequest("POST", "https://github.com/login/oauth/access_token", strings.NewReader(body.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := oauthClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("解析 GitHub 响应失败: %s", string(raw))
	}
	if result.Error != "" {
		return "", fmt.Errorf("GitHub 返回错误: %s", result.Error)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("GitHub 未返回 access_token")
	}
	return result.AccessToken, nil
}

// fetchGitHubUser 用 access_token 获取 GitHub 用户名
func fetchGitHubUser(accessToken string) (string, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := oauthClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var user struct {
		Login string `json:"login"`
	}
	if err := json.Unmarshal(raw, &user); err != nil {
		return "", fmt.Errorf("解析 GitHub 用户信息失败: %s", string(raw))
	}
	if user.Login == "" {
		return "", fmt.Errorf("GitHub 用户信息中无 login 字段")
	}
	return user.Login, nil
}
