package main

import (
	"fmt"
	"log"
	"strconv"
	"time"
)

// ProviderConfig 单个配置（完整，含加密 key）
type ProviderConfig struct {
	ID              int64
	Provider        string
	DisplayName     string
	Model           string
	APIKeyEncrypted string
	BaseURL         string
	APIFormat       string
	KeyCreatedAt    string
	KeyLastUsedAt   string
}

// SavedConfigSummary 前端展示用摘要（不含密钥明文）
type SavedConfigSummary struct {
	ID           int64  `json:"id"`
	Provider     string `json:"provider"`
	DisplayName  string `json:"displayName"`
	Model        string `json:"model"`
	BaseURL      string `json:"baseUrl"`
	APIFormat    string `json:"apiFormat"`
	HasKey       bool   `json:"hasKey"`
	KeyHint      string `json:"keyHint"`
	KeyCreatedAt string `json:"keyCreatedAt"`
}

// saveProviderConfig 写入/更新配置。id=0 新增（生成 id 并返回），id>0 更新。
// 空 key：优先当前配置 key（编辑），否则从 sourceConfigID 复制加密 key（复制场景）。
func (s *Server) saveProviderConfig(id int64, provider, displayName, model, apiKeyPlain, baseURL, apiFormat string, sourceConfigID int64) (int64, error) {
	encryptedKey := ""
	createdAt := ""

	if apiKeyPlain != "" {
		enc, err := Encrypt(apiKeyPlain)
		if err != nil {
			return 0, err
		}
		encryptedKey = enc
		createdAt = time.Now().Format("2006-01-02 15:04")
	} else {
		// 空 key：优先当前配置的 key
		if id > 0 {
			s.db.QueryRow("SELECT api_key_encrypted FROM ai_provider_configs WHERE id = ?", id).Scan(&encryptedKey)
			s.db.QueryRow("SELECT key_created_at FROM ai_provider_configs WHERE id = ?", id).Scan(&createdAt)
		}
		// 仍为空：复制场景，从 source 配置复制加密 key（不再隐式复用同 provider）
		if encryptedKey == "" && sourceConfigID > 0 {
			s.db.QueryRow("SELECT api_key_encrypted FROM ai_provider_configs WHERE id = ?", sourceConfigID).Scan(&encryptedKey)
			s.db.QueryRow("SELECT key_created_at FROM ai_provider_configs WHERE id = ?", sourceConfigID).Scan(&createdAt)
		}
		if createdAt == "" && encryptedKey != "" {
			createdAt = time.Now().Format("2006-01-02 15:04")
		}
	}

	if id > 0 {
		// 更新
		_, err := s.db.Exec(`
			UPDATE ai_provider_configs SET
				provider = ?, display_name = ?, model = ?, api_key_encrypted = ?, base_url = ?, api_format = ?, key_created_at = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, provider, displayName, model, encryptedKey, baseURL, apiFormat, createdAt, id)
		if err != nil {
			return 0, err
		}
		return id, nil
	}

	// 新增
	res, err := s.db.Exec(`
		INSERT INTO ai_provider_configs (provider, display_name, model, api_key_encrypted, base_url, api_format, key_created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, provider, displayName, model, encryptedKey, baseURL, apiFormat, createdAt)
	if err != nil {
		return 0, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	return newID, nil
}

// getProviderConfig 按 id 读取完整配置（含加密 key）。id=0 返回 nil。
func (s *Server) getProviderConfig(id int64) *ProviderConfig {
	if id == 0 {
		return nil
	}
	var cfg ProviderConfig
	err := s.db.QueryRow(
		"SELECT id, provider, display_name, model, api_key_encrypted, base_url, api_format, key_created_at, key_last_used_at FROM ai_provider_configs WHERE id = ?",
		id,
	).Scan(&cfg.ID, &cfg.Provider, &cfg.DisplayName, &cfg.Model, &cfg.APIKeyEncrypted, &cfg.BaseURL, &cfg.APIFormat, &cfg.KeyCreatedAt, &cfg.KeyLastUsedAt)
	if err != nil {
		return nil
	}
	return &cfg
}

// listProviderConfigs 列出所有配置摘要（含 id，按 id 排序）
func (s *Server) listProviderConfigs() []SavedConfigSummary {
	rows, err := s.db.Query("SELECT id, provider, display_name, model, base_url, api_format, api_key_encrypted, key_created_at FROM ai_provider_configs ORDER BY id")
	if err != nil {
		return nil
	}
	defer rows.Close()

	var result []SavedConfigSummary
	for rows.Next() {
		var id int64
		var provider, displayName, model, baseURL, apiFormat, encKey, createdAt string
		if err := rows.Scan(&id, &provider, &displayName, &model, &baseURL, &apiFormat, &encKey, &createdAt); err != nil {
			continue
		}
		summary := SavedConfigSummary{
			ID:           id,
			Provider:     provider,
			DisplayName:  displayName,
			Model:        model,
			BaseURL:      baseURL,
			APIFormat:    apiFormat,
			HasKey:       encKey != "",
			KeyCreatedAt: createdAt,
		}
		if encKey != "" {
			if dec, err := Decrypt(encKey); err == nil {
				summary.KeyHint = maskKey(dec)
			}
		}
		result = append(result, summary)
	}
	return result
}

// deleteProviderConfig 按 id 删除
func (s *Server) deleteProviderConfig(id int64) error {
	_, err := s.db.Exec("DELETE FROM ai_provider_configs WHERE id = ?", id)
	return err
}

// getActiveConfigID 读取当前激活的配置 id（0=未激活/env 模式）
func (s *Server) getActiveConfigID() int64 {
	var val string
	s.db.QueryRow("SELECT value FROM settings WHERE key = 'ai_active_config_id'").Scan(&val)
	id, _ := strconv.ParseInt(val, 10, 64)
	return id
}

// clearActiveConfig 清空激活指针和内存中的 AI 配置
func (s *Server) clearActiveConfig() {
	s.db.Exec("DELETE FROM settings WHERE key = 'ai_active_config_id'")
	s.configMu.Lock()
	defer s.configMu.Unlock()
	s.config.AI = AIConfig{} // 清零：ConfigID=0 + 各字段空串
}

// setActiveConfig 切换激活配置，同时更新内存配置
func (s *Server) setActiveConfig(id int64) error {
	val := fmt.Sprintf("%d", id)
	_, err := s.db.Exec("INSERT INTO settings (key, value) VALUES ('ai_active_config_id', ?) ON CONFLICT(key) DO UPDATE SET value = ?", val, val)
	if err != nil {
		return err
	}

	cfg := s.getProviderConfig(id)
	if cfg == nil {
		log.Printf("setActiveConfig: config id %d 无保存配置", id)
		return nil
	}

	s.configMu.Lock()
	defer s.configMu.Unlock()
	s.config.AI.ConfigID = cfg.ID
	s.config.AI.Provider = cfg.Provider
	s.config.AI.Model = cfg.Model
	s.config.AI.BaseURL = cfg.BaseURL
	s.config.AI.APIFormat = cfg.APIFormat
	if cfg.APIKeyEncrypted != "" {
		if dec, err := Decrypt(cfg.APIKeyEncrypted); err == nil {
			s.config.AI.APIKey = dec
		}
	}
	return nil
}
