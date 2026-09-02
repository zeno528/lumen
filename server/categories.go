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
	rows, err := s.db.Query("SELECT id, name, icon, COALESCE(color, ''), sort_order, parent_id FROM categories ORDER BY sort_order, id")
	if err != nil {
		log.Printf("查询分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	categories := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.SortOrder, &c.ParentID); err != nil {
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
	if input.ParentID != nil {
		if msg := s.validateParentID(w, *input.ParentID); msg != "" {
			return
		}
	}
	if exists, err := s.siblingNameExists(input.Name, input.ParentID, 0); err != nil {
		log.Printf("检查同级重名失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建失败"})
		return
	} else if exists {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "同级下已存在同名分类"})
		return
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
		"INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES (?, ?, ?, ?, ?)",
		input.Name, input.Icon, input.Color, newOrder, input.ParentID,
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
			ParentID:  input.ParentID,
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
	if input.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "分类名称不能为空"})
		return
	}
	// 换父校验：目标父必须是顶级；有子分类的分类不能降级为子分类（保持两级）；
	// 不能把自己设为自己的父。
	if input.ParentID != nil {
		if *input.ParentID == id {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "父分类不能是自己"})
			return
		}
		if msg := s.validateParentID(w, *input.ParentID); msg != "" {
			return
		}
		var childCount int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM categories WHERE parent_id = ?", id).Scan(&childCount); err != nil {
			log.Printf("查询子分类数失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		if childCount > 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "该分类包含子分类，不能移到子级"})
			return
		}
	}
	if exists, err := s.siblingNameExists(input.Name, input.ParentID, id); err != nil {
		log.Printf("检查同级重名失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	} else if exists {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "同级下已存在同名分类"})
		return
	}
	result, err := s.db.Exec(
		"UPDATE categories SET name = ?, icon = ?, color = ?, parent_id = ? WHERE id = ?",
		input.Name, input.Icon, input.Color, input.ParentID, id,
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

	// 子分类升级为顶级（parent_id 外键是 RESTRICT，必须先解除引用）；
	// keep/all 只作用于本分类自己的书签，不级联到子分类
	if _, err := tx.Exec("UPDATE categories SET parent_id = NULL WHERE parent_id = ?", id); err != nil {
		log.Printf("提升子分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
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
	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("批量删除分类事务启动失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()
	// 被删分类的子分类先升级为顶级（RESTRICT 外键要求先解除引用）
	if _, err := tx.Exec("UPDATE categories SET parent_id = NULL WHERE parent_id IN ("+placeholders(len(input.IDs))+")", toArgs(input.IDs)...); err != nil {
		log.Printf("提升子分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	result, err := tx.Exec("DELETE FROM categories WHERE id IN ("+placeholders(len(input.IDs))+")", toArgs(input.IDs)...)
	if err != nil {
		log.Printf("批量删除分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	deleted, _ := result.RowsAffected()
	if err := tx.Commit(); err != nil {
		log.Printf("批量删除分类事务提交失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

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

	// 源分类若是父分类，其子分类先升级为顶级（RESTRICT 外键要求先解除引用）
	if _, err := tx.Exec("UPDATE categories SET parent_id = NULL WHERE parent_id IN ("+placeholders(len(input.SourceIDs))+")", toArgs(input.SourceIDs)...); err != nil {
		log.Printf("提升子分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
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
// body: {parent_id: number|null, order: [兄弟 id 按新顺序]}——排序只在同级兄弟内进行。
func (s *Server) handleReorderCategories(w http.ResponseWriter, r *http.Request) {
	var input ReorderInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 限制
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if len(input.Order) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "order 不能为空"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("操作失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	// 校验 order 中每个分类确实属于 parent_id 这一组（顶层组 = parent_id IS NULL）
	for _, id := range input.Order {
		var pid sql.NullInt64
		if err := tx.QueryRow("SELECT parent_id FROM categories WHERE id = ?", id).Scan(&pid); err != nil {
			if err == sql.ErrNoRows {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "分类不存在"})
				return
			}
			log.Printf("查询分类父级失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		belongs := (input.ParentID == nil && !pid.Valid) ||
			(input.ParentID != nil && pid.Valid && pid.Int64 == *input.ParentID)
		if !belongs {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "只能在同级分类内排序"})
			return
		}
	}

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

// validateParentID 校验 parent_id 指向的分类存在且自身是顶级（固定两级）。
// 通过返回 ""；否则已写好 HTTP 响应并返回错误消息。
func (s *Server) validateParentID(w http.ResponseWriter, parentID int64) string {
	var hasParent bool
	err := s.db.QueryRow("SELECT parent_id IS NOT NULL FROM categories WHERE id = ?", parentID).Scan(&hasParent)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "父分类不存在"})
		return "父分类不存在"
	}
	if err != nil {
		log.Printf("查询父分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "校验父分类失败"})
		return "校验父分类失败"
	}
	if hasParent {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "只能两级分类：所选父分类已是子分类"})
		return "只能两级分类：所选父分类已是子分类"
	}
	return ""
}

// siblingNameExists 检查同一父分类下是否已有同名分类（不同父可重名）。
// excludeID 排除自身（编辑场景），创建时传 0。
func (s *Server) siblingNameExists(name string, parentID *int64, excludeID int64) (bool, error) {
	var n int
	var err error
	if parentID == nil {
		err = s.db.QueryRow(
			"SELECT COUNT(*) FROM categories WHERE name = ? AND parent_id IS NULL AND id != ?",
			name, excludeID,
		).Scan(&n)
	} else {
		err = s.db.QueryRow(
			"SELECT COUNT(*) FROM categories WHERE name = ? AND parent_id = ? AND id != ?",
			name, *parentID, excludeID,
		).Scan(&n)
	}
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
