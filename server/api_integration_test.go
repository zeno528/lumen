package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"

	"lumen/server/db"
)

type testAPI struct {
	handler   http.Handler
	db        *sql.DB
	backupDir string
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	backupDir := filepath.Join(t.TempDir(), "backups")
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
		config:            &Config{JWTSecret: "test-jwt-secret", Password: "test-password", BackupDir: backupDir},
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
		// 与 main.go 共用同一份路由表（routes.go），杜绝测试/生产路由漂移
		srv.registerAuthedRoutes(r)
	})
	return &testAPI{handler: r, db: database, backupDir: backupDir}
}

func (api *testAPI) request(t *testing.T, method, path, token string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	var body *bytes.Reader
	if payload == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, body)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	api.handler.ServeHTTP(res, req)
	return res
}

func requireStatus(t *testing.T, res *httptest.ResponseRecorder, want int) {
	t.Helper()
	if res.Code != want {
		t.Fatalf("status = %d, want %d: %s", res.Code, want, res.Body.String())
	}
}

func decodeJSON[T any](t *testing.T, res *httptest.ResponseRecorder) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(res.Body.Bytes(), &value); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, res.Body.String())
	}
	return value
}

func login(t *testing.T, api *testAPI) string {
	t.Helper()
	res := api.request(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"username": "admin",
		"password": "test-password",
	})
	requireStatus(t, res, http.StatusOK)
	return decodeJSON[struct {
		Token string `json:"token"`
	}](t, res).Token
}

func createCategory(t *testing.T, api *testAPI, token, name string) int64 {
	t.Helper()
	res := api.request(t, http.MethodPost, "/api/categories", token, map[string]string{"name": name})
	requireStatus(t, res, http.StatusCreated)
	return decodeJSON[struct {
		Category Category `json:"category"`
	}](t, res).Category.ID
}

func createBookmark(t *testing.T, api *testAPI, token, url, title string, categoryID *int64) int64 {
	t.Helper()
	res := api.request(t, http.MethodPost, "/api/bookmarks", token, BookmarkInput{
		URL:        url,
		Title:      title,
		CategoryID: categoryID,
	})
	requireStatus(t, res, http.StatusCreated)
	return decodeJSON[struct {
		Bookmark Bookmark `json:"bookmark"`
	}](t, res).Bookmark.ID
}

func listBookmarks(t *testing.T, api *testAPI, token, path string) []Bookmark {
	t.Helper()
	res := api.request(t, http.MethodGet, path, token, nil)
	requireStatus(t, res, http.StatusOK)
	return decodeJSON[struct {
		Bookmarks []Bookmark `json:"bookmarks"`
	}](t, res).Bookmarks
}

func TestAPIAuthenticationAndTokenBoundary(t *testing.T) {
	api := newTestAPI(t)
	requireStatus(t, api.request(t, http.MethodGet, "/api/bookmarks", "", nil), http.StatusUnauthorized)
	requireStatus(t, api.request(t, http.MethodPost, "/api/auth/login", "", map[string]string{"username": "admin", "password": "wrong"}), http.StatusUnauthorized)

	jwt := login(t, api)
	requireStatus(t, api.request(t, http.MethodGet, "/api/auth/verify", jwt, nil), http.StatusOK)

	res := api.request(t, http.MethodPost, "/api/tokens", jwt, map[string]string{"name": "CI"})
	requireStatus(t, res, http.StatusOK)
	apiToken := decodeJSON[struct {
		Token string `json:"token"`
	}](t, res).Token
	if apiToken == "" {
		t.Fatal("API token is empty")
	}
	requireStatus(t, api.request(t, http.MethodGet, "/api/bookmarks", apiToken, nil), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodGet, "/api/tokens", apiToken, nil), http.StatusForbidden)
}

func TestUploadedAvatarRoundTrip(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	image := "data:image/webp;base64," + base64.StdEncoding.EncodeToString([]byte("RIFF\x04\x00\x00\x00WEBP"))

	res := api.request(t, http.MethodPut, "/api/auth/avatar", jwt, map[string]string{
		"avatar":      "custom:upload",
		"avatarColor": "#f59e0b",
		"avatarImage": image,
	})
	requireStatus(t, res, http.StatusOK)

	got := decodeJSON[struct {
		Avatar      string `json:"avatar"`
		AvatarImage string `json:"avatarImage"`
	}](t, api.request(t, http.MethodGet, "/api/auth/avatar", jwt, nil))
	if got.Avatar != "custom:upload" || got.AvatarImage != image {
		t.Fatalf("avatar = %#v, want uploaded avatar and image", got)
	}
}

func TestUploadedAvatarAcceptsPNGFallback(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	image := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\n"))
	res := api.request(t, http.MethodPut, "/api/auth/avatar", jwt, map[string]string{
		"avatar":      "custom:upload",
		"avatarImage": image,
	})
	requireStatus(t, res, http.StatusOK)
}

func TestUploadedAvatarRejectsMismatchedImageType(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	res := api.request(t, http.MethodPut, "/api/auth/avatar", jwt, map[string]string{
		"avatar":      "custom:upload",
		"avatarImage": "data:image/webp;base64,iVBORw0KGgo=",
	})
	requireStatus(t, res, http.StatusBadRequest)
}

func TestPasswordChangeInvalidatesExistingJWT(t *testing.T) {
	api := newTestAPI(t)
	oldJWT := login(t, api)
	requireStatus(t, api.request(t, http.MethodPut, "/api/auth/password", oldJWT, map[string]string{
		"currentPassword": "test-password",
		"newPassword":     "new-test-password",
	}), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodGet, "/api/auth/verify", oldJWT, nil), http.StatusUnauthorized)

	res := api.request(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"username": "admin",
		"password": "new-test-password",
	})
	requireStatus(t, res, http.StatusOK)
}

func TestVerifyPassword(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	requireStatus(t, api.request(t, http.MethodPost, "/api/auth/verify-password", jwt, map[string]string{"password": "test-password"}), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodPost, "/api/auth/verify-password", jwt, map[string]string{"password": "wrong"}), http.StatusUnauthorized)
	requireStatus(t, api.request(t, http.MethodPost, "/api/auth/verify-password", jwt, map[string]string{}), http.StatusBadRequest)
}

func TestPasswordVerifyWindowKeepsCurrentSession(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)

	// 登录即视为密码验证（10 分钟时效）→ 状态接口返回 verified，改账号可不带 currentPassword
	status := decodeJSON[struct {
		Verified bool `json:"verified"`
	}](t, api.request(t, http.MethodGet, "/api/auth/password-verified", jwt, nil))
	if !status.Verified {
		t.Fatalf("登录后应为已验证状态，got %+v", status)
	}

	// 不带当前密码改账号：成功且返回新 token（当前会话保留）
	res := api.request(t, http.MethodPut, "/api/auth/password", jwt, map[string]string{
		"username": "new-admin", // 只改账号：newPassword 不传，后端空则不动密码哈希
	})
	requireStatus(t, res, http.StatusOK)
	newJWT := decodeJSON[struct {
		Token string `json:"token"`
	}](t, res).Token
	if newJWT == "" {
		t.Fatal("响应缺少新 token")
	}

	// 新 token 可用、旧 token（其他设备）已失效
	requireStatus(t, api.request(t, http.MethodGet, "/api/auth/verify", newJWT, nil), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodGet, "/api/auth/verify", jwt, nil), http.StatusUnauthorized)

	// 验证时效继承：改完账号后直接改密码，无需再验证
	res2 := api.request(t, http.MethodPut, "/api/auth/password", newJWT, map[string]string{
		"newPassword": "brand-new-password",
	})
	requireStatus(t, res2, http.StatusOK)
	newJWT2 := decodeJSON[struct {
		Token string `json:"token"`
	}](t, res2).Token

	// 错误当前密码仍被拒绝
	requireStatus(t, api.request(t, http.MethodPut, "/api/auth/password", newJWT2, map[string]string{
		"currentPassword": "wrong",
		"newPassword":     "whatever123",
	}), http.StatusUnauthorized)
}

func TestChangeUsernameOnlyKeepsPassword(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api) // 登录即视为密码验证

	// 只改账号、不传新密码：不应再报"请填写完整"，且密码保持不变
	requireStatus(t, api.request(t, http.MethodPut, "/api/auth/password", jwt, map[string]string{
		"username": "new-admin",
	}), http.StatusOK)

	requireStatus(t, api.request(t, http.MethodPost, "/api/auth/login", "", map[string]string{
		"username": "new-admin",
		"password": "test-password",
	}), http.StatusOK)
}

func TestOldTokenWithoutJtiKeepsVerifyWindow(t *testing.T) {
	api := newTestAPI(t)
	// 构造无 jti 的"旧" token（模拟 jti 功能上线前签发的会话）
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, JWTClaims{
		TokenVersion: 0,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "lumen",
		},
	}).SignedString([]byte("test-jwt-secret"))
	if err != nil {
		t.Fatal(err)
	}

	// 初始未验证
	status := decodeJSON[struct {
		Verified bool `json:"verified"`
	}](t, api.request(t, http.MethodGet, "/api/auth/password-verified", signed, nil))
	if status.Verified {
		t.Fatal("新会话不应为已验证状态")
	}

	// 验证一次后，同一旧 token 保持已验证
	requireStatus(t, api.request(t, http.MethodPost, "/api/auth/verify-password", signed, map[string]string{"password": "test-password"}), http.StatusOK)
	status = decodeJSON[struct {
		Verified bool `json:"verified"`
	}](t, api.request(t, http.MethodGet, "/api/auth/password-verified", signed, nil))
	if !status.Verified {
		t.Fatal("验证一次后应保持已验证状态")
	}
}

func TestBookmarkAndCategoryLifecycle(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	categoryID := createCategory(t, api, jwt, "Work")
	// 两级层级引入同级同名约束：同父下不允许重名（不同父可重名）
	requireStatus(t, api.request(t, http.MethodPost, "/api/categories", jwt, map[string]string{"name": "Work"}), http.StatusConflict)

	bookmarkID := createBookmark(t, api, jwt, "HTTPS://Example.COM/docs//", "Docs", &categoryID)
	requireStatus(t, api.request(t, http.MethodPost, "/api/bookmarks", jwt, BookmarkInput{URL: "example.com/docs/", Title: "Duplicate"}), http.StatusConflict)

	res := api.request(t, http.MethodPut, "/api/bookmarks/"+strconv.FormatInt(bookmarkID, 10), jwt, map[string]string{"description": "updated"})
	requireStatus(t, res, http.StatusOK)
	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks")
	if len(bookmarks) != 1 || bookmarks[0].Title != "Docs" || bookmarks[0].Description != "updated" || bookmarks[0].URL != "https://example.com/docs/" {
		t.Fatalf("partial update did not preserve bookmark fields: %+v", bookmarks)
	}

	requireStatus(t, api.request(t, http.MethodPatch, "/api/bookmarks/"+strconv.FormatInt(bookmarkID, 10)+"/favorite", jwt, nil), http.StatusOK)
	if !listBookmarks(t, api, jwt, "/api/bookmarks")[0].IsFavorite {
		t.Fatal("bookmark was not marked as favorite")
	}
	requireStatus(t, api.request(t, http.MethodDelete, "/api/categories/"+strconv.FormatInt(categoryID, 10), jwt, nil), http.StatusOK)
	if listBookmarks(t, api, jwt, "/api/bookmarks")[0].CategoryID != nil {
		t.Fatal("deleting a category must unassign its bookmarks")
	}
	requireStatus(t, api.request(t, http.MethodDelete, "/api/bookmarks/"+strconv.FormatInt(bookmarkID, 10), jwt, nil), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodDelete, "/api/bookmarks/"+strconv.FormatInt(bookmarkID, 10), jwt, nil), http.StatusNotFound)
}

func TestCategoryHierarchy(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)

	// 父分类 + 子分类：创建成功且带 parent_id
	parentID := createCategory(t, api, jwt, "Parent")
	res := api.request(t, http.MethodPost, "/api/categories", jwt, map[string]any{"name": "Child", "parent_id": parentID})
	requireStatus(t, res, http.StatusCreated)
	child := decodeJSON[struct {
		Category Category `json:"category"`
	}](t, res).Category
	if child.ParentID == nil || *child.ParentID != parentID {
		t.Fatal("child category must carry parent_id")
	}

	// 两级封顶：给子分类再挂子分类 → 409
	requireStatus(t, api.request(t, http.MethodPost, "/api/categories", jwt, map[string]any{"name": "Grandchild", "parent_id": child.ID}), http.StatusConflict)

	// 同父下重名 → 409；不同父下重名 → 201
	requireStatus(t, api.request(t, http.MethodPost, "/api/categories", jwt, map[string]any{"name": "Child", "parent_id": parentID}), http.StatusConflict)
	otherID := createCategory(t, api, jwt, "Other")
	requireStatus(t, api.request(t, http.MethodPost, "/api/categories", jwt, map[string]any{"name": "Child", "parent_id": otherID}), http.StatusCreated)

	// 把有子分类的父分类降级为子分类 → 409
	requireStatus(t, api.request(t, http.MethodPut, "/api/categories/"+strconv.FormatInt(parentID, 10), jwt,
		map[string]any{"name": "Parent", "parent_id": otherID}), http.StatusConflict)

	// 排序只在同级兄弟内：跨级 → 409，同级 → 200
	requireStatus(t, api.request(t, http.MethodPut, "/api/categories/reorder", jwt, ReorderInput{Order: []int64{parentID, child.ID}}), http.StatusConflict)
	requireStatus(t, api.request(t, http.MethodPut, "/api/categories/reorder", jwt, ReorderInput{ParentID: &parentID, Order: []int64{child.ID}}), http.StatusOK)
	requireStatus(t, api.request(t, http.MethodPut, "/api/categories/reorder", jwt, ReorderInput{Order: []int64{otherID, parentID}}), http.StatusOK)

	// 删除父分类（keep 模式）：子分类升级为顶级
	requireStatus(t, api.request(t, http.MethodDelete, "/api/categories/"+strconv.FormatInt(parentID, 10), jwt, nil), http.StatusOK)
	categories := decodeJSON[struct {
		Categories []Category `json:"categories"`
	}](t, api.request(t, http.MethodGet, "/api/categories", jwt, nil)).Categories
	for _, c := range categories {
		if c.ID != child.ID {
			continue
		}
		if c.ParentID != nil {
			t.Fatalf("child category must be promoted to top-level after parent deletion, got parent_id=%d", *c.ParentID)
		}
		return
	}
	t.Fatal("child category missing after parent deletion")
}

func TestBookmarkBatchOperations(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	sourceID := createCategory(t, api, jwt, "Source")
	targetID := createCategory(t, api, jwt, "Target")
	firstID := createBookmark(t, api, jwt, "https://example.com/one", "One", &sourceID)
	secondID := createBookmark(t, api, jwt, "https://example.com/two", "Two", &sourceID)
	ids := []int64{firstID, secondID}

	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/batch-move", jwt, BatchMoveInput{IDs: ids, CategoryID: &targetID}), http.StatusOK)
	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10))
	if len(bookmarks) != 2 {
		t.Fatalf("moved bookmarks = %d, want 2", len(bookmarks))
	}
	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/batch-tags", jwt, BatchTagsInput{IDs: ids, Tags: []string{"ci", "regression"}}), http.StatusOK)
	for _, bookmark := range listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10)) {
		if !slices.Contains(bookmark.Tags, "ci") || !slices.Contains(bookmark.Tags, "regression") {
			t.Fatalf("tags were not merged for bookmark %+v", bookmark)
		}
	}

	requireStatus(t, api.request(t, http.MethodDelete, "/api/bookmarks/batch", jwt, BatchDeleteInput{IDs: ids}), http.StatusOK)
	if got := listBookmarks(t, api, jwt, "/api/bookmarks"); len(got) != 0 {
		t.Fatalf("remaining bookmarks = %d, want 0", len(got))
	}
}

func TestBatchMoveBookmarksInsertsBeforeTargetAndKeepsSelectionOrder(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	sourceID := createCategory(t, api, jwt, "Source")
	targetID := createCategory(t, api, jwt, "Target")
	sourceFirstID := createBookmark(t, api, jwt, "https://example.com/source-first", "Source first", &sourceID)
	sourceSecondID := createBookmark(t, api, jwt, "https://example.com/source-second", "Source second", &sourceID)
	targetFirstID := createBookmark(t, api, jwt, "https://example.com/target-first", "Target first", &targetID)
	targetSecondID := createBookmark(t, api, jwt, "https://example.com/target-second", "Target second", &targetID)

	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/batch-move", jwt, BatchMoveInput{
		IDs:              []int64{sourceFirstID, sourceSecondID},
		CategoryID:       &targetID,
		TargetBookmarkID: &targetSecondID,
		Position:         "before",
	}), http.StatusOK)

	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10))
	got := make([]int64, len(bookmarks))
	for i, bookmark := range bookmarks {
		got[i] = bookmark.ID
	}
	want := []int64{targetFirstID, sourceFirstID, sourceSecondID, targetSecondID}
	if !slices.Equal(got, want) {
		t.Fatalf("target order = %v, want %v", got, want)
	}
}

// 移动只 bump 被移动书签的 updated_at；目标分类原住民不刷新（favicon_version 兜底取 updated_at，
// 无差别刷新会让整个分类的图标缓存失效，切过去图标全闪）
func TestBatchMoveBookmarksKeepsResidentUpdatedAt(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	sourceID := createCategory(t, api, jwt, "Source")
	targetID := createCategory(t, api, jwt, "Target")
	movedID := createBookmark(t, api, jwt, "https://example.com/moved", "Moved", &sourceID)
	residentID := createBookmark(t, api, jwt, "https://example.com/resident", "Resident", &targetID)

	before := listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10))
	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/batch-move", jwt, BatchMoveInput{IDs: []int64{movedID}, CategoryID: &targetID}), http.StatusOK)

	var beforeUpdatedAt string
	for _, b := range before {
		if b.ID == residentID {
			beforeUpdatedAt = b.UpdatedAt
		}
	}
	after := listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10))
	for _, b := range after {
		if b.ID == residentID && b.UpdatedAt != beforeUpdatedAt {
			t.Fatalf("resident updated_at changed: %q -> %q", beforeUpdatedAt, b.UpdatedAt)
		}
	}
}

func TestBookmarkCategoryUpdateAppendsToTarget(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	sourceID := createCategory(t, api, jwt, "Source")
	targetID := createCategory(t, api, jwt, "Target")
	movedID := createBookmark(t, api, jwt, "https://example.com/moved", "Moved", &sourceID)
	firstTargetID := createBookmark(t, api, jwt, "https://example.com/first-target", "First target", &targetID)
	secondTargetID := createBookmark(t, api, jwt, "https://example.com/second-target", "Second target", &targetID)

	requireStatus(t, api.request(t, http.MethodPut, "/api/bookmarks/"+strconv.FormatInt(movedID, 10), jwt, map[string]any{"category_id": targetID}), http.StatusOK)

	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10))
	got := []int64{bookmarks[0].ID, bookmarks[1].ID, bookmarks[2].ID}
	want := []int64{firstTargetID, secondTargetID, movedID}
	if !slices.Equal(got, want) {
		t.Fatalf("target category order = %v, want %v", got, want)
	}
}

func TestCategoryMergeMovesBookmarks(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	sourceID := createCategory(t, api, jwt, "Reading")
	targetID := createCategory(t, api, jwt, "Archive")
	createBookmark(t, api, jwt, "https://example.com/article", "Article", &sourceID)

	requireStatus(t, api.request(t, http.MethodPost, "/api/categories/merge", jwt, MergeCategoriesInput{
		SourceIDs: []int64{sourceID},
		TargetID:  targetID,
	}), http.StatusOK)
	bookmarks := listBookmarks(t, api, jwt, "/api/bookmarks?category="+strconv.FormatInt(targetID, 10))
	if len(bookmarks) != 1 || bookmarks[0].CategoryID == nil || *bookmarks[0].CategoryID != targetID {
		t.Fatalf("merge did not move bookmark to target category: %+v", bookmarks)
	}
	requireStatus(t, api.request(t, http.MethodPost, "/api/categories/merge", jwt, MergeCategoriesInput{
		SourceIDs: []int64{targetID},
		TargetID:  targetID,
	}), http.StatusBadRequest)
}
