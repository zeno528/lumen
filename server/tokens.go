package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

// generateRawToken 生成 msk_ 前缀的随机 token
func generateRawToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "msk_" + hex.EncodeToString(b), nil
}

// hashTokenSHA256 对 token 做 SHA-256 哈希
func hashTokenSHA256(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// handleListTokens GET /api/tokens
func (s *Server) handleListTokens(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT id, name, token_prefix, token_suffix,
		       COALESCE(last_used_at, '') as last_used_at,
		       created_at
		FROM api_tokens ORDER BY created_at DESC
	`)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	var tokens []map[string]any
	for rows.Next() {
		var id int
		var name, prefix, suffix, lastUsed, createdAt string
		if err := rows.Scan(&id, &name, &prefix, &suffix, &lastUsed, &createdAt); err != nil {
			continue
		}
		item := map[string]any{
			"id":         id,
			"name":       name,
			"prefix":     prefix,
			"suffix":     suffix,
			"created_at": createdAt,
		}
		if lastUsed != "" {
			item["last_used_at"] = lastUsed
		}
		tokens = append(tokens, item)
	}
	if tokens == nil {
		tokens = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, tokens)
}

// handleCreateToken POST /api/tokens
func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if input.Name == "" {
		input.Name = "API Token"
	}

	rawToken, err := generateRawToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成 token 失败"})
		return
	}

	tokenHash := hashTokenSHA256(rawToken)
	prefix := rawToken[:12] // "msk_" + 8 chars
	suffix := rawToken[len(rawToken)-4:]

	result, err := s.db.Exec(`
		INSERT INTO api_tokens (name, token_hash, token_prefix, token_suffix)
		VALUES (?, ?, ?, ?)
	`, input.Name, tokenHash, prefix, suffix)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存 token 失败"})
		return
	}

	id, _ := result.LastInsertId()
	writeJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"name":   input.Name,
		"token":  rawToken, // 明文仅此一次返回
		"prefix": prefix,
		"suffix": suffix,
	})
}

// handleUpdateToken PUT /api/tokens/{id}
func (s *Server) handleUpdateToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的 ID"})
		return
	}

	var input struct {
		Name string `json:"name"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if input.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "名称不能为空"})
		return
	}

	res, err := s.db.Exec(`UPDATE api_tokens SET name = ? WHERE id = ?`, input.Name, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新失败"})
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Token 不存在"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleDeleteToken DELETE /api/tokens/{id}
func (s *Server) handleDeleteToken(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的 ID"})
		return
	}

	res, err := s.db.Exec(`DELETE FROM api_tokens WHERE id = ?`, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除失败"})
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Token 不存在"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// verifyAPIToken 验证 API Token 并更新 last_used_at。
// 返回 (found, err)：err 非 nil 是数据库故障（调用方应回 500 而非 401，
// 否则 DB 抖动会被 agent 误读成 token 失效去换 token，越换越乱）。
func (s *Server) verifyAPIToken(tokenStr string) (bool, error) {
	tokenHash := hashTokenSHA256(tokenStr)
	var id int
	err := s.db.QueryRow(`SELECT id FROM api_tokens WHERE token_hash = ?`, tokenHash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// 异步更新 last_used_at
	go func() {
		now := time.Now().UTC().Format("2006-01-02 15:04:05")
		s.db.Exec(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, now, id)
	}()
	// 补写 prefix/suffix（兼容老数据）
	prefix := tokenStr[:12]
	suffix := tokenStr[len(tokenStr)-4:]
	s.db.Exec(`UPDATE api_tokens SET token_prefix = ?, token_suffix = ? WHERE id = ? AND token_prefix = ''`,
		prefix, suffix, id)
	return true, nil
}
