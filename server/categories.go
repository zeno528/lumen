package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// handleGetCategories GET /api/categories
func (s *Server) handleGetCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query("SELECT id, name, icon, COALESCE(color, ''), sort_order FROM categories ORDER BY sort_order, id")
	if err != nil {
		log.Printf("查询分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	categories := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.SortOrder); err != nil {
			log.Printf("扫描分类行失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "数据读取失败"})
			return
		}
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		log.Printf("遍历分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "数据读取失败"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"categories": categories,
	})
}

// handleCreateCategory POST /api/categories
func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	var input CategoryInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 限制
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if input.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分类名称不能为空"})
		return
	}
	if input.Icon == "" {
		input.Icon = "fa-folder"
	}
	// 获取当前最大 sort_order
	var maxOrder sql.NullInt64
	if err := s.db.QueryRow("SELECT MAX(sort_order) FROM categories").Scan(&maxOrder); err != nil {
		log.Printf("获取分类最大排序失败: %v", err)
	}
	newOrder := 0
	if maxOrder.Valid {
		newOrder = int(maxOrder.Int64) + 1
	}

	result, err := s.db.Exec(
		"INSERT INTO categories (name, icon, color, sort_order) VALUES (?, ?, ?, ?)",
		input.Name, input.Icon, input.Color, newOrder,
	)
	if err != nil {
		log.Printf("创建分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建失败"})
		return
	}

	id, _ := result.LastInsertId()
	s.broadcastInvalidated("categories")
	writeJSON(w, http.StatusCreated, map[string]any{
		"category": Category{
			ID:        id,
			Name:      input.Name,
			Icon:      input.Icon,
			Color:     input.Color,
			SortOrder: newOrder,
		},
	})
}

// handleUpdateCategory PUT /api/categories/{id}
func (s *Server) handleUpdateCategory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}

	var input CategoryInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 限制
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	result, err := s.db.Exec(
		"UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?",
		input.Name, input.Icon, input.Color, id,
	)
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分类不存在"})
		return
	}

	s.broadcastInvalidated("categories")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleDeleteCategory DELETE /api/categories/{id}
func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "keep"
	}
	if mode != "keep" && mode != "all" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效删除方式"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("开始删除分类事务失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	if mode == "all" {
		if _, err := tx.Exec("DELETE FROM bookmarks WHERE category_id = ?", id); err != nil {
			log.Printf("删除分类书签失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
	}

	result, err := tx.Exec("DELETE FROM categories WHERE id = ?", id)
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分类不存在"})
		return
	}
	if err := tx.Commit(); err != nil {
		log.Printf("提交删除分类事务失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	// 关联书签的 category_id 已通过 ON DELETE SET NULL 自动处理
	s.broadcastInvalidated("bookmarks", "categories")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleBatchDeleteCategories DELETE /api/categories/batch
// 批量删除分类，关联书签由 ON DELETE SET NULL 自动变未分类（与单个删一致）。
// 复用 handleMergeCategories 的 placeholders/toArgs 拼 IN 子句。
func (s *Server) handleBatchDeleteCategories(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IDs []int64 `json:"ids"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if len(input.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ids 不能为空"})
		return
	}
	result, err := s.db.Exec("DELETE FROM categories WHERE id IN ("+placeholders(len(input.IDs))+")", toArgs(input.IDs)...)
	if err != nil {
		log.Printf("批量删除分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	deleted, _ := result.RowsAffected()

	// 关联书签的 category_id 已通过 ON DELETE SET NULL 自动处理
	s.broadcastInvalidated("bookmarks", "categories")
	log.Printf("批量删除分类: %d 个", deleted)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"deleted": deleted,
	})
}

// handleMergeCategories POST /api/categories/merge
func (s *Server) handleMergeCategories(w http.ResponseWriter, r *http.Request) {
	var input MergeCategoriesInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if len(input.SourceIDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source_ids 不能为空"})
		return
	}
	if input.TargetID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "target_id 无效"})
		return
	}

	for _, sid := range input.SourceIDs {
		if sid == input.TargetID {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "目标分类不能在源分类列表中"})
			return
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("合并分类事务启动失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	var targetName string
	if err := tx.QueryRow("SELECT name FROM categories WHERE id = ?", input.TargetID).Scan(&targetName); err != nil {
		if err == sql.ErrNoRows {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "目标分类不存在"})
			return
		}
		log.Printf("查询目标分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	var totalMoved int64
	for _, sid := range input.SourceIDs {
		result, err := tx.Exec("UPDATE bookmarks SET category_id = ? WHERE category_id = ?", input.TargetID, sid)
		if err != nil {
			log.Printf("移动书签失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		n, _ := result.RowsAffected()
		totalMoved += n
	}

	result, err := tx.Exec("DELETE FROM categories WHERE id IN ("+placeholders(len(input.SourceIDs))+")", toArgs(input.SourceIDs)...)
	if err != nil {
		log.Printf("删除源分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	deleted, _ := result.RowsAffected()

	if err := tx.Commit(); err != nil {
		log.Printf("合并分类事务提交失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	log.Printf("合并分类: %d 个书签移至分类 id=%d, 删除 %d 个分类", totalMoved, input.TargetID, deleted)
	s.broadcastInvalidated("bookmarks", "categories")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"moved":   totalMoved,
		"deleted": deleted,
	})
}

// placeholders 生成 SQL 占位符 (?, ?, ?)
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	s := "?"
	for i := 1; i < n; i++ {
		s += ", ?"
	}
	return s
}

// toArgs 将 int64 切片转为 []interface{}
func toArgs(ids []int64) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// handleReorderCategories PUT /api/categories/reorder
func (s *Server) handleReorderCategories(w http.ResponseWriter, r *http.Request) {
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
		if _, err := tx.Exec("UPDATE categories SET sort_order = ? WHERE id = ?", i, id); err != nil {
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

	s.broadcastInvalidated("categories")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
