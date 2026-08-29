package main

import (
	"time"

	"github.com/go-chi/chi/v5"
)

// registerAuthedRoutes 注册所有需要认证的 API 路由（AuthMiddleware 由调用方挂）。
// main.go 与 api_integration_test.go 共用，杜绝两边路由表漂移——
// 此前测试路由手工复制，漏掉 categories/reorder 等端点，请求静默落进 /{id} handler。
func (s *Server) registerAuthedRoutes(r chi.Router) {
	// OpenAPI 3.0 spec（需认证：API Token 或 JWT 才能读「说明书」，匿名 401；见 server/openapi.go）
	r.Get("/openapi.json", s.handleOpenAPI)

	// 认证验证
	r.Get("/api/auth/verify", s.handleVerify)
	r.Get("/api/auth/password-verified", s.handlePasswordVerifiedStatus)
	r.Post("/api/auth/verify-password", s.handleVerifyPassword)
	r.Put("/api/auth/password", s.handleChangePassword)
	// 踢其他设备下线：仅 JWT 通道（账号特权，API Token 无"当前会话"概念）
	r.With(RequireJWT).Post("/api/auth/revoke-sessions", s.handleRevokeSessions)
	r.Get("/api/auth/nickname", s.handleGetNickname)
	r.Put("/api/auth/nickname", s.handleUpdateNickname)
	r.Get("/api/auth/avatar", s.handleGetAvatar)
	r.Put("/api/auth/avatar", s.handleUpdateAvatar)
	r.Get("/api/auth/username", s.handleGetUsername)

	// WebSocket 票据：用主 JWT 换 5s 一次性 ticket（WS 握手不能带 Authorization header）
	r.Get("/api/ws/ticket", s.handleWSTicket)

	// AI 设置
	r.Get("/api/ai-settings", s.handleGetAISettings)
	r.Put("/api/ai-settings", s.handleUpdateAISettings)
	r.With(s.rateLimit(10, time.Minute)).Post("/api/ai-test", s.handleAITest)
	r.Put("/api/ai-settings/switch", s.handleSwitchAIProvider)
	r.Delete("/api/ai-settings/config/{id}", s.handleDeleteAIProviderConfig)
	r.Post("/api/ai-settings/copy", s.handleCopyConfig)

	// Serper 搜索 key（AI 助手反爬站兜底用）
	r.Get("/api/serper-key", s.handleGetSerperKey)
	r.Post("/api/serper-key", s.handleSaveSerperKey)
	r.Post("/api/serper-key/test", s.handleTestSerperKey)
	r.Delete("/api/serper-key", s.handleDeleteSerperKey)

	// 用户偏好设置（跨设备同步）
	r.Get("/api/settings/id-search-mode", s.handleGetIdSearchMode)
	r.Put("/api/settings/id-search-mode", s.handleSetIdSearchMode)

	// 备份与恢复：涉及磁盘快照和破坏性回滚，仅账号 JWT（而非 msk_ API Token）可操作。
	r.Group(func(r chi.Router) {
		r.Use(RequireJWT)
		r.Get("/api/backups/settings", s.handleGetBackupSettings)
		r.Put("/api/backups/settings", s.handleUpdateBackupSettings)
		r.Get("/api/backups", s.handleListBackups)
		r.With(s.rateLimit(20, time.Hour)).Post("/api/backups/run", s.handleRunBackup)
		r.Patch("/api/backups/{id}", s.handleRenameBackup)
		r.Delete("/api/backups/{id}", s.handleDeleteBackup)
		r.Get("/api/backups/{id}/preview", s.handleBackupPreview)
		r.With(s.rateLimit(3, time.Hour)).Post("/api/backups/{id}/restore", s.handleRestoreBackup)
	})

	// 分类 CRUD（固定两级：parent_id 指向顶级分类）
	r.Get("/api/categories", s.handleGetCategories)
	r.Post("/api/categories", s.handleCreateCategory)
	r.Post("/api/categories/merge", s.handleMergeCategories)
	r.Delete("/api/categories/batch", s.handleBatchDeleteCategories)
	r.Put("/api/categories/reorder", s.handleReorderCategories)
	r.Put("/api/categories/{id}", s.handleUpdateCategory)
	r.Delete("/api/categories/{id}", s.handleDeleteCategory)

	// 书签 CRUD
	r.Get("/api/bookmarks", s.handleGetBookmarks)
	r.Post("/api/bookmarks", s.handleCreateBookmark)
	r.Put("/api/bookmarks/reorder", s.handleReorderBookmarks)
	r.Delete("/api/bookmarks/batch", s.handleBatchDeleteBookmarks)
	r.Put("/api/bookmarks/batch-move", s.handleBatchMoveBookmarks)
	r.Put("/api/bookmarks/batch-update", s.handleBatchUpdateBookmarks)
	r.Put("/api/bookmarks/batch-tags", s.handleBatchAddTags)
	r.Put("/api/bookmarks/{id}", s.handleUpdateBookmark)
	r.Delete("/api/bookmarks/{id}", s.handleDeleteBookmark)

	r.Patch("/api/bookmarks/{id}/favorite", s.handleToggleFavorite)

	// 书签 favicon：同源 <img> 自动携带登录 cookie（AuthMiddleware 接受 token cookie），
	// 陌生人 curl 直接 401，堵掉未认证枚举书签集合的隐私泄露。
	r.Get("/api/bookmarks/{id}/favicon", s.handleBookmarkFavicon)

	// 导入导出
	r.Get("/api/export", s.handleExport)
	r.With(s.rateLimit(5, time.Minute)).Post("/api/import", s.handleImport)

	// 工具
	r.Get("/api/fetch-title", s.handleFetchTitle)
	r.Post("/api/ai-meta", s.handleAIMeta)
	r.Get("/api/favicon", s.handleFavicon)
	r.Get("/api/stats", s.handleStats)

	// API Token 管理：仅账号登录(JWT)可用，API Token(msk_)无权。
	// 防 token 繁殖(创建)、篡改(改名)、DoS(删除)、侦察(列表) -- 见 RequireJWT
	r.Group(func(r chi.Router) {
		r.Use(RequireJWT)
		r.Get("/api/tokens", s.handleListTokens)
		r.Post("/api/tokens", s.handleCreateToken)
		r.Put("/api/tokens/{id}", s.handleUpdateToken)
		r.Delete("/api/tokens/{id}", s.handleDeleteToken)
	})
}
