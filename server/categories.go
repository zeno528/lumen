package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (s *Server) validateCategoryParent(parentID *int64, selfID int64) error {
	if parentID == nil {
		return nil
	}
	if *parentID <= 0 || *parentID == selfID {
		return fmt.Errorf("父分类无效")
	}
	currentID := *parentID
	seen := map[int64]bool{}
	for {
		if seen[currentID] {
			return fmt.Errorf("分类层级存在循环")
		}
		seen[currentID] = true
		var ancestor sql.NullInt64
		if err := s.db.QueryRow("SELECT parent_id FROM categories WHERE id = ?", currentID).Scan(&ancestor); err == sql.ErrNoRows {
			return fmt.Errorf("父分类不存在")
		} else if err != nil {
			return fmt.Errorf("父分类校验失败")
		}
		if ancestor.Valid && ancestor.Int64 == selfID {
			return fmt.Errorf("不能移动到自己的子分类")
		}
		if !ancestor.Valid {
			break
		}
		currentID = ancestor.Int64
	}
	return nil
}

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
	if err := s.validateCategoryParent(input.ParentID, 0); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
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
	if err := s.validateCategoryParent(input.ParentID, id); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	var hasChildren bool
	if err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM categories WHERE parent_id = ?)", id).Scan(&hasChildren); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if hasChildren && input.ParentID != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "有子分类的父分类不能变更父级"})
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

// handleMoveCategory PUT /api/categories/{id}/parent
// 仅调整层级，不触碰分类名称、图标或书签。
func (s *Server) handleMoveCategory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}

	var input struct {
		ParentID *int64 `json:"parent_id"`
		TargetID *int64 `json:"target_id"`
		Position string `json:"position"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if err := s.validateCategoryParent(input.ParentID, id); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.TargetID != nil {
		if input.ParentID == nil || *input.TargetID == id || (input.Position != "before" && input.Position != "after") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "排序落点无效"})
			return
		}
	} else if input.Position != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "排序落点无效"})
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Printf("开始移动分类事务失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	defer tx.Rollback()

	var targetOrder []int64
	if input.TargetID != nil {
		rows, err := tx.Query("SELECT id FROM categories WHERE parent_id = ? AND id != ? ORDER BY sort_order, id", input.ParentID, id)
		if err != nil {
			log.Printf("查询目标子分类失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		for rows.Next() {
			var categoryID int64
			if err := rows.Scan(&categoryID); err != nil {
				rows.Close()
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
				return
			}
			targetOrder = append(targetOrder, categoryID)
		}
		if err := rows.Close(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
		insertAt := -1
		for index, categoryID := range targetOrder {
			if categoryID == *input.TargetID {
				insertAt = index
				break
			}
		}
		if insertAt == -1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "排序目标不属于父分类"})
			return
		}
		if input.Position == "after" {
			insertAt++
		}
		targetOrder = append(targetOrder, 0)
		copy(targetOrder[insertAt+1:], targetOrder[insertAt:])
		targetOrder[insertAt] = id
	}

	result, err := tx.Exec("UPDATE categories SET parent_id = ? WHERE id = ?", input.ParentID, id)
	if err != nil {
		log.Printf("更新分类父级失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "分类不存在"})
		return
	}
	for index, categoryID := range targetOrder {
		if _, err := tx.Exec("UPDATE categories SET sort_order = ? WHERE id = ?", index, categoryID); err != nil {
			log.Printf("更新分类排序失败: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("提交移动分类事务失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}

	s.broadcastInvalidated("categories")
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleReleaseCategoryChildren PUT /api/categories/{id}/children/release
// 将直接子分类提升为顶级分类，分类与书签本身均保留。
func (s *Server) handleReleaseCategoryChildren(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效 ID"})
		return
	}
	result, err := s.db.Exec("UPDATE categories SET parent_id = NULL WHERE parent_id = ?", id)
	if err != nil {
		log.Printf("释放子分类失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		var exists bool
		if err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?)", id).Scan(&exists); err != nil || !exists {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "分类不存在"})
			return
		}
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
	if mode != "promote" && mode != "keep" && mode != "all" {
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

	var childCount int
	if err := tx.QueryRow("SELECT COUNT(*) FROM categories WHERE parent_id = ?", id).Scan(&childCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if childCount > 0 {
		switch mode {
		case "promote":
			if _, err := tx.Exec("UPDATE categories SET parent_id = NULL WHERE parent_id = ?", id); err != nil {
				log.Printf("提升子分类失败: %v", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
				return
			}
		case "all":
			if _, err := tx.Exec("DELETE FROM bookmarks WHERE category_id = ? OR category_id IN (SELECT id FROM categories WHERE parent_id = ?)", id, id); err != nil {
				log.Printf("删除分类书签失败: %v", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
				return
			}
		}
		if mode != "promote" {
			if _, err := tx.Exec("DELETE FROM categories WHERE parent_id = ?", id); err != nil {
				log.Printf("删除子分类失败: %v", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
				return
			}
		}
	} else if mode == "all" {
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
	var childCount int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM categories WHERE parent_id IN ("+placeholders(len(input.IDs))+")", toArgs(input.IDs)...).Scan(&childCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if childCount > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "请先处理子分类"})
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
	var childCount int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM categories WHERE parent_id IN ("+placeholders(len(input.SourceIDs))+")", toArgs(input.SourceIDs)...).Scan(&childCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if childCount > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "含子分类的分类不能合并"})
		return
	}
	var sourceUnderTarget int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM categories WHERE id IN ("+placeholders(len(input.SourceIDs))+") AND parent_id = ?", append(toArgs(input.SourceIDs), input.TargetID)...).Scan(&sourceUnderTarget); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if sourceUnderTarget > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "含层级关系的分类不能合并"})
		return
	}
	var sourceWithParent int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM categories WHERE id IN ("+placeholders(len(input.SourceIDs))+") AND parent_id IS NOT NULL", toArgs(input.SourceIDs)...).Scan(&sourceWithParent); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if sourceWithParent > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "含层级关系的分类不能合并"})
		return
	}
	var targetHasParent int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM categories WHERE id = ? AND parent_id IS NOT NULL", input.TargetID).Scan(&targetHasParent); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "操作失败"})
		return
	}
	if targetHasParent > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "含层级关系的分类不能合并"})
		return
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
