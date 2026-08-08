package main

import (
	"encoding/json"
	"net/http"
)

// 用户偏好设置（settings 表 key-value）。
// id_search_mode：搜索框 ID 模式开关——存数据库而非浏览器缓存，跨设备同步
// （电脑端开启，移动端打开时保持）。

// handleGetIdSearchMode GET /api/settings/id-search-mode — 读 ID 搜索模式
func (s *Server) handleGetIdSearchMode(w http.ResponseWriter, r *http.Request) {
	var v string
	if err := s.db.QueryRow("SELECT value FROM settings WHERE key = 'id_search_mode'").Scan(&v); err != nil {
		v = "" // 未设置过 = 默认关
	}
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": v == "1"})
}

// handleSetIdSearchMode PUT /api/settings/id-search-mode — 写 ID 搜索模式
func (s *Server) handleSetIdSearchMode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体格式错误"})
		return
	}
	v := "0"
	if req.Enabled {
		v = "1"
	}
	if _, err := s.db.Exec("INSERT INTO settings (key, value) VALUES ('id_search_mode', ?) ON CONFLICT(key) DO UPDATE SET value = ?", v, v); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
