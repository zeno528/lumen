package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// 密码哈希（旧 SHA-256 + 静态盐，仅用于存量 hash 验证与登录时升级兼容；新密码一律走 hashPasswordBcrypt）
func hashPassword(password string) string {
	h := sha256.New()
	h.Write([]byte("lumen-salt" + password))
	return hex.EncodeToString(h.Sum(nil))
}

const bcryptCost = 12
const uploadedAvatarKey = "custom:upload"
const maxUploadedAvatarBytes = 48 * 1024

// hashPasswordBcrypt 用 bcrypt 哈希密码（自带随机 salt + 算法标识，新密码一律走此）。
func hashPasswordBcrypt(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// isBcryptHash 判断 hash 是否为 bcrypt 格式（$2a$/$2b$/$2y$ 前缀），用于区分新 bcrypt 与旧 SHA-256 存量。
func isBcryptHash(h string) bool {
	return strings.HasPrefix(h, "$2a$") || strings.HasPrefix(h, "$2b$") || strings.HasPrefix(h, "$2y$")
}

// ── 登录限速器 ─────────────────────────────────────
// 同一 IP 连续失败 5 次后锁定 10 分钟
const (
	maxLoginFails   = 5
	loginLockoutDur = 10 * time.Minute
)

type loginAttempt struct {
	failCount int
	lockedAt  time.Time
}

var (
	loginAttempts   = make(map[string]*loginAttempt)
	loginAttemptsMu sync.Mutex
)

// isLoginLocked 检查该 IP 是否被锁定，返回 true 表示被锁定
func isLoginLocked(ip string) bool {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	a, ok := loginAttempts[ip]
	if !ok {
		return false
	}
	if !a.lockedAt.IsZero() && time.Since(a.lockedAt) > loginLockoutDur {
		delete(loginAttempts, ip)
		return false
	}
	return a.failCount >= maxLoginFails
}

// recordLoginFail 记录一次登录失败
func recordLoginFail(ip string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	a, ok := loginAttempts[ip]
	if !ok {
		a = &loginAttempt{}
		loginAttempts[ip] = a
	}
	a.failCount++
	if a.failCount >= maxLoginFails {
		a.lockedAt = time.Now()
	}
}

// clearLoginFails 登录成功后清除计数
func clearLoginFails(ip string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()
	delete(loginAttempts, ip)
}

// getClientIP 从请求提取客户端真实 IP，防 X-Forwarded-For 伪造。
// 仅当 RemoteAddr 来自可信代理（TRUSTED_PROXY_CIDR）时才采信 XFF/X-Real-IP，
// 并取 XFF 链路中最右的不可信 IP（即真实客户端，攻击者伪造的左侧条目被跳过）；
// 否则一律用 RemoteAddr（不可信来源的 XFF 头完全忽略）。
func (s *Server) getClientIP(r *http.Request) string {
	remoteIP, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteIP = r.RemoteAddr
	}
	if !ipInTrusted(remoteIP, s.trustedProxies) {
		return remoteIP
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ip := strings.TrimSpace(parts[i])
			if ip != "" && !ipInTrusted(ip, s.trustedProxies) {
				return ip
			}
		}
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
		return ip
	}
	return remoteIP
}

// ipInTrusted 判断 IP 是否落在可信代理 CIDR 列表内（空列表恒返回 false）。
func ipInTrusted(ip string, trusted []*net.IPNet) bool {
	if len(trusted) == 0 {
		return false
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, cidr := range trusted {
		if cidr.Contains(parsed) {
			return true
		}
	}
	return false
}

// loadTokenVersionFromDB 启动时从数据库加载 token 版本号到内存
func (s *Server) loadTokenVersionFromDB() int {
	var version int
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = 'token_version'").Scan(&version)
	if err != nil {
		return 0
	}
	return version
}

// GetTokenVersion 返回内存缓存的 token 版本号
func (s *Server) GetTokenVersion() int {
	s.tokenMu.RLock()
	defer s.tokenMu.RUnlock()
	return s.tokenVersion
}

// IncrementTokenVersion 递增 token 版本号（改密码时调用，使所有旧 token 失效）
func (s *Server) IncrementTokenVersion() {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()
	s.tokenVersion++
	_, err := s.db.Exec(`
		INSERT INTO settings (key, value) VALUES ('token_version', ?)
		ON CONFLICT(key) DO UPDATE SET value = ?
	`, s.tokenVersion, s.tokenVersion)
	if err != nil {
		log.Printf("保存 token 版本号失败: %v", err)
	}
}

// consumeWSTicket 校验 WS ticket 的 jti 是否首次使用（一次性票据）。
// 5s 内重用同一 jti 拒绝（防 ticket 被截获后在有效期内重复连入）。无 jti 的旧 ticket 宽容放行。
func (s *Server) consumeWSTicket(jti string) bool {
	if jti == "" {
		return true
	}
	s.usedTicketsMu.Lock()
	defer s.usedTicketsMu.Unlock()
	if _, used := s.usedTickets[jti]; used {
		return false
	}
	// 顺手清理过期（ticket 5s 有效，10s 后必过期，map 不会无限增长）
	now := time.Now()
	for j, t := range s.usedTickets {
		if now.Sub(t) > 10*time.Second {
			delete(s.usedTickets, j)
		}
	}
	s.usedTickets[jti] = now
	return true
}

// verifyPassword 校验密码：优先 bcrypt；旧 SHA-256 存量验证成功后自动升级为 bcrypt；
// DB 无 password_hash 时返回 false（不再回退 env 明文比对——防默认凭据绕过，
// 首次启动由 initPasswordIfNeeded 用 env APP_PASSWORD 初始化 bcrypt 入库）。
func (s *Server) verifyPassword(password string) bool {
	var hashed string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = 'password_hash'").Scan(&hashed)
	if err != nil {
		return false
	}
	if isBcryptHash(hashed) {
		return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(password)) == nil
	}
	// 旧 SHA-256 存量：常量时间比对（防时序攻击），成功则升级为 bcrypt
	if subtle.ConstantTimeCompare([]byte(hashPassword(password)), []byte(hashed)) == 1 {
		s.upgradePasswordToBcrypt(password)
		return true
	}
	return false
}

// upgradePasswordToBcrypt 把密码升级为 bcrypt 存储（登录验证旧 SHA-256 成功后调用，平滑迁移）。
func (s *Server) upgradePasswordToBcrypt(password string) {
	newHash, err := hashPasswordBcrypt(password)
	if err != nil {
		log.Printf("升级密码到 bcrypt 失败: %v", err)
		return
	}
	if _, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES ('password_hash', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, newHash, newHash); err != nil {
		log.Printf("保存升级后的密码失败: %v", err)
	}
}

// initPasswordIfNeeded 首次启动（DB 无 password_hash）时用 env APP_PASSWORD 初始化 bcrypt 入库。
// 之后 verifyPassword 只认 DB，不再回退 env 明文。
// fail-closed：production（含未设 APP_ENV）新库拒空密码/admin——仓库公开后默认凭据全网可见，必须强制设强密码；
// development 空 APP_PASSWORD 回退 admin 保持本地开发兼容；已有 hash 直接放行，不要求 APP_PASSWORD。
// 错误向上传递（不再仅记日志后继续启动），由 main 拒绝启动。
func (s *Server) initPasswordIfNeeded() error {
	var hashed string
	if err := s.db.QueryRow("SELECT value FROM settings WHERE key = 'password_hash'").Scan(&hashed); err == nil {
		return nil // 已有密码，无需 APP_PASSWORD
	}
	initPwd := s.config.Password
	if s.config.AppEnv != "development" {
		// production（含未设 APP_ENV）：禁止空密码或默认 admin 初始化
		if initPwd == "" {
			return fmt.Errorf("生产环境首次启动必须设置非空的 APP_PASSWORD，拒绝用空密码初始化")
		}
		if initPwd == "admin" {
			return fmt.Errorf("生产环境禁止用默认密码 admin 初始化，请在 APP_PASSWORD 设置强密码")
		}
	} else if initPwd == "" {
		// development：空 APP_PASSWORD 回退 admin（本地开发兼容）
		initPwd = "admin"
	}
	newHash, err := hashPasswordBcrypt(initPwd)
	if err != nil {
		return fmt.Errorf("初始化密码失败: %w", err)
	}
	if _, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES ('password_hash', ?)`, newHash); err != nil {
		return fmt.Errorf("写入初始密码失败: %w", err)
	}
	log.Printf("已用 APP_PASSWORD 初始化密码（bcrypt）。请尽快在设置中心修改默认密码。")
	return nil
}

// 验证账号：数据库有设置账号则必须匹配，没有则回退到默认 admin
func (s *Server) verifyUsername(username string) bool {
	var stored string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = 'username_hash'").Scan(&stored)
	if err != nil {
		return username == "admin"
	}
	return hashPassword(username) == stored
}

// handleLogin POST /api/auth/login
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := s.getClientIP(r)

	if isLoginLocked(ip) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "登录尝试过多，请 10 分钟后再试"})
		return
	}

	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if !s.verifyUsername(input.Username) {
		recordLoginFail(ip)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "账号或密码错误"})
		return
	}

	if !s.verifyPassword(input.Password) {
		recordLoginFail(ip)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "账号或密码错误"})
		return
	}

	clearLoginFails(ip)

	token, err := GenerateToken(s.config.JWTSecret, s.GetTokenVersion())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成 token 失败"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "token",
		Value:    token,
		Path:     "/",
		MaxAge:   90 * 24 * 3600,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"ok":    true,
	})
}

// handleVerify GET /api/auth/verify
func (s *Server) handleVerify(w http.ResponseWriter, r *http.Request) {
	// openapi 字段：AI 拿 token 第一步通常调此端点验证，借机把说明书路径暴露在响应体里
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "openapi": "/openapi.json"})
}

// handleChangePassword PUT /api/auth/password
// 统一处理：密码、账号、昵称的修改
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		OldPassword string `json:"currentPassword"`
		NewPassword string `json:"newPassword"`
		Username    string `json:"username"`
		Nickname    string `json:"nickname"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if input.OldPassword == "" || input.NewPassword == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请填写完整"})
		return
	}

	if len(input.NewPassword) < 4 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "新密码至少 4 个字符"})
		return
	}

	// 验证旧密码
	if !s.verifyPassword(input.OldPassword) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "旧密码错误"})
		return
	}

	// 新密码用 bcrypt 哈希存入数据库（不回写 config 内存，避免明文驻留）
	hashed, err := hashPasswordBcrypt(input.NewPassword)
	if err != nil {
		log.Printf("哈希密码失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存密码失败"})
		return
	}
	_, err = s.db.Exec(`
		INSERT INTO settings (key, value) VALUES ('password_hash', ?)
		ON CONFLICT(key) DO UPDATE SET value = ?
	`, hashed, hashed)
	if err != nil {
		log.Printf("保存密码失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存密码失败"})
		return
	}

	// 如果提供了账号，保存（哈希用于验证，明文用于显示）
	if input.Username != "" {
		input.Username = strings.TrimSpace(input.Username)
		if len(input.Username) < 2 || len(input.Username) > 30 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "账号需要 2-30 个字符"})
			return
		}
		usernameHash := hashPassword(input.Username)
		_, err := s.db.Exec("INSERT INTO settings (key, value) VALUES ('username_hash', ?) ON CONFLICT(key) DO UPDATE SET value = ?", usernameHash, usernameHash)
		if err != nil {
			log.Printf("保存账号失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存账号失败"})
			return
		}
		s.db.Exec("INSERT INTO settings (key, value) VALUES ('username', ?) ON CONFLICT(key) DO UPDATE SET value = ?", input.Username, input.Username)
	}

	// 如果提供了昵称，保存
	if input.Nickname != "" {
		input.Nickname = strings.TrimSpace(input.Nickname)
		if len([]rune(input.Nickname)) > 20 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "昵称需要 1-20 个字符"})
			return
		}
		s.db.Exec("INSERT INTO settings (key, value) VALUES ('nickname', ?) ON CONFLICT(key) DO UPDATE SET value = ?", input.Nickname, input.Nickname)
	}

	// 递增 token 版本号，使所有旧 token 失效
	s.IncrementTokenVersion()

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

// handleGetNickname GET /api/auth/nickname
func (s *Server) handleGetNickname(w http.ResponseWriter, r *http.Request) {
	nickname := "哈基米"
	s.db.QueryRow("SELECT value FROM settings WHERE key = 'nickname'").Scan(&nickname)
	writeJSON(w, http.StatusOK, map[string]string{"nickname": nickname})
}

// handleUpdateNickname PUT /api/auth/nickname
func (s *Server) handleUpdateNickname(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Nickname string `json:"nickname"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	input.Nickname = strings.TrimSpace(input.Nickname)
	if input.Nickname == "" || len([]rune(input.Nickname)) > 20 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "昵称需要 1-20 个字符"})
		return
	}

	_, err := s.db.Exec(`
		INSERT INTO settings (key, value) VALUES ('nickname', ?)
		ON CONFLICT(key) DO UPDATE SET value = ?
	`, input.Nickname, input.Nickname)
	if err != nil {
		log.Printf("保存昵称失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存昵称失败"})
		return
	}

	s.broadcastInvalidated("auth-nickname")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"nickname": input.Nickname,
	})
}

// handleGetAvatar GET /api/auth/avatar
func (s *Server) handleGetAvatar(w http.ResponseWriter, r *http.Request) {
	avatar := "fa-piggy-bank"
	avatarColor := "#f59e0b"
	avatarImage := ""
	s.db.QueryRow("SELECT value FROM settings WHERE key = 'avatar'").Scan(&avatar)
	s.db.QueryRow("SELECT value FROM settings WHERE key = 'avatar_color'").Scan(&avatarColor)
	s.db.QueryRow("SELECT value FROM settings WHERE key = 'avatar_image'").Scan(&avatarImage)
	writeJSON(w, http.StatusOK, map[string]string{"avatar": avatar, "avatarColor": avatarColor, "avatarImage": avatarImage})
}

func normalizeUploadedAvatarImage(raw string) (string, error) {
	const prefix = "data:image/webp;base64,"
	if !strings.HasPrefix(raw, prefix) {
		return "", fmt.Errorf("头像图片必须为 WebP 格式")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, prefix))
	if err != nil || len(data) == 0 || len(data) > maxUploadedAvatarBytes || sniffImageMIME(data) != "image/webp" {
		return "", fmt.Errorf("头像图片无效或过大")
	}
	return prefix + base64.StdEncoding.EncodeToString(data), nil
}

// handleUpdateAvatar PUT /api/auth/avatar
func (s *Server) handleUpdateAvatar(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Avatar      string `json:"avatar"`
		AvatarColor string `json:"avatarColor"`
		AvatarImage string `json:"avatarImage"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	input.Avatar = strings.TrimSpace(input.Avatar)
	if input.Avatar == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择头像"})
		return
	}
	if input.Avatar == uploadedAvatarKey {
		image, err := normalizeUploadedAvatarImage(strings.TrimSpace(input.AvatarImage))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		input.AvatarImage = image
	} else if input.AvatarImage != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "仅上传头像可携带图片数据"})
		return
	}

	_, err := s.db.Exec(`
		INSERT INTO settings (key, value) VALUES ('avatar', ?)
		ON CONFLICT(key) DO UPDATE SET value = ?
	`, input.Avatar, input.Avatar)
	if err != nil {
		log.Printf("保存头像失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存头像失败"})
		return
	}

	if input.AvatarColor != "" {
		s.db.Exec(`
			INSERT INTO settings (key, value) VALUES ('avatar_color', ?)
			ON CONFLICT(key) DO UPDATE SET value = ?
		`, input.AvatarColor, input.AvatarColor)
	}
	_, err = s.db.Exec(`
		INSERT INTO settings (key, value) VALUES ('avatar_image', ?)
		ON CONFLICT(key) DO UPDATE SET value = ?
	`, input.AvatarImage, input.AvatarImage)
	if err != nil {
		log.Printf("保存头像图片失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存头像图片失败"})
		return
	}

	s.broadcastInvalidated("auth-avatar")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"avatar":      input.Avatar,
		"avatarColor": input.AvatarColor,
		"avatarImage": input.AvatarImage,
	})
}

// handleGetUsername GET /api/auth/username
func (s *Server) handleGetUsername(w http.ResponseWriter, r *http.Request) {
	username := "admin"
	s.db.QueryRow("SELECT value FROM settings WHERE key = 'username'").Scan(&username)
	writeJSON(w, http.StatusOK, map[string]string{"username": username})
}
