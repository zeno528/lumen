package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"

	"lumen/server/db"
	"lumen/server/ws"
)

// Server 应用服务器
type Server struct {
	db                  *sql.DB
	config              *Config
	tokenVersion        int                       // 内存缓存，改密码时更新，避免每次请求查 DB
	tokenMu             sync.RWMutex              // 保护 tokenVersion 并发读写（validateJWT 高频读 + 改密码写）
	configMu            sync.RWMutex              // 保护 config.AI / config.SerperAPIKey 热更新读写（设置页改配置 vs AI 分析并发读，避免读到半更新 struct）
	backupMu            sync.Mutex                // 序列化快照、恢复、删除和保留策略清理
	trustedProxies      []*net.IPNet              // 可信反代 CIDR（getClientIP 防伪 XFF 用）
	usedTickets         map[string]time.Time      // WS ticket jti 一次性去重（5s 内重用拒绝）
	usedTicketsMu       sync.Mutex                // 保护 usedTickets
	verifiedPasswords   map[string]time.Time      // 会话键(jti/旧token原文)密码验证时间戳（10 分钟时效，见 auth.go）
	verifiedPasswordsMu sync.Mutex                // 保护 verifiedPasswords
	rateLimiters        map[string]*ipRateLimiter // 通用 IP 限速器池（按 limit:window 复用；ai-test/import/github callback）
	rateLimitersMu      sync.Mutex                // 保护 rateLimiters
	indexHTML           []byte                    // 内存缓存 index.html，避免每次 SPA 回退都读磁盘
	indexHTMLMu         sync.Mutex                // 保护 indexHTML 并发读写
	indexHTMLMod        time.Time                 // index.html 修改时间，变化时自动重载（开发热更新）
	hub                 *ws.Hub                   // WebSocket Hub，所有客户端连接的广播中枢
}

// parseTrustedProxies 解析逗号分隔的 CIDR 列表为 []*net.IPNet。无效条目跳过并告警。
// 不带 / 的单 IP 视为 /32（IPv4）或 /128（IPv6）。空串返回 nil（不信任任何代理，getClientIP 用 RemoteAddr）。
func parseTrustedProxies(cidrs string) []*net.IPNet {
	if strings.TrimSpace(cidrs) == "" {
		return nil
	}
	var nets []*net.IPNet
	for c := range strings.SplitSeq(cidrs, ",") {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if !strings.Contains(c, "/") {
			if ip := net.ParseIP(c); ip != nil {
				if ip.To4() != nil {
					c += "/32"
				} else {
					c += "/128"
				}
			}
		}
		_, ipnet, err := net.ParseCIDR(c)
		if err != nil {
			log.Printf("忽略无效的 TRUSTED_PROXY_CIDR 条目: %s", c)
			continue
		}
		nets = append(nets, ipnet)
	}
	return nets
}

func main() {
	config := LoadConfig()

	// 初始化加密（用于 AI API 密钥加密存储）
	InitEncryption(config.JWTSecret)

	// 连接数据库
	database, err := db.Connect(config.DBPath)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	defer database.Close()

	// 执行迁移
	if err := db.Migrate(database); err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}
	log.Println("数据库迁移完成")

	srv := &Server{
		db:                database,
		config:            config,
		usedTickets:       make(map[string]time.Time),
		verifiedPasswords: make(map[string]time.Time),
		rateLimiters:      make(map[string]*ipRateLimiter),
	}

	// 异步加载 theSVG 品牌图标域名映射（favicon 阶段0 精准命中 npmjs.com->npm 等，不阻塞启动；失败回退 slug 推导）
	go loadTheSvgRegistry()

	// WebSocket Hub：root ctx 接管信号，ctx 取消时 Hub 关闭所有 client 连接
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	hub := ws.NewHub()
	srv.hub = hub
	go hub.Run(ctx)

	// 从数据库加载 token 版本号到内存
	srv.tokenVersion = srv.loadTokenVersionFromDB()
	// 解析可信反代 CIDR（getClientIP 防伪 XFF）；首次启动用 env APP_PASSWORD 初始化 bcrypt 密码入 DB
	srv.trustedProxies = parseTrustedProxies(config.TrustedProxies)
	if err := srv.initPasswordIfNeeded(); err != nil {
		log.Fatalf("启动失败（密码初始化）: %v", err)
	}

	// 从数据库加载 AI 配置（覆盖环境变量）
	srv.ReloadAIConfig()
	// 从数据库加载 Serper key（覆盖环境变量）
	srv.loadSerperKeyFromDB()
	// 单节点 SQLite 自动备份调度器：随 root ctx 停止，不阻塞启动
	go srv.RunBackupScheduler(ctx)

	// 路由设置
	r := chi.NewRouter()

	// 全局中间件
	r.Use(CORSMiddleware)
	r.Use(SecurityHeadersMiddleware)
	r.Use(OpenAPIDiscoveryMiddleware) // 给所有响应加 Link: service-desc 头（RFC 8631），暴露 OpenAPI 说明书路径
	r.Use(GzipMiddleware)
	r.Use(LoggingMiddleware)
	r.Use(chiMiddleware.Recoverer)
	// Timeout 中间件旁路 WS 升级请求：http.TimeoutHandler 30s 后会写 503 截断长连接
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isWSUpgrade(r) {
				next.ServeHTTP(w, r)
				return
			}
			chiMiddleware.Timeout(30*time.Second)(next).ServeHTTP(w, r)
		})
	})

	// 公开端点（无需认证）
	r.Post("/api/auth/login", srv.handleLogin)
	r.Get("/api/auth/github", srv.handleGitHubAuth)
	r.With(srv.rateLimit(10, time.Minute)).Get("/api/auth/github/callback", srv.handleGitHubCallback)
	r.Get("/api/auth/github/status", srv.handleGitHubStatus)

	// 需要认证的 API
	r.Group(func(r chi.Router) {
		r.Use(AuthMiddleware(config.JWTSecret, srv))

		// OpenAPI 3.0 spec（需认证：API Token 或 JWT 才能读「说明书」，匿名 401；见 server/openapi.go）
		r.Get("/openapi.json", srv.handleOpenAPI)

		// 认证验证
		r.Get("/api/auth/verify", srv.handleVerify)
		r.Get("/api/auth/password-verified", srv.handlePasswordVerifiedStatus)
		r.Post("/api/auth/verify-password", srv.handleVerifyPassword)
		r.Put("/api/auth/password", srv.handleChangePassword)
		// 踢其他设备下线：仅 JWT 通道（账号特权，API Token 无"当前会话"概念）
		r.With(RequireJWT).Post("/api/auth/revoke-sessions", srv.handleRevokeSessions)
		r.Get("/api/auth/nickname", srv.handleGetNickname)
		r.Put("/api/auth/nickname", srv.handleUpdateNickname)
		r.Get("/api/auth/avatar", srv.handleGetAvatar)
		r.Put("/api/auth/avatar", srv.handleUpdateAvatar)
		r.Get("/api/auth/username", srv.handleGetUsername)

		// WebSocket 票据：用主 JWT 换 5s 一次性 ticket（WS 握手不能带 Authorization header）
		r.Get("/api/ws/ticket", srv.handleWSTicket)

		// AI 设置
		r.Get("/api/ai-settings", srv.handleGetAISettings)
		r.Put("/api/ai-settings", srv.handleUpdateAISettings)
		r.With(srv.rateLimit(10, time.Minute)).Post("/api/ai-test", srv.handleAITest)
		r.Put("/api/ai-settings/switch", srv.handleSwitchAIProvider)
		r.Delete("/api/ai-settings/config/{id}", srv.handleDeleteAIProviderConfig)
		r.Post("/api/ai-settings/copy", srv.handleCopyConfig)

		// Serper 搜索 key（AI 助手反爬站兜底用）
		r.Get("/api/serper-key", srv.handleGetSerperKey)
		r.Post("/api/serper-key", srv.handleSaveSerperKey)
		r.Post("/api/serper-key/test", srv.handleTestSerperKey)
		r.Delete("/api/serper-key", srv.handleDeleteSerperKey)

		// 用户偏好设置（跨设备同步）
		r.Get("/api/settings/id-search-mode", srv.handleGetIdSearchMode)
		r.Put("/api/settings/id-search-mode", srv.handleSetIdSearchMode)

		// 备份与恢复：涉及磁盘快照和破坏性回滚，仅账号 JWT（而非 msk_ API Token）可操作。
		r.Group(func(r chi.Router) {
			r.Use(RequireJWT)
			r.Get("/api/backups/settings", srv.handleGetBackupSettings)
			r.Put("/api/backups/settings", srv.handleUpdateBackupSettings)
			r.Get("/api/backups", srv.handleListBackups)
			r.With(srv.rateLimit(6, time.Hour)).Post("/api/backups/run", srv.handleRunBackup)
			r.Patch("/api/backups/{id}", srv.handleRenameBackup)
			r.Delete("/api/backups/{id}", srv.handleDeleteBackup)
			r.Get("/api/backups/{id}/preview", srv.handleBackupPreview)
			r.With(srv.rateLimit(3, time.Hour)).Post("/api/backups/{id}/restore", srv.handleRestoreBackup)
		})

		// 分类 CRUD
		r.Get("/api/categories", srv.handleGetCategories)
		r.Post("/api/categories", srv.handleCreateCategory)
		r.Post("/api/categories/merge", srv.handleMergeCategories)
		r.Delete("/api/categories/batch", srv.handleBatchDeleteCategories)
		r.Put("/api/categories/reorder", srv.handleReorderCategories)
		r.Put("/api/categories/{id}", srv.handleUpdateCategory)
		r.Delete("/api/categories/{id}", srv.handleDeleteCategory)

		// 书签 CRUD
		r.Get("/api/bookmarks", srv.handleGetBookmarks)
		r.Post("/api/bookmarks", srv.handleCreateBookmark)
		r.Put("/api/bookmarks/reorder", srv.handleReorderBookmarks)
		r.Delete("/api/bookmarks/batch", srv.handleBatchDeleteBookmarks)
		r.Put("/api/bookmarks/batch-move", srv.handleBatchMoveBookmarks)
		r.Put("/api/bookmarks/batch-update", srv.handleBatchUpdateBookmarks)
		r.Put("/api/bookmarks/batch-tags", srv.handleBatchAddTags)
		r.Put("/api/bookmarks/{id}", srv.handleUpdateBookmark)
		r.Delete("/api/bookmarks/{id}", srv.handleDeleteBookmark)

		r.Patch("/api/bookmarks/{id}/favorite", srv.handleToggleFavorite)

		// 书签 favicon：同源 <img> 自动携带登录 cookie（AuthMiddleware 接受 token cookie），
		// 陌生人 curl 直接 401，堵掉未认证枚举书签集合的隐私泄露。
		r.Get("/api/bookmarks/{id}/favicon", srv.handleBookmarkFavicon)

		// 导入导出
		r.Get("/api/export", srv.handleExport)
		r.With(srv.rateLimit(5, time.Minute)).Post("/api/import", srv.handleImport)

		// 工具
		r.Get("/api/fetch-title", srv.handleFetchTitle)
		r.Post("/api/ai-meta", srv.handleAIMeta)
		r.Get("/api/favicon", srv.handleFavicon)
		r.Get("/api/stats", srv.handleStats)
		// API Token 管理：仅账号登录(JWT)可用，API Token(msk_)无权。
		// 防 token 繁殖(创建)、篡改(改名)、DoS(删除)、侦察(列表) -- 见 RequireJWT
		r.Group(func(r chi.Router) {
			r.Use(RequireJWT)
			r.Get("/api/tokens", srv.handleListTokens)
			r.Post("/api/tokens", srv.handleCreateToken)
			r.Put("/api/tokens/{id}", srv.handleUpdateToken)
			r.Delete("/api/tokens/{id}", srv.handleDeleteToken)
		})
	})

	// 健康检查（无需认证）
	r.Get("/api/health", srv.handleHealth)

	// WebSocket 端点（不走 AuthMiddleware：WS 握手无 Authorization header）
	// ticket 校验由 WSHandler 内部完成：JWT 合法 + TokenVersion + Issuer=="lumen-ws"
	r.Get("/api/ws", ws.WSHandler(hub, func(ticket string) bool {
		claims, ok := validateJWT(ticket, config.JWTSecret, srv)
		if !ok || claims.Issuer != "lumen-ws" {
			return false
		}
		return srv.consumeWSTicket(claims.ID) // jti 一次性：5s 内重用拒绝
	}, strings.Fields(os.Getenv("CORS_ORIGINS"))))

	// 静态文件服务（前端）
	staticDir := config.StaticDir
	if _, err := os.Stat(staticDir); err == nil {
		fileServer := http.FileServer(http.Dir(staticDir))

		// 注入 GitHub OAuth 开关，避免前端额外网络请求
		githubEnabled := config.GitHub.ClientID != "" && config.GitHub.ClientSecret != "" && config.GitHub.AllowedUser != ""
		indexHTMLPath := filepath.Join(staticDir, "index.html")
		// 预加载 index.html 到内存；文件变化时 freshIndexHTML 会自动重载（开发热更新）
		srv.freshIndexHTML(indexHTMLPath, githubEnabled)
		if len(srv.indexHTML) > 0 {
			log.Printf("已缓存 index.html 到内存 (%d bytes, GitHub OAuth: %v)", len(srv.indexHTML), githubEnabled)
		} else {
			log.Printf("警告: 无法预加载 index.html")
		}
		// 非 API 请求：先尝试静态文件，回退到 index.html（SPA）
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			// 跳过 API 请求
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.NotFound(w, r)
				return
			}
			// 无扩展名路径（/、/settings 等 SPA 路径）：用内存缓存（含注入配置）
			if ext := filepath.Ext(r.URL.Path); ext == "" {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Cache-Control", "no-cache")
				if data := srv.freshIndexHTML(indexHTMLPath, githubEnabled); len(data) > 0 {
					w.Write(data)
				} else {
					http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
				}
				return
			}
			// 尝试提供静态文件
			path := filepath.Join(staticDir, r.URL.Path)
			if _, err := os.Stat(path); err == nil {
				// 静态资源缓存策略：
				// - html → no-cache（协商缓存，Go 默认带 ETag → 304，更新后立即生效）
				// - 其余 → immutable 强缓存 1 年。Vite 产物文件名带内容 hash（index-CASicPUf.js），
				//   内容变 hash 变，强缓存安全——刷新时浏览器直接用本地，不重传
				ext := strings.ToLower(filepath.Ext(path))
				if ext == ".html" {
					w.Header().Set("Cache-Control", "no-cache")
				} else {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
			// 带扩展名的静态资源（.js/.css/.png 等）不存在 -> 直接 404，不回退 index.html。
			// 否则浏览器请求 <script src="/assets/index-<旧hash>.js"> 却收到 html（text/html），
			// 报 "'text/html' is not a valid JavaScript MIME type"。
			// 场景：部署后 rsync --delete 删掉旧 hash 产物，而旧 tab 仍持有引用旧 hash 的 index.html。
			// SPA 路由路径无扩展名，由上方 ext=="" 分支处理，此处只可能是静态资源 404。
			http.NotFound(w, r)
		})
	}

	// 启动 HTTP 服务器
	httpServer := &http.Server{
		Addr:         ":" + config.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 优雅关闭：root ctx 由 signal.NotifyContext 接管，信号到达时
	// 同时触发 httpServer.Shutdown（停新连接 + drain）与 hub.Run 退出（关所有 WS 连接）
	go func() {
		<-ctx.Done()
		log.Println("正在关闭服务器...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		httpServer.Shutdown(shutdownCtx)
	}()

	log.Printf("Lumen 服务启动在 http://localhost:%s", config.Port)
	// 输出局域网地址，方便手机调试移动端
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, addr := range addrs {
			if ipNet, ok := addr.(*net.IPNet); ok && !ipNet.IP.IsLoopback() && ipNet.IP.To4() != nil {
				log.Printf("局域网访问: http://%s:%s (手机调试)", ipNet.IP, config.Port)
				break
			}
		}
	}
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("服务器错误: %v", err)
	}
}

// freshIndexHTML 返回最新的 index.html 内容。
// 对比文件修改时间实现热更新：开发时修改 index.html 无需重启即可生效；
// 生产环境文件不变则始终走缓存（每次仅一次 os.Stat，开销可忽略）。
func (s *Server) freshIndexHTML(path string, githubEnabled bool) []byte {
	s.indexHTMLMu.Lock()
	defer s.indexHTMLMu.Unlock()
	fi, err := os.Stat(path)
	// 文件不可访问，或文件未变化 → 直接返回缓存
	if err != nil || (!s.indexHTMLMod.IsZero() && fi.ModTime().Equal(s.indexHTMLMod)) {
		return s.indexHTML
	}
	// 首次加载或检测到变化：重新读取并注入 GitHub OAuth 开关
	if data, e := os.ReadFile(path); e == nil {
		hotReloaded := !s.indexHTMLMod.IsZero() // 之前已加载过 → 这次是热重载
		s.indexHTML = []byte(strings.Replace(string(data), "__GITHUB_OAUTH__", fmt.Sprintf("%v", githubEnabled), 1))
		s.indexHTMLMod = fi.ModTime()
		if hotReloaded {
			log.Printf("检测到 index.html 变化，已重新加载 (%d bytes)", len(s.indexHTML))
		}
	}
	return s.indexHTML
}
