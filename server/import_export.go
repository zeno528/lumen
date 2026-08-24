package main

import (
	"compress/gzip"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// handleExport GET /api/export?format=json[&ids=1,2,3]
// 不传 ids 导出全部；传 ids 只导出选中的书签（批量导出选中）。
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	cats, err := s.getAllCategories()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	var bookmarks []Bookmark
	idsParam := r.URL.Query().Get("ids")
	if idsParam != "" {
		ids, parseErr := parseIDList(idsParam)
		if parseErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ids 参数格式错误"})
			return
		}
		if len(ids) > 0 {
			bookmarks, err = s.getBookmarksByIDs(ids)
		} else {
			bookmarks = []Bookmark{}
		}
	} else {
		bookmarks, err = s.getAllBookmarks()
	}
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	timestamp := time.Now().Format("0102-1504")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=lumen-sr-%s.json", timestamp))
	writeJSON(w, http.StatusOK, map[string]any{
		"categories": cats,
		"bookmarks":  bookmarks,
	})
}

// parseIDList 把 "1,2,3" 解析成 []int64，忽略空段。
func parseIDList(s string) ([]int64, error) {
	parts := strings.Split(s, ",")
	ids := make([]int64, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		id, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// handleImport POST /api/import
func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "merge"
	}

	contentType := r.Header.Get("Content-Type")

	var imported int
	var skipped int
	var importedIDs []int64
	var importedCategories []string
	var skippedCategories int

	if contentType != "" && len(contentType) >= 19 && contentType[:19] == "multipart/form-data" {
		file, _, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请上传文件"})
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 10<<20)) // 10MB 限制
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "读取文件失败"})
			return
		}
		imported, skipped, importedIDs, importedCategories, skippedCategories, err = s.importData(data, mode)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	} else {
		// 支持 gzip 压缩的请求体
		var reader io.Reader = r.Body
		if r.Header.Get("Content-Encoding") == "gzip" {
			gz, err := gzip.NewReader(r.Body)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "解压失败"})
				return
			}
			defer gz.Close()
			reader = gz
		}
		body, err := io.ReadAll(io.LimitReader(reader, 10<<20)) // 10MB 限制
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "读取请求失败"})
			return
		}
		imported, skipped, importedIDs, importedCategories, skippedCategories, err = s.importData(body, mode)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}

	s.broadcastInvalidated("bookmarks", "categories")
	writeJSON(w, http.StatusOK, map[string]any{
		"imported":            imported,
		"skipped":             skipped,
		"imported_ids":        importedIDs,
		"imported_categories": importedCategories,
		"skipped_categories":  skippedCategories,
	})
}

// 辅助方法

func (s *Server) getAllCategories() ([]Category, error) {
	rows, err := s.db.Query("SELECT id, name, icon, COALESCE(color, ''), sort_order FROM categories ORDER BY sort_order, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cats := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.SortOrder); err != nil {
			return nil, fmt.Errorf("扫描分类行失败: %w", err)
		}
		cats = append(cats, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历分类失败: %w", err)
	}
	return cats, nil
}

func (s *Server) getAllBookmarks() ([]Bookmark, error) {
	rows, err := s.db.Query("SELECT id, url, title, COALESCE(description, ''), category_id, COALESCE(tags, '[]'), COALESCE(favicon, ''), sort_order, COALESCE(is_favorite, 0), COALESCE(created_at, ''), COALESCE(updated_at, '') FROM bookmarks ORDER BY sort_order, id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bookmarks := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		var tagsStr string
		if err := rows.Scan(&b.ID, &b.URL, &b.Title, &b.Description, &b.CategoryID, &tagsStr, &b.Favicon, &b.SortOrder, &b.IsFavorite, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("扫描书签行失败: %w", err)
		}
		json.Unmarshal([]byte(tagsStr), &b.Tags)
		if b.Tags == nil {
			b.Tags = []string{}
		}
		bookmarks = append(bookmarks, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历书签失败: %w", err)
	}
	return bookmarks, nil
}

// getBookmarksByIDs 按指定 id 列表查询书签，列与排序与 getAllBookmarks 完全一致，
// 确保批量导出选中的书签与全量导出格式相同。
func (s *Server) getBookmarksByIDs(ids []int64) ([]Bookmark, error) {
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := "SELECT id, url, title, COALESCE(description, ''), category_id, COALESCE(tags, '[]'), COALESCE(favicon, ''), sort_order, COALESCE(is_favorite, 0), COALESCE(created_at, ''), COALESCE(updated_at, '') FROM bookmarks WHERE id IN (" +
		strings.Join(placeholders, ",") + ") ORDER BY sort_order, id DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bookmarks := []Bookmark{}
	for rows.Next() {
		var b Bookmark
		var tagsStr string
		if err := rows.Scan(&b.ID, &b.URL, &b.Title, &b.Description, &b.CategoryID, &tagsStr, &b.Favicon, &b.SortOrder, &b.IsFavorite, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, fmt.Errorf("扫描书签行失败: %w", err)
		}
		json.Unmarshal([]byte(tagsStr), &b.Tags)
		if b.Tags == nil {
			b.Tags = []string{}
		}
		bookmarks = append(bookmarks, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历书签失败: %w", err)
	}
	return bookmarks, nil
}

// FlexNumber 兼容 JSON number / 数字字符串 / 任意标识符（如 "all"）/ 空字符串 / null。
// 空字符串和 null 当零值（无分类/无 ID）不报错，"" 语义等价 null--
// 让导入接受更多来源的 JSON（手写/AI 生成/其他工具导出），
// 替代 json.Number（后者对 "" 报 "invalid number literal"）。
// 非数字字符串（如虚拟分类 "all"）也接受，由调用方按语义处理（importJSON 跳过）。
type FlexNumber string

// UnmarshalJSON 接受 number / "数字字符串" / 任意字符串 / "" / null；仅拒绝非 JSON 标量。
func (n *FlexNumber) UnmarshalJSON(data []byte) error {
	s := string(data)
	if s == "null" {
		*n = ""
		return nil
	}
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}
	*n = FlexNumber(s)
	return nil
}

func (n FlexNumber) String() string { return string(n) }

// 导入专用结构体（兼容前端 localStorage 和服务器导出两种格式）
type ImportCategory struct {
	ID        FlexNumber `json:"id"`
	Name      string     `json:"name"`
	Icon      string     `json:"icon"`
	Color     string     `json:"color"`
	IsDefault bool       `json:"isDefault"`
	SortOrder *int       `json:"sort_order"`
}

type ImportBookmark struct {
	ID          FlexNumber `json:"id"`
	URL         string     `json:"url"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	CategoryID  FlexNumber `json:"categoryId"`
	CategoryID2 FlexNumber `json:"category_id"` // 服务器导出格式
	Tags        []string   `json:"tags"`
	Favicon     string     `json:"favicon"`
	IsFavorite  bool       `json:"is_favorite"`
}

func (s *Server) importData(data []byte, mode string) (imported int, skipped int, importedIDs []int64, importedCategories []string, skippedCategories int, err error) {
	var jsonData struct {
		Categories []ImportCategory `json:"categories"`
		Bookmarks  []ImportBookmark `json:"bookmarks"`
	}
	if err := json.Unmarshal(data, &jsonData); err == nil {
		if len(jsonData.Categories) > 0 || len(jsonData.Bookmarks) > 0 {
			return s.importJSON(jsonData.Categories, jsonData.Bookmarks, mode)
		}
	}

	return 0, 0, nil, nil, 0, fmt.Errorf("无法识别的导入格式，仅支持 JSON")
}

// 获取书签的分类 ID（兼容 categoryId 和 category_id 两种字段名）
func (bm *ImportBookmark) getCategoryID() FlexNumber {
	if bm.CategoryID2.String() != "" {
		return bm.CategoryID2
	}
	return bm.CategoryID
}

func (s *Server) importJSON(categories []ImportCategory, bookmarks []ImportBookmark, mode string) (imported int, skipped int, importedIDs []int64, importedCategories []string, skippedCategories int, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, 0, nil, nil, 0, err
	}
	defer tx.Rollback()

	if mode == "overwrite" {
		if _, err := tx.Exec("DELETE FROM bookmarks"); err != nil {
			return 0, 0, nil, nil, 0, fmt.Errorf("清空书签失败: %v", err)
		}
		if _, err := tx.Exec("DELETE FROM categories"); err != nil {
			return 0, 0, nil, nil, 0, fmt.Errorf("清空分类失败: %v", err)
		}
	}

	// 导入分类（跳过 'all' 虚拟分类）。旧导出中的层级字段会被忽略。
	// RowsAffected>0 为新增（记名供前端展示「新增了哪些分类」），=0 为已存在跳过。
	importedCategories = []string{}
	catIDMap := make(map[string]int64)
	for i, cat := range categories {
		catIDStr := cat.ID.String()
		if catIDStr == "all" || cat.IsDefault {
			continue
		}
		icon := cat.Icon
		if icon == "" {
			icon = "fa-folder"
		}
		sortOrder := i
		if cat.SortOrder != nil {
			sortOrder = *cat.SortOrder
		}
		// 合并导入沿用名称去重规则；手动创建分类则允许同名。
		var existingID int64
		err := tx.QueryRow("SELECT id FROM categories WHERE name = ? LIMIT 1", cat.Name).Scan(&existingID)
		if err == nil {
			catIDMap[catIDStr] = existingID
			skippedCategories++
			continue
		}
		if err != sql.ErrNoRows {
			return 0, 0, nil, nil, 0, fmt.Errorf("查询分类失败: %w", err)
		}

		result, err := tx.Exec("INSERT INTO categories (name, icon, color, sort_order) VALUES (?, ?, ?, ?)",
			cat.Name, icon, cat.Color, sortOrder)
		if err != nil {
			return 0, 0, nil, nil, 0, fmt.Errorf("导入分类失败: %w", err)
		}
		id, _ := result.LastInsertId()
		importedCategories = append(importedCategories, cat.Name)
		catIDMap[catIDStr] = id
	}

	// 插入完成后统一按名称补齐旧格式缺失 ID。
	rows, err := tx.Query("SELECT id, name FROM categories")
	if err != nil {
		return 0, 0, nil, nil, 0, fmt.Errorf("查询分类失败: %w", err)
	}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return 0, 0, nil, nil, 0, fmt.Errorf("扫描分类失败: %w", err)
		}
		for _, cat := range categories {
			catIDStr := cat.ID.String()
			if catIDStr == "all" || cat.IsDefault || catIDStr == "" {
				continue
			}
			if cat.Name == name {
				catIDMap[catIDStr] = id
				break
			}
		}
	}
	rows.Close()

	// 查询当前库最大 sort_order：导入的书签统一排在已有书签之后（"先来后到"），
	// 不再沿用导出文件里的原 sort_order（否则会与现有库数值重叠、散落各处）
	var baseOrder int
	if err := tx.QueryRow("SELECT COALESCE(MAX(sort_order), 0) FROM bookmarks").Scan(&baseOrder); err != nil {
		return 0, 0, nil, nil, 0, fmt.Errorf("查询书签排序失败: %w", err)
	}

	// 导入书签
	for i, bm := range bookmarks {
		tagsJSON, _ := json.Marshal(bm.Tags)
		if bm.Tags == nil {
			tagsJSON = []byte("[]")
		}

		var categoryID any
		catIDStr := bm.getCategoryID().String()
		if catIDStr != "" && catIDStr != "0" && catIDStr != "all" {
			if newID, ok := catIDMap[catIDStr]; ok {
				categoryID = newID
			}
			// 未知分类 ID 忽略，不阻塞导入
		}

		sortOrder := baseOrder + i + 1 // 统一排到已有书签末尾，按文件先后顺序

		// 入库前归一化（与手动创建/编辑共用 utils.normalizeURL）：
		// - JSON 文件可能含 //path、大小写混合、缺 https:// 等字面，规范化后才能被
		//   SQLite UNIQUE 约束识别为重复（与 933/939 bug 同源）。
		// - 维护一份 normalizeURL，所有入库路径（手动 / 编辑 / 导入 / 迁移）都调用。
		bm.URL = normalizeURL(bm.URL)

		result, err := tx.Exec(
			"INSERT OR IGNORE INTO bookmarks (url, title, description, category_id, tags, favicon, sort_order, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			bm.URL, bm.Title, bm.Description, categoryID, string(tagsJSON), bm.Favicon, sortOrder, bm.IsFavorite,
		)
		if err != nil {
			skipped++
			continue
		}
		rows, _ := result.RowsAffected()
		if rows > 0 {
			imported++
			if id, _ := result.LastInsertId(); id > 0 {
				importedIDs = append(importedIDs, id)
			}
		} else {
			skipped++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, nil, nil, 0, err
	}
	return imported, skipped, importedIDs, importedCategories, skippedCategories, nil
}
