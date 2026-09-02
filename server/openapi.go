package main

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

// OpenAPI 3.0 精简 spec 生成器。
// 目的：给 AI agent / 第三方一个「API 地图 + 认证边界」，拿到 msk_ token 后
// 访问 /openapi.json 即知有哪些端点、每个端点用什么认证、API token 能不能调。
// 精简版只列 method/path/summary/tag/auth，不含请求体 schema（参数 AI 可 GET 资源推断）。
//
// 认证三档（x-auth 扩展字段标注，OpenAPI 标准 security 不区分 token 类型）：
//   - public          无需认证
//   - api-token-or-jwt JWT(账号登录) 或 msk_ API Token 均可
//   - jwt-only        仅 JWT，API Token 调返回 403（RequireJWT 保护，见 middleware.go）

// endpointMeta 单个端点的精简元数据。与 main.go 路由注册一一对应，改路由时同步改这里。
type endpointMeta struct {
	Method  string // GET/POST/PUT/PATCH/DELETE
	Path    string // 含 /api 前缀
	Summary string
	Tag     string // 分组：auth/bookmarks/categories/ai/serper/tokens/backups/system/ws
	Auth    string // public | api-token-or-jwt | jwt-only
}

// apiEndpoints 全部 API 端点元数据表。与 main.go 的 r.Get/Post/Put/Delete 注册项保持一致。
// 新增/删除端点时，除在 main.go 注册外，须在此同步增删，否则 /openapi.json 会与实际路由不符。
var apiEndpoints = []endpointMeta{
	// ===== 公开（无需认证）=====
	{"POST", "/api/auth/login", "账号登录，返回 JWT", "auth", "public"},
	{"GET", "/api/auth/github/status", "GitHub OAuth 是否启用", "auth", "public"},
	{"GET", "/api/auth/github", "发起 GitHub OAuth 登录", "auth", "public"},
	{"GET", "/api/auth/github/callback", "GitHub OAuth 回调", "auth", "public"},
	{"GET", "/api/health", "健康检查", "system", "public"},
	// 注意：favicon 实际注册在 AuthMiddleware 之后（routes.go，防未认证枚举书签集合），
	// 浏览器同源 <img> 靠 cookie 过认证；agent 调用必须带 Authorization，否则 401。
	{"GET", "/api/bookmarks/{id}/favicon", "书签 favicon（需认证；浏览器同源 img 走 cookie）", "bookmarks", "api-token-or-jwt"},

	// ===== 认证（JWT 或 API Token 均可）=====
	// 账户
	{"GET", "/api/auth/verify", "校验登录态", "auth", "api-token-or-jwt"},
	{"GET", "/api/auth/username", "当前账号", "auth", "api-token-or-jwt"},
	{"GET", "/api/auth/nickname", "当前昵称", "auth", "api-token-or-jwt"},
	{"PUT", "/api/auth/nickname", "改昵称（不需密码）", "auth", "api-token-or-jwt"},
	{"GET", "/api/auth/avatar", "当前头像", "auth", "api-token-or-jwt"},
	{"PUT", "/api/auth/avatar", "改头像", "auth", "api-token-or-jwt"},
	// 改密码/验密码涉及十分钟免密会话机制，人类浏览器会话专属，API Token 无权（RequireJWT）
	{"GET", "/api/auth/password-verified", "当前会话是否已验证密码（10 分钟免密时效内）", "auth", "jwt-only"},
	{"POST", "/api/auth/verify-password", "验证当前密码（开启 10 分钟免密时效）", "auth", "jwt-only"},
	{"PUT", "/api/auth/password", "改账号/密码（body 需含 currentPassword 校验旧密码）", "auth", "jwt-only"},

	// WebSocket
	{"GET", "/api/ws/ticket", "用主 JWT 换 5s 一次性 WS 握手票据", "ws", "api-token-or-jwt"},
	{"GET", "/api/ws", "WebSocket 端点（?ticket=xxx 握手，不走 AuthMiddleware）", "ws", "public"},

	// 书签 CRUD
	{"GET", "/api/bookmarks", "书签列表（全量）", "bookmarks", "api-token-or-jwt"},
	{"POST", "/api/bookmarks", "新建书签", "bookmarks", "api-token-or-jwt"},
	{"PUT", "/api/bookmarks/{id}", "更新书签（改 url/title/tags/favicon 等）", "bookmarks", "api-token-or-jwt"},
	{"DELETE", "/api/bookmarks/{id}", "删除书签", "bookmarks", "api-token-or-jwt"},
	{"PATCH", "/api/bookmarks/{id}/favorite", "切换单个书签收藏", "bookmarks", "api-token-or-jwt"},
	{"PUT", "/api/bookmarks/reorder", "书签排序", "bookmarks", "api-token-or-jwt"},
	{"DELETE", "/api/bookmarks/batch", "批量删除书签", "bookmarks", "api-token-or-jwt"},
	{"PUT", "/api/bookmarks/batch-move", "批量移动书签到指定分类", "bookmarks", "api-token-or-jwt"},
	{"PUT", "/api/bookmarks/batch-update", "批量更新书签字段", "bookmarks", "api-token-or-jwt"},
	{"PUT", "/api/bookmarks/batch-tags", "批量加标签", "bookmarks", "api-token-or-jwt"},
	{"DELETE", "/api/bookmarks/batch-tags", "批量移除标签", "bookmarks", "api-token-or-jwt"},

	// 分类 CRUD（固定两级：parent_id 指向顶级分类）
	{"GET", "/api/categories", "分类列表（含 parent_id）", "categories", "api-token-or-jwt"},
	{"POST", "/api/categories", "新建分类（可指定 parent_id，父必须是顶级）", "categories", "api-token-or-jwt"},
	{"PUT", "/api/categories/{id}", "更新分类（name/icon/color/parent_id）", "categories", "api-token-or-jwt"},
	{"DELETE", "/api/categories/{id}", "删除分类（父分类的子分类自动升级为顶级）", "categories", "api-token-or-jwt"},
	{"POST", "/api/categories/merge", "合并分类", "categories", "api-token-or-jwt"},
	{"DELETE", "/api/categories/batch", "批量删除分类（其子分类自动升级为顶级）", "categories", "api-token-or-jwt"},
	{"PUT", "/api/categories/reorder", "分类排序（{parent_id, order}，仅同级兄弟内）", "categories", "api-token-or-jwt"},

	// 导入导出
	{"GET", "/api/export", "全量导出书签（含 favicon 内联）", "bookmarks", "api-token-or-jwt"},
	{"POST", "/api/import", "导入书签", "bookmarks", "api-token-or-jwt"},

	// AI 设置（付费额度 + 账号级配置，仅账号本人 JWT；agent 请用自身能力生成元数据）
	{"GET", "/api/ai-settings", "AI 配置摘要（provider/model/baseUrl/keyHint，密钥脱敏）", "ai", "jwt-only"},
	{"PUT", "/api/ai-settings", "保存 AI 配置（apiKey 写入即加密）", "ai", "jwt-only"},
	{"PUT", "/api/ai-settings/switch", "切换激活的 provider 配置", "ai", "jwt-only"},
	{"DELETE", "/api/ai-settings/config/{id}", "删除某个 provider 配置", "ai", "jwt-only"},
	{"POST", "/api/ai-settings/copy", "复制配置（含密钥）", "ai", "jwt-only"},
	{"POST", "/api/ai-test", "测试 AI provider 连通性（消耗一次最小调用）", "ai", "jwt-only"},
	{"POST", "/api/ai-meta", "AI 生成书签元数据（消耗付费额度；输入 {url, categories}，仅供界面内使用）", "ai", "jwt-only"},

	// Serper 搜索 key（账号级配置，测试消耗 Serper 额度）
	{"GET", "/api/serper-key", "Serper key 状态（keyHint 脱敏）", "serper", "jwt-only"},
	{"POST", "/api/serper-key", "保存 Serper key", "serper", "jwt-only"},
	{"POST", "/api/serper-key/test", "测试 Serper key 连通性", "serper", "jwt-only"},
	{"DELETE", "/api/serper-key", "删除 Serper key", "serper", "jwt-only"},

	// 用户偏好设置（跨设备同步）
	{"GET", "/api/settings/id-search-mode", "读 ID 搜索模式开关", "settings", "api-token-or-jwt"},
	{"PUT", "/api/settings/id-search-mode", "写 ID 搜索模式开关", "settings", "api-token-or-jwt"},

	// 备份与恢复（破坏性强，仅账号 JWT）
	{"GET", "/api/backups/settings", "读自动备份设置和状态", "backups", "jwt-only"},
	{"PUT", "/api/backups/settings", "更新备份频率和保留数量", "backups", "jwt-only"},
	{"GET", "/api/backups", "备份文件列表（元数据，不含绝对路径）", "backups", "jwt-only"},
	{"POST", "/api/backups/run", "立即创建当前数据库一致性快照", "backups", "jwt-only"},
	{"PATCH", "/api/backups/{id}", "修改备份显示名", "backups", "jwt-only"},
	{"DELETE", "/api/backups/{id}", "删除备份快照", "backups", "jwt-only"},
	{"GET", "/api/backups/{id}/preview", "预览备份内的书签/分类数量", "backups", "jwt-only"},
	{"POST", "/api/backups/{id}/restore", "恢复选中的书签/分类数据（破坏性）", "backups", "jwt-only"},

	// 工具
	{"GET", "/api/fetch-title", "抓取 URL 标题", "system", "api-token-or-jwt"},
	{"GET", "/api/favicon", "抓取站点图标（返回图片本体非 JSON；优质品牌 SVG 优先 → 站点 favicon → 第三方兜底）", "system", "api-token-or-jwt"},
	{"GET", "/api/stats", "统计（书签/分类总数）", "system", "api-token-or-jwt"},

	// ===== 仅 JWT（API Token 调返回 403，RequireJWT 保护）=====
	{"GET", "/api/tokens", "API Token 列表（脱敏）", "tokens", "jwt-only"},
	{"POST", "/api/tokens", "创建 API Token（明文仅返回一次）", "tokens", "jwt-only"},
	{"PUT", "/api/tokens/{id}", "改 Token 名", "tokens", "jwt-only"},
	{"DELETE", "/api/tokens/{id}", "撤销 Token", "tokens", "jwt-only"},
}

// buildOpenAPISpec 把端点元数据表编译成 OpenAPI 3.0 文档（map 结构，直接 json.Marshal）。
func buildOpenAPISpec() map[string]any {
	paths := map[string]map[string]any{}
	for _, ep := range apiEndpoints {
		pathItem, ok := paths[ep.Path]
		if !ok {
			pathItem = map[string]any{}
			paths[ep.Path] = pathItem
		}
		op := map[string]any{
			"summary": ep.Summary,
			"tags":    []string{ep.Tag},
		}
		switch ep.Auth {
		case "public":
			op["x-auth"] = "public"
		case "jwt-only":
			op["security"] = []map[string][]string{{"bearerAuth": {}}}
			op["x-auth"] = "jwt-only"
		default: // api-token-or-jwt
			op["security"] = []map[string][]string{{"bearerAuth": {}}}
			op["x-auth"] = "api-token-or-jwt"
		}
		pathItem[strings.ToLower(ep.Method)] = op
	}

	// 按 path 排序输出，spec 稳定可读
	sortedPaths := map[string]any{}
	pathKeys := make([]string, 0, len(paths))
	for k := range paths {
		pathKeys = append(pathKeys, k)
	}
	sort.Strings(pathKeys)
	for _, k := range pathKeys {
		sortedPaths[k] = paths[k]
	}

	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":       "Lumen API",
			"version":     "1.0",
			"description": "Lumen 书签管理服务 API。认证用 Authorization: Bearer <token>，token 可为 JWT（账号登录获得）或 msk_ API Token（设置界面创建）。x-auth 字段标注每个端点的认证要求：public / api-token-or-jwt / jwt-only（jwt-only 端点 API Token 调返回 403）。\n\n权限边界：msk_ API Token 用于书签/分类等数据对象的日常操作；账号安全、备份、AI/Serper 配置及一切消耗付费额度的端点（ai-meta / ai-test / serper-key/test）为账号本人（JWT）专属。持有 Token 的 agent 生成标题/描述/标签请使用自身能力，勿依赖服务端 AI。\n\n图标约定：给书签配图标时优先使用服务端图标管线 GET /api/favicon?url=<站点URL>（直接返回图片本体，按 x-icon-pipeline 的源优先级逐级回退）。两种写入方式：① 把 http(s) 图标 URL 直接放进书签的 favicon 字段，服务端自动下载并转存为 data URI；② 自行请求 /api/favicon 拿到图片后转为 data URI 写入 favicon 字段（上限 64KB）。",
		},
		"components": map[string]any{
			"securitySchemes": map[string]any{
				"bearerAuth": map[string]any{
					"type":        "http",
					"scheme":      "bearer",
					"description": "Bearer JWT 或 msk_ API Token",
				},
			},
		},
		// 图标源优先级（OpenAPI x- 扩展字段，/api/favicon 管线的真实实现顺序）：
		// 每个阶段内先试原始域名、再试剥掉子域名的主域名。
		"x-icon-pipeline": []map[string]any{
			{
				"stage":    1,
				"note":     "品牌图标（直出优质 SVG）",
				"sources":  []string{"theSVG（thesvg.org 品牌注册表，域名/品牌词映射）", "Simple Icons"},
				"response": "image/svg+xml",
			},
			{
				"stage":    2,
				"note":     "站点自身 favicon",
				"sources":  []string{"目标页 <link rel=icon> 解析", "常见路径（/favicon.ico 等）"},
				"response": "image/*",
			},
			{
				"stage":    3,
				"note":     "第三方服务并发兜底（取首个成功，6s 总超时）",
				"sources":  []string{"Google S2", "DuckDuckGo", "favicone", "favicon.im", "icon.horse", "Logo.dev"},
				"response": "image/*",
			},
		},
		"paths": sortedPaths,
	}
}

// handleOpenAPI GET /openapi.json —— 返回 OpenAPI 3.0 spec（需认证：API Token 或 JWT，匿名 401）。
func (s *Server) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// no-cache 协商缓存，spec 随端点变化即时生效（spec 需认证，见 main.go 路由注册）
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(buildOpenAPISpec())
}
