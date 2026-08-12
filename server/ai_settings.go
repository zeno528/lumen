package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

// 允许的 provider 列表
var allowedProviders = map[string]bool{
	"deepseek":    true,
	"zhipu":       true,
	"minimax":     true,
	"siliconflow": true,
	"custom":      true,
}

// 预设厂商默认值
var providerDefaults = map[string]struct {
	Model   string
	BaseURL string
}{
	"deepseek":    {"deepseek-v4-flash", "https://api.deepseek.com/v1"},
	"zhipu":       {"glm-4.7-flash", "https://open.bigmodel.cn/api/paas/v4"},
	"minimax":     {"MiniMax-M3", "https://api.minimaxi.com/anthropic"},
	"siliconflow": {"Qwen/Qwen3.5-122B-A10B", "https://api.siliconflow.cn/v1"},
}

// maskKey 对 API 密钥做掩码处理，前8位明文 + 后4位明文，中间掩码（显示 sk-9fef2 这种前缀便于辨认是哪个 key）
func maskKey(key string) string {
	if len(key) <= 12 {
		return "****"
	}
	return key[:8] + "****" + key[len(key)-4:]
}

// handleGetAISettings GET /api/ai-settings
func (s *Server) handleGetAISettings(w http.ResponseWriter, r *http.Request) {
	activeConfigID := s.getActiveConfigID()
	var activeProvider, model, baseURL, keyCreatedAt, keyLastUsed string
	var hasKey bool
	var keyHint string

	if activeConfigID > 0 {
		cfg := s.getProviderConfig(activeConfigID)
		if cfg != nil {
			activeProvider = cfg.Provider
			model = cfg.Model
			baseURL = cfg.BaseURL
			keyCreatedAt = cfg.KeyCreatedAt
			keyLastUsed = cfg.KeyLastUsedAt
			if cfg.APIKeyEncrypted != "" {
				hasKey = true
				if dec, err := Decrypt(cfg.APIKeyEncrypted); err == nil {
					keyHint = maskKey(dec)
				}
			}
		}
	}

	// 数据库无激活配置时回退环境变量
	if activeProvider == "" {
		ai := s.getAIConfig()
		provider := ai.Provider
		model = ai.Model
		baseURL = ai.BaseURL
		if ai.APIKey != "" {
			writeJSON(w, http.StatusOK, map[string]any{
				"activeConfigId": 0,
				"activeProvider": provider,
				"provider":       provider,
				"model":          model,
				"hasKey":         true,
				"keyHint":        maskKey(ai.APIKey),
				"baseUrl":        baseURL,
				"keyCreatedAt":   "",
				"keyLastUsed":    "",
				"source":         "env",
				"savedConfigs":   s.listProviderConfigs(),
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"activeConfigId": 0,
			"activeProvider": "",
			"provider":       "",
			"model":          "",
			"hasKey":         false,
			"keyHint":        "",
			"baseUrl":        "",
			"source":         "env",
			"savedConfigs":   s.listProviderConfigs(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"activeConfigId": activeConfigID,
		"activeProvider": activeProvider,
		"provider":       activeProvider,
		"model":          model,
		"hasKey":         hasKey,
		"keyHint":        keyHint,
		"baseUrl":        baseURL,
		"keyCreatedAt":   keyCreatedAt,
		"keyLastUsed":    keyLastUsed,
		"source":         "db",
		"savedConfigs":   s.listProviderConfigs(),
	})
}

// handleUpdateAISettings PUT /api/ai-settings -- configId=0 新增，>0 更新，返回新 configId
func (s *Server) handleUpdateAISettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ConfigID    int64  `json:"configId"`
		Provider    string `json:"provider"`
		DisplayName string `json:"displayName"`
		Model       string `json:"model"`
		APIKey      string `json:"apiKey"`
		BaseURL     string `json:"baseUrl"`
		APIFormat   string `json:"apiFormat"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	input.Provider = strings.TrimSpace(input.Provider)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.Model = strings.TrimSpace(input.Model)
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	input.APIFormat = strings.TrimSpace(input.APIFormat)

	if !allowedProviders[input.Provider] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不支持的提供商"})
		return
	}
	if input.Provider == "custom" && input.APIFormat != "anthropic" {
		input.APIFormat = "openai"
	}

	// 预设厂商自动填充默认值
	if defaults, ok := providerDefaults[input.Provider]; ok {
		if input.Model == "" {
			input.Model = defaults.Model
		}
		if input.BaseURL == "" {
			input.BaseURL = defaults.BaseURL
		}
	}

	if input.Model == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "模型名称不能为空"})
		return
	}

	// 新增（configId=0）必须填密钥--新增走预设全新填，不再复用同 provider 已存 key
	if input.APIKey == "" && input.ConfigID == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "API 密钥不能为空"})
		return
	}

	newID, err := s.saveProviderConfig(input.ConfigID, input.Provider, input.DisplayName, input.Model, input.APIKey, input.BaseURL, input.APIFormat, 0)
	if err != nil {
		log.Printf("保存配置失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存设置失败"})
		return
	}

	s.broadcastInvalidated("ai-settings")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"configId": newID,
		"message":  "AI 设置已保存",
	})
}

// handleCopyConfig POST /api/ai-settings/copy -- 复制配置（含加密密钥），返回新 configId
func (s *Server) handleCopyConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ConfigID    int64  `json:"configId"`
		DisplayName string `json:"displayName"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	src := s.getProviderConfig(input.ConfigID)
	if src == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "原配置不存在"})
		return
	}
	newName := strings.TrimSpace(input.DisplayName)
	if newName == "" {
		newName = src.DisplayName
	}
	if newName == "" {
		newName = src.Provider
	}
	newName += " copy"
	newID, err := s.saveProviderConfig(0, src.Provider, newName, src.Model, "", src.BaseURL, src.APIFormat, src.ID)
	if err != nil {
		log.Printf("复制配置失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "复制失败"})
		return
	}
	s.broadcastInvalidated("ai-settings")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "configId": newID})
}

// handleSwitchAIProvider PUT /api/ai-settings/switch - 切换激活配置。configId=0 = 取消激活
func (s *Server) handleSwitchAIProvider(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ConfigID int64 `json:"configId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if input.ConfigID == 0 {
		s.clearActiveConfig()
		s.broadcastInvalidated("ai-settings")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	cfg := s.getProviderConfig(input.ConfigID)
	if cfg == nil || cfg.APIKeyEncrypted == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "该配置不存在或缺少密钥"})
		return
	}

	if err := s.setActiveConfig(input.ConfigID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "切换失败"})
		return
	}

	keyHint := ""
	if dec, err := Decrypt(cfg.APIKeyEncrypted); err == nil {
		keyHint = maskKey(dec)
	}

	s.broadcastInvalidated("ai-settings")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"model":   cfg.Model,
		"baseUrl": cfg.BaseURL,
		"hasKey":  cfg.APIKeyEncrypted != "",
		"keyHint": keyHint,
	})
}

// handleDeleteAIProviderConfig DELETE /api/ai-settings/config/{id}
func (s *Server) handleDeleteAIProviderConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的配置 id"})
		return
	}

	if err := s.deleteProviderConfig(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除失败"})
		return
	}

	// 删的是 active 则清空激活
	if s.getActiveConfigID() == id {
		s.clearActiveConfig()
	}

	s.broadcastInvalidated("ai-settings")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "已删除配置",
	})
}

// ReloadAIConfig 从数据库重新加载激活配置到内存
func (s *Server) ReloadAIConfig() {
	activeConfigID := s.getActiveConfigID()
	if activeConfigID == 0 {
		return
	}

	cfg := s.getProviderConfig(activeConfigID)
	if cfg == nil {
		return
	}

	s.configMu.Lock()
	defer s.configMu.Unlock()
	s.config.AI.ConfigID = cfg.ID
	s.config.AI.Provider = cfg.Provider
	s.config.AI.Model = cfg.Model
	s.config.AI.BaseURL = cfg.BaseURL
	if cfg.APIKeyEncrypted != "" {
		if dec, err := Decrypt(cfg.APIKeyEncrypted); err == nil {
			s.config.AI.APIKey = dec
		}
	}
}
