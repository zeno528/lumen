package main

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// resolveFavicon 将外部 URL 转为 data URI（永久存储），下载失败返回错误
func resolveFavicon(raw string) (string, error) {
	if strings.HasPrefix(raw, "data:") {
		// SVG data URI 入库前归一化（前端 fetchFaviconDataUri 直存路径）；非 SVG 原样
		return normalizeSVGDataURI(raw), nil
	}
	if !strings.HasPrefix(raw, "http") {
		return raw, nil // 其他格式直接存
	}
	if !isValidURL(raw) {
		return "", fmt.Errorf("图标 URL 不安全（禁止内网/非 http(s)）")
	}
	resp, err := httpClient.Get(raw)
	if err != nil {
		return "", fmt.Errorf("图标下载失败: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("图标下载失败: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	if err != nil {
		return "", fmt.Errorf("图标读取失败: %v", err)
	}
	// 优先用魔术字节嗅探真实格式：第三方 favicon 服务常返回不准的 Content-Type
	//（如把 PNG 标成 image/x-icon），浏览器看魔术字节能渲染但 data URI 标签会错。
	// 嗅探不出时 fallback 到 HTTP Content-Type → 扩展名 → 默认 png。
	ct := sniffImageMIME(data)
	if ct == "" {
		ct = resp.Header.Get("Content-Type")
	}
	if ct == "" {
		ct = mime.TypeByExtension(raw)
	}
	if ct == "" {
		ct = "image/png"
	}
	if strings.Contains(ct, "svg") {
		data = normalizeSVG(data)
		return "data:" + ct + "," + url.QueryEscape(string(data)), nil
	}
	return "data:" + ct + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// handleGetBookmarks GET /api/bookmarks?category=all&search=&page=1&limit=50
func (s *Server) handleGetBookmarks(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")
	search := r.URL.Query().Get("search")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 50000 {
		limit = 50000
	}
	offset := (page - 1) * limit

	query := "SELECT b.id, b.url, b.title, COALESCE(b.description, ''), b.category_id, COALESCE(b.tags, '[]'), '' AS favicon, CASE WHEN b.favicon != '' THEN 1 ELSE 0 END AS has_favicon, CASE WHEN b.favicon != '' THEN COALESCE(NULLIF(b.favicon_version, ''), b.updated_at) ELSE '' END AS favicon_version, b.sort_order, COALESCE(b.is_favorite, 0), COALESCE(b.created_at, ''), COALESCE(b.updated_at, '') FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id"
	countQuery := "SELECT COUNT(*) FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id"
	var args []any
	var conditions []string

	if category != "" && category != "all" {
		catID, err := strconv.ParseInt(category, 10, 64)
		if err == nil {
			conditions = append(conditions, "b.category_id = ?")
			args = append(args, catID)
		}
	}

	for _, term := range strings.Fields(search) {
		searchPattern := "%" + strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(term) + "%"
		conditions = append(conditions, "(b.title LIKE ? ESCAPE '\\' OR b.url LIKE ? ESCAPE '\\' OR b.description LIKE ? ESCAPE '\\' OR b.tags LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')")
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	if len(conditions) > 0 {
		where := " WHERE " + strings.Join(conditions, " AND ")
		query += where
		countQuery += where
	}

	// 总数
	var total int
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		log.Printf("查询书签总数失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}

	// 分页查询
	query += " ORDER BY b.sort_order, b.id DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		log.Printf("查询书签失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	bookmarks := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		var tagsStr string
		if err := rows.Scan(&b.ID, &b.URL, &b.Title, &b.Description, &b.CategoryID, &tagsStr, &b.Favicon, &b.HasFavicon, &b.FaviconVersion, &b.SortOrder, &b.IsFavorite, &b.CreatedAt, &b.UpdatedAt); err != nil {
			log.Printf("扫描书签行失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "数据读取失败"})
			return
		}
		json.Unmarshal([]byte(tagsStr), &b.Tags)
		if b.Tags == nil {
			b.Tags = []string{}
		}
		bookmarks = append(bookmarks, b)
	}
	if err := rows.Err(); err != nil {
		log.Printf("遍历书签失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "数据读取失败"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"bookmarks": bookmarks,
		"total":     total,
	})
}

// handleCreateBookmark POST /api/bookmarks
func (s *Server) handleCreateBookmark(w http.ResponseWriter, r *http.Request) {
	newFaviconVersion := func(value string) string {
		if value == "" {
			return ""
		}
		return strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	}

	var input BookmarkInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 限制
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if input.URL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "URL 不能为空"})
		return
	}
	// 入库前规范化（末尾 /、scheme/host 小写、合并连续 /），与前端 normalizeUrl 行为对齐，
	// 防止前端绕过（如旧版本 / 直接调 API）导致数据库存非规范化 URL。
	input.URL = normalizeURL(input.URL)
	if input.Title == "" {
		input.Title = input.URL
	}

	// favicon 超 64KB 不入库：前端已 canvas 64×64 压缩，正常 <10KB，超限多为异常大图。
	// 创建时无原值可保留只能清空（更新时见下文保留原值，避免丢已有图标）--语义差异源于有无原值，非 bug。
	if len(input.Favicon) > 65536 {
		log.Printf("favicon 超限丢弃（创建）, size=%d", len(input.Favicon))
		input.Favicon = ""
	}
	// favicon 外部 URL 自动转 data URI 永久存储（与 PUT 一致，防 http URL 进 DB
	// 导致前端 <img> 走后端 http.Get 实时代理抓取，每次 175ms+ 造成首屏图标闪烁）
	if strings.HasPrefix(input.Favicon, "http") {
		resolved, err := resolveFavicon(input.Favicon)
		if err != nil {
			log.Printf("favicon 下载失败（创建）, 已丢弃")
			input.Favicon = ""
		} else {
			input.Favicon = resolved
		}
	}

	tagsJSON, _ := json.Marshal(input.Tags)
	if input.Tags == nil {
		tagsJSON = []byte("[]")
	}

	// 获取最大 sort_order
	var maxOrder sql.NullInt64
	if err := s.db.QueryRow("SELECT MAX(sort_order) FROM bookmarks").Scan(&maxOrder); err != nil {
		log.Printf("获取书签最大排序失败: %v", err)
	}
	newOrder := 0
	if maxOrder.Valid {
		newOrder = int(maxOrder.Int64) + 1
	}

	faviconVersion := newFaviconVersion(input.Favicon)
	result, err := s.db.Exec(
		"INSERT INTO bookmarks (url, title, description, category_id, tags, favicon, favicon_version, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		input.URL, input.Title, input.Description, input.CategoryID, string(tagsJSON), input.Favicon, faviconVersion, newOrder,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "书签已存在"})
			return
		}
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	id, _ := result.LastInsertId()
	// 读数据库实际时间戳返回，与列表 refetch 拿到的值完全一致：
	// ① useCreateBookmark onSuccess 用此 bookmark append，useBookmarks 的 merge 逻辑据此
	//   （oldBm.updated_at === b.updated_at）保留本地 dataURI，避免 WS refetch 把 favicon 覆盖成 ''
	//   导致 <img> 从 dataURI 重新走端点加载；
	// ② BookmarkCard 的 faviconError 初始判断（noFaviconMemo.get(id) === updated_at）不因
	//   updated_at=undefined 与 noFaviconMemo 的 undefined 误判相等而显示 Globe（地球→真实图标闪烁根因）。
	var createdAt, updatedAt string
	if err := s.db.QueryRow(
		"SELECT COALESCE(created_at, ''), COALESCE(updated_at, ''), COALESCE(favicon_version, '') FROM bookmarks WHERE id = ?",
		id,
	).Scan(&createdAt, &updatedAt, &faviconVersion); err != nil {
		log.Printf("查询新书签时间戳失败 id=%d: %v", id, err)
	}
	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusCreated, map[string]any{
		"bookmark": map[string]any{
			"id":              id,
			"url":             input.URL,
			"title":           input.Title,
			"description":     input.Description,
			"category_id":     input.CategoryID,
			"tags":            input.Tags,
			"favicon":         input.Favicon,
			"favicon_version": faviconVersion,
			"sort_order":      newOrder,
			"is_favorite":     false,
			"created_at":      createdAt,
			"updated_at":      updatedAt,
		},
	})
}

// handleUpdateBookmark PUT /api/bookmarks/{id}
func (s *Server) handleUpdateBookmark(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}

	// 读取原始请求体
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 限制
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	// 解析为 map 以判断哪些字段被明确传入
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(bodyBytes, &raw); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	faviconProvided := false
	if _, ok := raw["favicon"]; ok {
		faviconProvided = true
	}

	var input BookmarkInput
	if err := json.Unmarshal(bodyBytes, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	// 从数据库读取已有书签，未传的字段保留原值
	var existing Bookmark
	var tagsStr string
	err = s.db.QueryRow(
		"SELECT id, url, title, COALESCE(description, ''), category_id, COALESCE(tags, '[]'), COALESCE(favicon, ''), COALESCE(favicon_version, ''), sort_order, COALESCE(is_favorite, 0), COALESCE(created_at, ''), COALESCE(updated_at, '') FROM bookmarks WHERE id = ?",
		id,
	).Scan(&existing.ID, &existing.URL, &existing.Title, &existing.Description, &existing.CategoryID, &tagsStr, &existing.Favicon, &existing.FaviconVersion, &existing.SortOrder, &existing.IsFavorite, &existing.CreatedAt, &existing.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "书签不存在"})
			return
		}
		log.Printf("查询失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	json.Unmarshal([]byte(tagsStr), &existing.Tags)
	if existing.Tags == nil {
		existing.Tags = []string{}
	}

	// 只覆盖请求体中明确传了的字段，没传的保持数据库原值
	if _, ok := raw["url"]; !ok {
		input.URL = existing.URL
	} else {
		// 明确传入 url 才规范化；保留原值场景不动数据库字面
		input.URL = normalizeURL(input.URL)
	}
	if _, ok := raw["title"]; !ok {
		input.Title = existing.Title
	}
	if _, ok := raw["description"]; !ok {
		input.Description = existing.Description
	}
	if _, ok := raw["category_id"]; !ok {
		input.CategoryID = existing.CategoryID
	}
	if _, ok := raw["tags"]; !ok {
		input.Tags = existing.Tags
	}
	if _, ok := raw["favicon"]; !ok {
		input.Favicon = existing.Favicon
	} else if len(input.Favicon) > 65536 {
		// 仅新传入的 favicon 做大小限制，保留原值不受限
		log.Printf("favicon 超限保留原值（更新）id=%d size=%d", id, len(input.Favicon))
		input.Favicon = existing.Favicon
	}
	// favicon 外部 URL 自动转 data URI 永久存储
	if strings.HasPrefix(input.Favicon, "http") {
		resolved, err := resolveFavicon(input.Favicon)
		if err != nil {
			log.Printf("favicon 下载失败 id=%d, 已丢弃", id)
			input.Favicon = existing.Favicon
		} else {
			input.Favicon = resolved
		}
	}

	tagsJSON, _ := json.Marshal(input.Tags)
	if input.Tags == nil {
		tagsJSON = []byte("[]")
	}

	categoryChanged :=
		(existing.CategoryID == nil) != (input.CategoryID == nil) ||
			(existing.CategoryID != nil && input.CategoryID != nil && *existing.CategoryID != *input.CategoryID)
	sortOrder := existing.SortOrder
	faviconVersion := existing.FaviconVersion
	if faviconProvided {
		if input.Favicon == "" {
			faviconVersion = ""
		} else {
			faviconVersion = strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()
	if categoryChanged {
		if err := tx.QueryRow("SELECT COALESCE(MAX(sort_order), 0) FROM bookmarks WHERE category_id IS ?", input.CategoryID).Scan(&sortOrder); err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		sortOrder++
	}

	result, err := tx.Exec(
		"UPDATE bookmarks SET url = ?, title = ?, description = ?, category_id = ?, tags = ?, favicon = ?, favicon_version = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		input.URL, input.Title, input.Description, input.CategoryID, string(tagsJSON), input.Favicon, faviconVersion, sortOrder, id,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "URL 与其他书签冲突"})
			return
		}
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if err := tx.Commit(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "书签不存在"})
		return
	}

	var newUpdatedAt string
	if err := s.db.QueryRow("SELECT updated_at, COALESCE(favicon_version, '') FROM bookmarks WHERE id = ?", id).Scan(&newUpdatedAt, &faviconVersion); err != nil {
		newUpdatedAt = ""
	}
	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated_at": newUpdatedAt, "favicon_version": faviconVersion})
}

// handleDeleteBookmark DELETE /api/bookmarks/{id}
func (s *Server) handleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}

	result, err := s.db.Exec("DELETE FROM bookmarks WHERE id = ?", id)
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "书签不存在"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleBookmarkFavicon GET /api/bookmarks/{id}/favicon
func (s *Server) handleBookmarkFavicon(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}

	var favicon string
	if err := s.db.QueryRow("SELECT COALESCE(favicon, '') FROM bookmarks WHERE id = ?", id).Scan(&favicon); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "书签不存在"})
		return
	}

	if favicon == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "无图标"})
		return
	}

	// data URI 格式：data:<mime>[;base64],<data>
	if strings.HasPrefix(favicon, "data:") {
		commaIdx := strings.Index(favicon[5:], ",")
		if commaIdx == -1 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "图标格式无效"})
			return
		}
		commaIdx += 5
		header := favicon[5:commaIdx]
		data := favicon[commaIdx+1:]

		// 提取 MIME 类型
		mime := header
		if idx := strings.Index(header, ";"); idx != -1 {
			mime = header[:idx]
		}

		isBase64 := strings.Contains(header, ";base64") || strings.HasSuffix(header, ";base64")

		if isBase64 {
			decoded, err := base64.StdEncoding.DecodeString(data)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "图标解码失败"})
				return
			}
			if strings.Contains(mime, "svg") {
				decoded = normalizeSVG(decoded)
			}
			w.Header().Set("Content-Type", mime)
			w.Header().Set("Cache-Control", "private, max-age=31536000")
			w.Write(decoded)
		} else {
			// URL 编码格式（如 SVG）
			decoded, err := url.QueryUnescape(data)
			if err != nil {
				decoded = data
			}
			if strings.Contains(mime, "svg") {
				// 归一化：去除 prefers-color-scheme 深色自适应，固定浅色模式颜色
				//（覆盖存量 + 前端 fetchFaviconDataUri 直存路径，白底上不再隐身）
				decoded = string(normalizeSVG([]byte(decoded)))
			}
			w.Header().Set("Content-Type", mime)
			w.Header().Set("Cache-Control", "private, max-age=31536000")
			w.Write([]byte(decoded))
		}
		return
	}

	// 外部 URL：代理下载后返回，避免 302 导致浏览器无法缓存
	if strings.HasPrefix(favicon, "http") {
		if !isValidURL(favicon) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "图标获取失败"})
			return
		}
		resp, err := httpClient.Get(favicon)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "图标获取失败"})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "图标获取失败"})
			return
		}
		contentType := resp.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "image/png"
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10)) // 最大 512KB
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "图标获取失败"})
			return
		}
		if strings.Contains(contentType, "svg") {
			data = normalizeSVG(data)
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "private, max-age=604800")
		w.Write(data)
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "无图标"})
}

// handleReorderBookmarks PUT /api/bookmarks/reorder
func (s *Server) handleReorderBookmarks(w http.ResponseWriter, r *http.Request) {
	var input ReorderInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 限制
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	for i, id := range input.Order {
		if _, err := tx.Exec("UPDATE bookmarks SET sort_order = ? WHERE id = ?", i, id); err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleBatchDeleteBookmarks DELETE /api/bookmarks/batch
func (s *Server) handleBatchDeleteBookmarks(w http.ResponseWriter, r *http.Request) {
	var input BatchDeleteInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if len(input.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择要删除的书签"})
		return
	}
	if len(input.IDs) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "单次最多删除 500 个书签"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	deleted := 0
	for _, id := range input.IDs {
		result, err := tx.Exec("DELETE FROM bookmarks WHERE id = ?", id)
		if err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		if n, _ := result.RowsAffected(); n > 0 {
			deleted++
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": deleted})
}

// handleBatchMoveBookmarks PUT /api/bookmarks/batch-move
func (s *Server) handleBatchMoveBookmarks(w http.ResponseWriter, r *http.Request) {
	var input BatchMoveInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if len(input.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择要移动的书签"})
		return
	}
	if len(input.IDs) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "单次最多移动 500 个书签"})
		return
	}
	if input.TargetBookmarkID != nil && (input.CategoryID == nil || (input.Position != "before" && input.Position != "after")) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "目标位置无效"})
		return
	}

	// 事务:把 sort_order 设为目标分类末尾(按加入顺序排),再改 category_id
	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	// 目标分类内按 sort_order 重排。常规移动不带落点，插入位置自然是末尾；
	// 聚合视图传 target_bookmark_id + position 时，插入指定书签前/后。
	rows, err := tx.Query("SELECT id FROM bookmarks WHERE category_id IS ? ORDER BY sort_order, id DESC", input.CategoryID)
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer rows.Close()
	selected := make(map[int64]struct{}, len(input.IDs))
	moving := make([]int64, 0, len(input.IDs))
	for _, id := range input.IDs {
		if _, exists := selected[id]; exists {
			continue
		}
		selected[id] = struct{}{}
		moving = append(moving, id)
	}
	remaining := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		if _, isMoving := selected[id]; !isMoving {
			remaining = append(remaining, id)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	insertAt := len(remaining)
	if input.TargetBookmarkID != nil {
		insertAt = -1
		for i, id := range remaining {
			if id == *input.TargetBookmarkID {
				insertAt = i
				if input.Position == "after" {
					insertAt++
				}
				break
			}
		}
		if insertAt == -1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "目标书签不在该分类"})
			return
		}
	}
	ordered := append(append(remaining[:insertAt:insertAt], moving...), remaining[insertAt:]...)
	// 只对真正被移动的书签 bump updated_at；目标分类其余书签只重写 sort_order。
	// 列表 API 的 favicon_version 兜底取 updated_at，无差别刷新会把整个分类的图标缓存全部打失效（切过去图标全闪）。
	for i, id := range ordered {
		var err error
		if _, isMoving := selected[id]; isMoving {
			_, err = tx.Exec(
				"UPDATE bookmarks SET category_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
				input.CategoryID, i, id,
			)
		} else {
			_, err = tx.Exec("UPDATE bookmarks SET sort_order = ? WHERE id = ?", i, id)
		}
		if err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "moved": len(input.IDs)})
}

// handleBatchAddTags PUT /api/bookmarks/batch-tags
func (s *Server) handleBatchAddTags(w http.ResponseWriter, r *http.Request) {
	var input BatchTagsInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if len(input.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择要添加标签的书签"})
		return
	}
	if len(input.Tags) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请输入要添加的标签"})
		return
	}
	if len(input.IDs) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "单次最多处理 500 个书签"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	updated := 0
	for _, id := range input.IDs {
		// 获取现有标签
		var tagsJSON string
		err := tx.QueryRow("SELECT tags FROM bookmarks WHERE id = ?", id).Scan(&tagsJSON)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}

		// 解析现有标签并合并
		var existingTags []string
		if err := json.Unmarshal([]byte(tagsJSON), &existingTags); err != nil {
			existingTags = []string{}
		}

		tagSet := make(map[string]bool)
		for _, t := range existingTags {
			tagSet[t] = true
		}
		for _, t := range input.Tags {
			tagSet[t] = true
		}

		var newTags []string
		for t := range tagSet {
			newTags = append(newTags, t)
		}
		newTagsJSON, _ := json.Marshal(newTags)

		result, err := tx.Exec("UPDATE bookmarks SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", string(newTagsJSON), id)
		if err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		if n, _ := result.RowsAffected(); n > 0 {
			updated++
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": updated})
}

// handleBatchRemoveTags DELETE /api/bookmarks/batch-tags
// 与 handleBatchAddTags 对称：从 ids 每个书签的 tags 中移除 input.Tags 里出现的标签
//（书签本来就没有的标签静默跳过）。校验/事务结构与加标签版一致。
func (s *Server) handleBatchRemoveTags(w http.ResponseWriter, r *http.Request) {
	var input BatchTagsInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if len(input.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请选择要移除标签的书签"})
		return
	}
	if len(input.Tags) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请输入要移除的标签"})
		return
	}
	if len(input.IDs) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "单次最多处理 500 个书签"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	removeSet := make(map[string]bool, len(input.Tags))
	for _, t := range input.Tags {
		removeSet[t] = true
	}

	updated := 0
	for _, id := range input.IDs {
		var tagsJSON string
		err := tx.QueryRow("SELECT tags FROM bookmarks WHERE id = ?", id).Scan(&tagsJSON)
		if err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}

		var existingTags []string
		if err := json.Unmarshal([]byte(tagsJSON), &existingTags); err != nil {
			existingTags = []string{}
		}

		var newTags []string
		for _, t := range existingTags {
			if !removeSet[t] {
				newTags = append(newTags, t)
			}
		}
		// 本来就没有这些标签 → 无变化跳过写库
		if len(newTags) == len(existingTags) {
			continue
		}
		if newTags == nil {
			newTags = []string{} // 全部移除时写 [] 而非 null，前端 tags 类型约定为 string[]
		}
		newTagsJSON, _ := json.Marshal(newTags)

		result, err := tx.Exec("UPDATE bookmarks SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", string(newTagsJSON), id)
		if err != nil {
			log.Printf("操作失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		if n, _ := result.RowsAffected(); n > 0 {
			updated++
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": updated})
}

// handleToggleFavorite PATCH /api/bookmarks/{id}/favorite
func (s *Server) handleToggleFavorite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}

	// 原子取反，避免 TOCTOU 竞态
	var newFav int
	if err := s.db.QueryRow("UPDATE bookmarks SET is_favorite = 1 - COALESCE(is_favorite, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING is_favorite", id).Scan(&newFav); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "书签不存在"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"is_favorite": newFav == 1})
}

// handleBatchUpdateBookmarks PUT /api/bookmarks/batch-update
func (s *Server) handleBatchUpdateBookmarks(w http.ResponseWriter, r *http.Request) {
	var input BatchUpdateInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "\u8bf7\u6c42\u683c\u5f0f\u9519\u8bef"})
		return
	}
	if len(input.Updates) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "updates \u4e0d\u80fd\u4e3a\u7a7a"})
		return
	}
	if len(input.Updates) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "\u5355\u6b21\u6700\u591a\u66f4\u65b0 500 \u4e2a\u4e66\u7b7e"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("\u6279\u91cf\u66f4\u65b0\u4e8b\u52a1\u542f\u52a8\u5931\u8d25: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "\u64cd\u4f5c\u5931\u8d25"})
		return
	}
	defer tx.Rollback()

	updated := 0
	faviconVersion := strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	for _, u := range input.Updates {
		if u.ID <= 0 {
			continue
		}
		var sets []string
		var args []any
		if u.Title != nil {
			sets = append(sets, "title = ?")
			args = append(args, *u.Title)
		}
		if u.Description != nil {
			sets = append(sets, "description = ?")
			args = append(args, *u.Description)
		}
		if u.Favicon != nil {
			resolved, err := resolveFavicon(*u.Favicon)
			if err != nil {
				log.Printf("favicon 下载失败 id=%d, 已丢弃", u.ID)
				continue
			}
			sets = append(sets, "favicon = ?")
			args = append(args, resolved)
			sets = append(sets, "favicon_version = CASE WHEN ? != '' THEN ? ELSE '' END")
			args = append(args, resolved, faviconVersion)
		}
		if len(sets) == 0 {
			continue
		}
		sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
		args = append(args, u.ID)
		_, err = tx.Exec("UPDATE bookmarks SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
		if err != nil {
			log.Printf("\u6279\u91cf\u66f4\u65b0\u5931\u8d25: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "\u64cd\u4f5c\u5931\u8d25"})
			return
		}
		updated++
	}

	if err := tx.Commit(); err != nil {
		log.Printf("\u6279\u91cf\u66f4\u65b0\u4e8b\u52a1\u63d0\u4ea4\u5931\u8d25: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "\u64cd\u4f5c\u5931\u8d25"})
		return
	}

	s.broadcastInvalidated("bookmarks")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": updated})
}
