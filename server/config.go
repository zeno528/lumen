package main

import (
	"fmt"
	"log"
	"os"
)

// AIConfig AI 提供商配置
type AIConfig struct {
	ConfigID int64  // 当前激活配置 id（0=env 模式，>0=db 模式）
	Provider string // deepseek / zhipu / minimax / siliconflow / anthropic / custom
	APIKey   string
	Model    string
	BaseURL  string
}

// GitHubOAuthConfig GitHub OAuth 配置
type GitHubOAuthConfig struct {
	ClientID     string
	ClientSecret string
	AllowedUser  string // 白名单 GitHub 用户名
}

// Config 应用配置
type Config struct {
	Port              string
	DBPath            string
	JWTSecret         string
	Password          string
	StaticDir         string
	AppEnv            string // 应用环境（"production" 触发严格安全校验，如强制要求 JWT_SECRET）
	TrustedProxies    string // 可信反代 CIDR 列表（逗号分隔），空=不信任 X-Forwarded-For（防 XFF 伪造绕过限速）
	LogoDevToken      string // Logo.dev publishable key（favicon 第三方兜底用），默认内置，可 env 覆盖
	OAuthRedirectBase string // GitHub OAuth 回调基址（https://your.domain），空=从请求推断（生产建议显式设置防开放重定向）
	AI                AIConfig
	GitHub            GitHubOAuthConfig
	SerperAPIKey      string // Serper Google 搜索 API key（直连抓空时的搜索兜底）
}

// defaultJWTSecret 开发环境兜底用的 JWT 密钥。生产环境禁止使用——该值还派生 AES 密钥加密 AI/Serper key，
// 
const defaultJWTSecret = "lumen-default-secret-change-me"

// resolveJWTSecret 规范化运行环境并解析 JWT 密钥（纯函数，便于测试）。
// 空 appEnv 视为 production（fail-closed：未显式声明 development 即按生产严格对待，堵住「忘设 APP_ENV 静默放行默认 JWT」）。
// production 下 JWT 为空或等于默认值 → 返回错误（调用方应拒绝启动）。
// development 下空/默认 JWT 允许用开发默认值（仅打印警告，保持本地开发兼容）。
func resolveJWTSecret(appEnv, jwtSecret string) (secret, resolvedEnv string, err error) {
	if appEnv != "development" {
		appEnv = "production" // 空、production 及任何非 development 值一律按生产严格
	}
	if jwtSecret == "" || jwtSecret == defaultJWTSecret {
		if appEnv == "production" {
			return "", appEnv, fmt.Errorf("生产环境（APP_ENV=production 或未设置）必须设置非默认的 JWT_SECRET，拒绝启动")
		}
		log.Printf("⚠️ 警告: JWT_SECRET 未设置或为默认值，使用默认值（仅限开发；生产请设 APP_ENV=production 并配置独立 JWT_SECRET）")
		return defaultJWTSecret, appEnv, nil
	}
	return jwtSecret, appEnv, nil
}

func LoadConfig() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "data/bookmarks.db"
	}
	appEnv := os.Getenv("APP_ENV")
	// JWT 解析走 fail-closed 纯函数：生产/未设 APP_ENV 下默认或空 JWT 拒绝启动
	jwtSecret, resolvedEnv, err := resolveJWTSecret(appEnv, os.Getenv("JWT_SECRET"))
	if err != nil {
		log.Fatal(err)
	}
	appEnv = resolvedEnv
	// 密码保留环境变量原始值（可能为空）；是否允许空/admin 回退由 initPasswordIfNeeded 按 env 决策，
	// 不再在配置载入阶段自动改成 admin（避免生产静默用默认凭据）
	password := os.Getenv("APP_PASSWORD")
	trustedProxies := os.Getenv("TRUSTED_PROXY_CIDR")
	logoDevToken := os.Getenv("LOGO_DEV_TOKEN")
	if logoDevToken == "" {
		logoDevToken = "pk_Kd7g6vh2SwqZ4uBfXZ9X0A" // Logo.dev 免费层 publishable key（pk_ 前缀，设计客户端可见）
	}
	oauthRedirectBase := os.Getenv("OAUTH_REDIRECT_BASE")
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "./static"
	}

	// AI 配置
	ai := AIConfig{
		Provider: os.Getenv("AI_PROVIDER"),
		APIKey:   os.Getenv("AI_API_KEY"),
		Model:    os.Getenv("AI_MODEL"),
		BaseURL:  os.Getenv("AI_BASE_URL"),
	}

	// 每个 provider 的默认值
	switch ai.Provider {
	case "deepseek":
		if ai.Model == "" {
			ai.Model = "deepseek-chat"
		}
		if ai.BaseURL == "" {
			ai.BaseURL = "https://api.deepseek.com/v1"
		}
	case "openai":
		if ai.Model == "" {
			ai.Model = "gpt-4o-mini"
		}
		if ai.BaseURL == "" {
			ai.BaseURL = "https://api.openai.com/v1"
		}
	}

	return &Config{
		Port:              port,
		DBPath:            dbPath,
		JWTSecret:         jwtSecret,
		Password:          password,
		StaticDir:         staticDir,
		AppEnv:            appEnv,
		TrustedProxies:    trustedProxies,
		LogoDevToken:      logoDevToken,
		OAuthRedirectBase: oauthRedirectBase,
		AI:                ai,
		SerperAPIKey:      os.Getenv("SERPER_API_KEY"),
		GitHub: GitHubOAuthConfig{
			ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
			ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
			AllowedUser:  os.Getenv("GITHUB_ALLOWED_USER"),
		},
	}
}

// getAIConfig 返回当前 AI 配置的快照（并发安全）。
// 设置页热更新（写）与 AI 分析（读）并发时，避免读到半更新 struct（如新 Provider + 旧 APIKey 导致调用失败/串号）。
func (s *Server) getAIConfig() AIConfig {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.config.AI
}

// getSerperKey 返回当前 Serper key（并发安全）。
// 设置页保存/删除 key 与 AI 搜索兜底读 key 并发时无竞争。
func (s *Server) getSerperKey() string {
	s.configMu.RLock()
	defer s.configMu.RUnlock()
	return s.config.SerperAPIKey
}
