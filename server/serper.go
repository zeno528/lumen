package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// handleGetSerperKey GET /api/serper-key — 返回 Serper key 是否已配置 + 掩码提示
func (s *Server) handleGetSerperKey(w http.ResponseWriter, r *http.Request) {
	key := s.getSerperKey()
	writeJSON(w, http.StatusOK, map[string]any{
		"hasKey":  key != "",
		"keyHint": maskKeyIfPresent(key),
	})
}

// handleSaveSerperKey POST /api/serper-key — 保存 Serper key（加密入库 + 热更新内存，无需重启）
func (s *Server) handleSaveSerperKey(w http.ResponseWriter, r *http.Request) {
	var input struct {
		APIKey string `json:"apiKey"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	input.APIKey = strings.TrimSpace(input.APIKey)
	if input.APIKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Serper Key 不能为空"})
		return
	}

	enc, err := Encrypt(input.APIKey)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "加密失败"})
		return
	}
	if _, err := s.db.Exec("INSERT INTO settings (key, value) VALUES ('serper_api_key_encrypted', ?) ON CONFLICT(key) DO UPDATE SET value = ?", enc, enc); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存失败"})
		return
	}
	s.configMu.Lock()
	s.config.SerperAPIKey = input.APIKey // 热更新，无需重启服务
	s.configMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"keyHint": maskKeyIfPresent(input.APIKey),
	})
}

// handleTestSerperKey POST /api/serper-key/test — 测试 Serper key 是否有效（发一次最小查询）
// 支持前端传未保存的 key 来测试；不传则用已配置的 key
func (s *Server) handleTestSerperKey(w http.ResponseWriter, r *http.Request) {
	key := s.getSerperKey()
	var input struct {
		APIKey string `json:"apiKey"`
	}
	json.NewDecoder(r.Body).Decode(&input)
	if strings.TrimSpace(input.APIKey) != "" {
		key = strings.TrimSpace(input.APIKey)
	}
	if key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "未配置 Serper Key"})
		return
	}

	start := time.Now()
	bodyBytes, _ := json.Marshal(map[string]any{"q": "test", "num": 1})
	req, err := http.NewRequest("POST", "https://google.serper.dev/search", bytes.NewReader(bodyBytes))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "请求构造失败"})
		return
	}
	req.Header.Set("X-API-KEY", key)
	req.Header.Set("Content-Type", "application/json")

	resp, err := aiClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "请求失败: " + err.Error(), "latency": latency})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b))), "latency": latency})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "latency": latency})
}

// handleDeleteSerperKey DELETE /api/serper-key — 清除 Serper key
func (s *Server) handleDeleteSerperKey(w http.ResponseWriter, r *http.Request) {
	s.db.Exec("DELETE FROM settings WHERE key = 'serper_api_key_encrypted'")
	s.configMu.Lock()
	s.config.SerperAPIKey = ""
	s.configMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// loadSerperKeyFromDB 从数据库加载 Serper key 到内存（启动时调用，数据库优先于环境变量）
func (s *Server) loadSerperKeyFromDB() {
	var enc string
	if err := s.db.QueryRow("SELECT value FROM settings WHERE key = 'serper_api_key_encrypted'").Scan(&enc); err == nil && enc != "" {
		if dec, err := Decrypt(enc); err == nil {
			s.configMu.Lock()
			s.config.SerperAPIKey = dec
			s.configMu.Unlock()
		}
	}
}

// maskKeyIfPresent 非空时掩码，空则返回空串
func maskKeyIfPresent(key string) string {
	if key == "" {
		return ""
	}
	return maskKey(key)
}
