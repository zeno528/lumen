package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"lumen/server/db"
)

// newImportExportTestAPI 与 api_integration_test.go 的 newTestAPI 相同，
// 额外注册 /api/export 与 /api/import 路由（导入导出专用）。
func newImportExportTestAPI(t *testing.T) *testAPI {
	t.Helper()
	database, err := db.Connect(filepath.Join(t.TempDir(), "lumen-test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}

	srv := &Server{
		db:                database,
		config:            &Config{JWTSecret: "test-jwt-secret", Password: "test-password"},
		usedTickets:       make(map[string]time.Time),
		verifiedPasswords: make(map[string]time.Time),
		rateLimiters:      make(map[string]*ipRateLimiter),
	}
	if err := srv.initPasswordIfNeeded(); err != nil {
		t.Fatal(err)
	}

	r := chi.NewRouter()
	r.Get("/api/health", srv.handleHealth)
	r.Post("/api/auth/login", srv.handleLogin)
	r.Group(func(r chi.Router) {
		r.Use(AuthMiddleware(srv.config.JWTSecret, srv))
		r.Get("/api/auth/verify", srv.handleVerify)
		r.Put("/api/auth/password", srv.handleChangePassword)

		r.Get("/api/categories", srv.handleGetCategories)
		r.Post("/api/categories", srv.handleCreateCategory)
		r.Put("/api/categories/{id}", srv.handleUpdateCategory)
		r.Delete("/api/categories/{id}", srv.handleDeleteCategory)
		r.Post("/api/categories/merge", srv.handleMergeCategories)

		r.Get("/api/bookmarks", srv.handleGetBookmarks)
		r.Post("/api/bookmarks", srv.handleCreateBookmark)
		r.Put("/api/bookmarks/reorder", srv.handleReorderBookmarks)
		r.Delete("/api/bookmarks/batch", srv.handleBatchDeleteBookmarks)
		r.Put("/api/bookmarks/batch-move", srv.handleBatchMoveBookmarks)
		r.Put("/api/bookmarks/batch-tags", srv.handleBatchAddTags)
		r.Put("/api/bookmarks/{id}", srv.handleUpdateBookmark)
		r.Delete("/api/bookmarks/{id}", srv.handleDeleteBookmark)
		r.Patch("/api/bookmarks/{id}/favorite", srv.handleToggleFavorite)

		r.Get("/api/export", srv.handleExport)
		r.Post("/api/import", srv.handleImport)

		r.Group(func(r chi.Router) {
			r.Use(RequireJWT)
			r.Get("/api/tokens", srv.handleListTokens)
			r.Post("/api/tokens", srv.handleCreateToken)
		})
	})
	return &testAPI{handler: r}
}

// rawImport POST /api/import，body 为原始 JSON 字节（不走 payload marshal）。
func rawImport(t *testing.T, api *testAPI, token, mode string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/import"
	if mode != "" {
		path += "?mode=" + mode
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	api.handler.ServeHTTP(res, req)
	return res
}

type importSummary struct {
	Imported           int      `json:"imported"`
	Skipped            int      `json:"skipped"`
	ImportedIDs        []int64  `json:"imported_ids"`
	ImportedCategories []string `json:"imported_categories"`
	SkippedCategories  int      `json:"skipped_categories"`
}

func decodeImportSummary(t *testing.T, res *httptest.ResponseRecorder) importSummary {
	t.Helper()
	return decodeJSON[importSummary](t, res)
}

// ─────────────────────────────────────────────────────────────
// 导出 → 导入 往返：导出格式必须能被自身导入，且数据完整保留
// ─────────────────────────────────────────────────────────────
func TestExportImportRoundTrip(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	// 预置数据：父子分类 + 3 书签（一个无分类、一个带 tags/favorite/description）
	workID := createCategory(t, api, jwt, "Work")
	readingRes := api.request(t, http.MethodPost, "/api/categories", jwt, map[string]any{
		"name":      "Reading",
		"parent_id": workID,
	})
	requireStatus(t, readingRes, http.StatusCreated)
	readingID := decodeJSON[struct {
		Category Category `json:"category"`
	}](t, readingRes).Category.ID
	bookmarkID := createBookmark(t, api, jwt, "https://example.com/docs", "Docs", &workID)
	createBookmark(t, api, jwt, "https://example.com/article", "Article", &readingID)
	createBookmark(t, api, jwt, "https://example.com/nocat", "NoCat", nil)

	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/batch-tags", jwt, BatchTagsInput{IDs: []int64{bookmarkID}, Tags: []string{"ci", "docs"}}), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodPatch, "/api/bookmarks/"+strconv.FormatInt(bookmarkID, 10)+"/favorite", jwt, nil), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/"+strconv.FormatInt(bookmarkID, 10), jwt, map[string]string{"description": "updated desc"}), http.StatusOK)

	// 导出
	exportRes := api.request(t, http.MethodGet, "/api/export", jwt, nil)
	requireStatus(t, exportRes, http.StatusOK)
	var exported struct {
		Categories []Category `json:"categories"`
		Bookmarks  []Bookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(exportRes.Body.Bytes(), &exported); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if len(exported.Categories) != 2 {
		t.Fatalf("exported categories = %d, want 2", len(exported.Categories))
	}
	if len(exported.Bookmarks) != 3 {
		t.Fatalf("exported bookmarks = %d, want 3", len(exported.Bookmarks))
	}

	// overwrite 导入回同一个库（等价于「导出 → 清空 → 恢复」）
	imp := rawImport(t, api, jwt, "overwrite", exportRes.Body.Bytes())
	requireStatus(t, imp, http.StatusOK)
	summary := decodeImportSummary(t, imp)
	if summary.Imported != 3 || summary.Skipped != 0 {
		t.Fatalf("round-trip import summary = %+v, want imported=3 skipped=0", summary)
	}

	// 断言数据完整恢复
	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks")
	if len(bookmarks) != 3 {
		t.Fatalf("bookmarks after round-trip = %d, want 3", len(bookmarks))
	}
	var docs *Bookmark
	for i := range bookmarks {
		if bookmarks[i].Title == "Docs" {
			docs = &bookmarks[i]
		}
	}
	if docs == nil {
		t.Fatal("Docs bookmark missing after round-trip")
	}
	if docs.Description != "updated desc" {
		t.Fatalf("description lost: %q", docs.Description)
	}
	if !docs.IsFavorite {
		t.Fatal("favorite flag lost")
	}
	if !slices.Contains(docs.Tags, "ci") || !slices.Contains(docs.Tags, "docs") {
		t.Fatalf("tags lost: %+v", docs.Tags)
	}
	if docs.CategoryID == nil {
		t.Fatal("category mapping lost (Docs should keep Work category)")
	}

	// 分类映射：Docs 应指向名为 Work 的分类（按 name 映射，而非旧 ID）
	catsRes := api.request(t, http.MethodGet, "/api/categories", jwt, nil)
	requireStatus(t, catsRes, http.StatusOK)
	var cats struct {
		Categories []Category `json:"categories"`
	}
	if err := json.Unmarshal(catsRes.Body.Bytes(), &cats); err != nil {
		t.Fatalf("decode categories: %v", err)
	}
	var workCat *Category
	for i := range cats.Categories {
		if cats.Categories[i].Name == "Work" {
			workCat = &cats.Categories[i]
		}
	}
	if workCat == nil {
		t.Fatal("Work category missing after round-trip")
	}
	var readingCat *Category
	for i := range cats.Categories {
		if cats.Categories[i].Name == "Reading" {
			readingCat = &cats.Categories[i]
		}
	}
	if readingCat == nil || readingCat.ParentID == nil || *readingCat.ParentID != workCat.ID {
		t.Fatalf("Reading parent_id = %v, want Work id=%d", readingCat.ParentID, workCat.ID)
	}
	if *docs.CategoryID != workCat.ID {
		t.Fatalf("Docs category_id = %d, want %d (Work)", *docs.CategoryID, workCat.ID)
	}

	// 无分类书签保持无分类
	var noCat *Bookmark
	for i := range bookmarks {
		if bookmarks[i].Title == "NoCat" {
			noCat = &bookmarks[i]
		}
	}
	if noCat == nil || noCat.CategoryID != nil {
		t.Fatalf("NoCat should stay uncategorized: %+v", noCat)
	}
}

// ─────────────────────────────────────────────────────────────
// merge 模式：重复书签/分类跳过，新数据加入
// ─────────────────────────────────────────────────────────────
func TestImportMergeSkipsDuplicates(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	// 预置：分类 Work + 书签 https://example.com/docs
	createCategory(t, api, jwt, "Work")
	createBookmark(t, api, jwt, "https://example.com/docs", "Docs", nil)

	// 导入：同名分类 Work（跳过）+ 新分类 Reading；重复书签 docs（跳过）+ 新书签 new
	body := []byte(`{
		"categories": [
			{"id": 1, "name": "Work"},
			{"id": 2, "name": "Reading"}
		],
		"bookmarks": [
			{"id": 1, "url": "https://example.com/docs", "title": "Docs"},
			{"id": 2, "url": "https://example.com/new", "title": "New"}
		]
	}`)
	imp := rawImport(t, api, jwt, "", body)
	requireStatus(t, imp, http.StatusOK)
	summary := decodeImportSummary(t, imp)

	if summary.Imported != 1 || summary.Skipped != 1 {
		t.Fatalf("merge summary = %+v, want imported=1 skipped=1", summary)
	}
	if len(summary.ImportedCategories) != 1 || summary.ImportedCategories[0] != "Reading" {
		t.Fatalf("imported_categories = %+v, want [Reading]", summary.ImportedCategories)
	}
	if summary.SkippedCategories != 1 {
		t.Fatalf("skipped_categories = %d, want 1 (Work exists)", summary.SkippedCategories)
	}

	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks")
	if len(bookmarks) != 2 {
		t.Fatalf("bookmarks = %d, want 2", len(bookmarks))
	}
}

// ─────────────────────────────────────────────────────────────
// overwrite 模式：清空旧数据再导入
// ─────────────────────────────────────────────────────────────
func TestImportOverwriteReplacesAll(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	createCategory(t, api, jwt, "Old")
	createBookmark(t, api, jwt, "https://example.com/old", "Old", nil)

	body := []byte(`{
		"categories": [{"id": 9, "name": "Fresh"}],
		"bookmarks": [{"id": 9, "url": "https://example.com/fresh", "title": "Fresh"}]
	}`)
	imp := rawImport(t, api, jwt, "overwrite", body)
	requireStatus(t, imp, http.StatusOK)
	summary := decodeImportSummary(t, imp)
	if summary.Imported != 1 || summary.Skipped != 0 {
		t.Fatalf("overwrite summary = %+v, want imported=1 skipped=0", summary)
	}

	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks")
	if len(bookmarks) != 1 || bookmarks[0].Title != "Fresh" {
		t.Fatalf("overwrite left stale data: %+v", bookmarks)
	}
	catsRes := api.request(t, http.MethodGet, "/api/categories", jwt, nil)
	requireStatus(t, catsRes, http.StatusOK)
	var cats struct {
		Categories []Category `json:"categories"`
	}
	if err := json.Unmarshal(catsRes.Body.Bytes(), &cats); err != nil {
		t.Fatalf("decode categories: %v", err)
	}
	if len(cats.Categories) != 1 || cats.Categories[0].Name != "Fresh" {
		t.Fatalf("overwrite categories = %+v, want only Fresh", cats.Categories)
	}
}

// ─────────────────────────────────────────────────────────────
// 前端 localStorage 格式：categoryId（非 category_id）+ 数字字符串 ID
// ─────────────────────────────────────────────────────────────
func TestImportFrontendLocalStorageFormat(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	body := []byte(`{
		"categories": [
			{"id": "all", "name": "全部", "isDefault": true},
			{"id": "2", "name": "AI", "icon": "fa-robot", "color": "#3B82F6", "sort_order": 0}
		],
		"bookmarks": [
			{"id": "10", "url": "https://openai.com", "title": "OpenAI", "categoryId": "2", "tags": ["ai"]}
		]
	}`)
	imp := rawImport(t, api, jwt, "", body)
	requireStatus(t, imp, http.StatusOK)
	summary := decodeImportSummary(t, imp)
	if summary.Imported != 1 || summary.Skipped != 0 {
		t.Fatalf("import summary = %+v, want imported=1 skipped=0", summary)
	}
	// 'all' 虚拟分类被跳过，只新增 AI
	if len(summary.ImportedCategories) != 1 || summary.ImportedCategories[0] != "AI" {
		t.Fatalf("imported_categories = %+v, want [AI]", summary.ImportedCategories)
	}

	// 书签应挂到 AI 分类，tags 保留
	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks")
	if len(bookmarks) != 1 || bookmarks[0].CategoryID == nil {
		t.Fatalf("bookmark category mapping failed: %+v", bookmarks)
	}
	if !slices.Contains(bookmarks[0].Tags, "ai") {
		t.Fatalf("tags lost: %+v", bookmarks[0].Tags)
	}
	catsRes := api.request(t, http.MethodGet, "/api/categories", jwt, nil)
	requireStatus(t, catsRes, http.StatusOK)
	var cats struct {
		Categories []Category `json:"categories"`
	}
	if err := json.Unmarshal(catsRes.Body.Bytes(), &cats); err != nil {
		t.Fatalf("decode categories: %v", err)
	}
	if len(cats.Categories) != 1 || cats.Categories[0].Name != "AI" {
		t.Fatalf("categories = %+v, want only AI (no 'all')", cats.Categories)
	}
	if *bookmarks[0].CategoryID != cats.Categories[0].ID {
		t.Fatalf("bookmark category_id = %d, want %d", *bookmarks[0].CategoryID, cats.Categories[0].ID)
	}
}

// ─────────────────────────────────────────────────────────────
// URL 归一化去重：导入时大小写/斜杠/缺协议归一化后视为重复
// ─────────────────────────────────────────────────────────────
func TestImportURLNormalizationDedup(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	createBookmark(t, api, jwt, "https://example.com/docs/", "Docs", nil)

	// 同一 URL 的「脏」写法：大写、双斜杠、缺 https:// → 归一化后应跳过
	body := []byte(`{
		"categories": [],
		"bookmarks": [
			{"id": 1, "url": "HTTPS://Example.COM/docs//", "title": "Dirty"}
		]
	}`)
	imp := rawImport(t, api, jwt, "", body)
	requireStatus(t, imp, http.StatusOK)
	summary := decodeImportSummary(t, imp)
	if summary.Imported != 0 || summary.Skipped != 1 {
		t.Fatalf("normalization dedup summary = %+v, want imported=0 skipped=1", summary)
	}

	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks")
	if len(bookmarks) != 1 || bookmarks[0].Title != "Docs" {
		t.Fatalf("dirty duplicate should not be imported: %+v", bookmarks)
	}
}

// ─────────────────────────────────────────────────────────────
// gzip 压缩请求体
// ─────────────────────────────────────────────────────────────
func TestImportGzipBody(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	payload := []byte(`{"categories":[{"id":1,"name":"Gz"}],"bookmarks":[{"id":1,"url":"https://example.com/gz","title":"Gz"}]}`)
	if _, err := gz.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/import", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("Authorization", "Bearer "+jwt)
	res := httptest.NewRecorder()
	api.handler.ServeHTTP(res, req)
	requireStatus(t, res, http.StatusOK)
	summary := decodeImportSummary(t, res)
	if summary.Imported != 1 {
		t.Fatalf("gzip import summary = %+v, want imported=1", summary)
	}
}

// ─────────────────────────────────────────────────────────────
// 无法识别的格式 → 400
// ─────────────────────────────────────────────────────────────
func TestImportInvalidFormat(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	imp := rawImport(t, api, jwt, "", []byte(`{"foo": "bar"}`))
	requireStatus(t, imp, http.StatusBadRequest)

	imp = rawImport(t, api, jwt, "", []byte(`not json at all`))
	requireStatus(t, imp, http.StatusBadRequest)
}

// ─────────────────────────────────────────────────────────────
// 批量导出：?ids=1,2 只导出选中的书签
// ─────────────────────────────────────────────────────────────
func TestExportSelectedIDs(t *testing.T) {
	api := newImportExportTestAPI(t)
	jwt := login(t, api)

	id1 := createBookmark(t, api, jwt, "https://example.com/one", "One", nil)
	id2 := createBookmark(t, api, jwt, "https://example.com/two", "Two", nil)
	createBookmark(t, api, jwt, "https://example.com/three", "Three", nil)

	res := api.request(t, http.MethodGet, "/api/export?ids="+strconv.FormatInt(id1, 10)+","+strconv.FormatInt(id2, 10), jwt, nil)
	requireStatus(t, res, http.StatusOK)
	var exported struct {
		Categories []Category `json:"categories"`
		Bookmarks  []Bookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &exported); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if len(exported.Bookmarks) != 2 {
		t.Fatalf("selected export bookmarks = %d, want 2", len(exported.Bookmarks))
	}
	// 分类应全量导出（选书签不选分类）
	if len(exported.Categories) != 0 {
		t.Fatalf("categories = %d, want 0 (no categories created)", len(exported.Categories))
	}

	// 非法 ids 参数 → 400
	bad := api.request(t, http.MethodGet, "/api/export?ids=abc", jwt, nil)
	requireStatus(t, bad, http.StatusBadRequest)
}

// ─────────────────────────────────────────────────────────────
// parseIDList 单元测试
// ─────────────────────────────────────────────────────────────
func TestParseIDList(t *testing.T) {
	ids, err := parseIDList("1,2,3")
	if err != nil || len(ids) != 3 || ids[0] != 1 || ids[1] != 2 || ids[2] != 3 {
		t.Fatalf("parseIDList(1,2,3) = %v, %v", ids, err)
	}

	ids, err = parseIDList(" 1 , 2 ")
	if err != nil || len(ids) != 2 {
		t.Fatalf("parseIDList with spaces = %v, %v", ids, err)
	}

	// 空段忽略
	ids, err = parseIDList("1,,3")
	if err != nil || len(ids) != 2 || ids[0] != 1 || ids[1] != 3 {
		t.Fatalf("parseIDList(1,,3) = %v, %v", ids, err)
	}

	// 全空 → 空列表，无错误
	ids, err = parseIDList("")
	if err != nil || len(ids) != 0 {
		t.Fatalf("parseIDList('') = %v, %v", ids, err)
	}

	// 非法数字 → 报错
	if _, err = parseIDList("1,abc"); err == nil {
		t.Fatal("parseIDList(1,abc) should error")
	}
}
