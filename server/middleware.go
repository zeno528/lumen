package main

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// apiTokenCtxKey 标记当前请求是否经 API Token（msk_）通道认证。
// AuthMiddleware 在 msk_ 通道写入 true；RequireJWT 据此拦截 token 管理端点。
type apiTokenCtxKey struct{}

// jwtClaimsCtxKey 存放当前请求 JWT claims（仅 JWT 通道；API Token 通道无）。
// 供改密码/验证密码等端点读取 jti 做会话级状态。
type jwtClaimsCtxKey struct{}

// jwtTokenCtxKey 存放当前请求的原始 JWT 字符串。
// 旧 token 无 jti 时作为会话键兜底（否则老会话永远无法保持"密码已验证"状态）。
type jwtTokenCtxKey struct{}

// JWTClaims JWT 载荷
type JWTClaims struct {
	TokenVersion int `json:"tv,omitempty"`
	jwt.RegisteredClaims
}

// GenerateToken 生成 JWT token（90 天有效期）。返回 token 与 jti（会话唯一标识），
// 让登录/改密码等调用方直接拿到 jti 标记"密码已验证"，无需再解析刚签发的 token。
func GenerateToken(secret string, version int) (string, string, error) {
	// jti：会话唯一标识（改密码后保留当前会话、按会话记"密码已验证"时效用）
	jtiBytes := make([]byte, 8)
	if _, err := rand.Read(jtiBytes); err != nil {
		return "", "", err
	}
	jti := hex.EncodeToString(jtiBytes)
	claims := JWTClaims{
		TokenVersion: version,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(90 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "lumen",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	return signed, jti, err
}

// GenerateWSTicket 生成一次性 WebSocket 握手票据（5s 有效期，Issuer=lumen-ws）。
// 浏览器 WebSocket API 无法自定义 Authorization header，前端先 GET /api/ws/ticket 换此 ticket
// 再用 ?ticket=xxx 完成握手。5s 内一次性使用，且校验 TokenVersion → 改密码后旧 ticket 立即失效。
func GenerateWSTicket(secret string, version int) (string, error) {
	// jti：一次性票据唯一标识，服务端记 5s 内已用 jti，重用拒绝（防 ticket 截获后 5s 内重复连入）
	jtiBytes := make([]byte, 8)
	if _, err := rand.Read(jtiBytes); err != nil {
		return "", err
	}
	claims := JWTClaims{
		TokenVersion: version,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        hex.EncodeToString(jtiBytes),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Second)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "lumen-ws",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// validateJWT 校验 JWT 合法性 + TokenVersion，返回 claims。
// 抽出来供 AuthMiddleware（Authorization header 通道）与 WSHandler（ticket 通道）复用，纯重构。
func validateJWT(tokenStr, secret string, srv *Server) (*JWTClaims, bool) {
	token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return nil, false
	}
	claims, ok := token.Claims.(*JWTClaims)
	if !ok {
		return nil, false
	}
	if claims.TokenVersion < srv.GetTokenVersion() {
		return nil, false
	}
	return claims, true
}

// AuthMiddleware 认证中间件，同时支持 JWT 和 API Token
func AuthMiddleware(secret string, srv *Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := ""

			// 优先从 Authorization header 获取
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			}

			// 回退到 cookie
			if tokenStr == "" {
				if cookie, err := r.Cookie("token"); err == nil {
					tokenStr = cookie.Value
				}
			}

			if tokenStr == "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
				return
			}

			// API Token 通道：msk_ 前缀
			if strings.HasPrefix(tokenStr, "msk_") {
				if srv.verifyAPIToken(tokenStr) {
					// 标记走 API Token 通道，RequireJWT 据此拦截 token 管理端点
					ctx := context.WithValue(r.Context(), apiTokenCtxKey{}, true)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "token 无效或已过期"})
				return
			}

			// JWT 通道（校验 + TokenVersion）
			if claims, ok := validateJWT(tokenStr, secret, srv); ok {
				ctx := context.WithValue(r.Context(), jwtClaimsCtxKey{}, claims)
				ctx = context.WithValue(ctx, jwtTokenCtxKey{}, tokenStr)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "token 无效或已过期"})
		})
	}
}

// RequireJWT 仅放行 JWT 通道，拦截 API Token（msk_）。
// 用于 token 管理端点：API Token 不得创建/改名/删除/列出 token（账号主人特权），
// 防 token 繁殖（删一个生一个的死循环）、篡改、DoS、侦察。
func RequireJWT(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAPIToken, _ := r.Context().Value(apiTokenCtxKey{}).(bool); isAPIToken {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "此操作需账号登录，API Token 无权执行"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware 跨域中间件
func CORSMiddleware(next http.Handler) http.Handler {
	allowedOrigins := strings.Fields(os.Getenv("CORS_ORIGINS"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(allowedOrigins) == 0 {
			// 未配置 CORS_ORIGINS，不设置跨域头，仅允许同源请求
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		origin := r.Header.Get("Origin")
		allowed := false
		for _, o := range allowedOrigins {
			// 仅精确匹配显式列出的 origin；不再支持 "*" 反射——任意站点带 Authorization 头跨域是配置漏洞
			// （token 虽在 localStorage 跨域 JS 读不到，但 "*" 仍是不该出现的宽松配置）
			if o == origin {
				allowed = true
				break
			}
		}
		if allowed && origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// LoggingMiddleware 请求日志
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
	})
}

// SecurityHeadersMiddleware 安全响应头中间件
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		next.ServeHTTP(w, r)
	})
}

// OpenAPIDiscoveryMiddleware 给所有响应加 Link 头（RFC 8631 service-desc），
// 声明 OpenAPI spec 位置，供读响应头的 AI 工具/扫描器发现说明书。
// 主通道是 verify/stats/health 响应体里的 openapi 字段（AI 读 body 必然看到）；此 Link 头是补充。
func OpenAPIDiscoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Link", "</openapi.json>; rel=\"service-desc\"")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// 已压缩格式不再 gzip，浪费 CPU 且可能增大体积
var noGzipExts = map[string]bool{
	".woff2": true, ".woff": true, ".ttf": true, ".otf": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true,
	".mp4": true, ".webm": true, ".mp3": true, ".ogg": true,
	".zip": true, ".gz": true, ".br": true,
}

// isWSUpgrade 检测是否为 WebSocket 升级请求。
// WS 握手必须绕过 Gzip / Timeout 等会破坏长连接的中间件。
func isWSUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func GzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// WS 握手不能用 gzip ResponseWriter 包裹（会污染升级后的连接）
		if isWSUpgrade(r) {
			next.ServeHTTP(w, r)
			return
		}
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		ext := strings.ToLower(filepath.Ext(r.URL.Path))
		if noGzipExts[ext] {
			next.ServeHTTP(w, r)
			return
		}
		gz := gzip.NewWriter(w)
		defer gz.Close()
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		next.ServeHTTP(&gzipResponseWriter{gw: gz, ResponseWriter: w}, r)
	})
}

type gzipResponseWriter struct {
	gw *gzip.Writer
	http.ResponseWriter
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	w.ResponseWriter.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	return w.gw.Write(b)
}
