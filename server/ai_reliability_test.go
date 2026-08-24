package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"lumen/server/db"
)

func TestRetryableAIStatusOnlyMatchesTransientResponses(t *testing.T) {
	for _, status := range []int{408, 429, 500, 502, 503, 504} {
		if !isRetryableAIStatus(status) {
			t.Fatalf("status %d should be retryable", status)
		}
	}
	for _, status := range []int{400, 401, 403, 404, 422} {
		if isRetryableAIStatus(status) {
			t.Fatalf("status %d should not be retryable", status)
		}
	}
}

func TestNewOpenAIRequestWithContextCarriesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	req, err := newOpenAIRequestWithContext(ctx, AIConfig{
		APIKey:  "test-key",
		BaseURL: "https://example.com/v1",
	}, map[string]any{"model": "test"})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-req.Context().Done():
	default:
		t.Fatal("request context did not inherit cancellation")
	}
}

func TestCallAIRepeatsTransientProviderFailureOnce(t *testing.T) {
	var attempts atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if attempts.Add(1) == 1 {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = io.WriteString(w, `{"error":{"message":"temporary"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"{\"title_cn\":\"测试 - 页面\",\"description_cn\":\"这是一个测试页面描述\"}"}}]}`)
	}))
	defer provider.Close()

	previousClient := aiClient
	aiClient = provider.Client()
	defer func() { aiClient = previousClient }()

	result, err := callAIWithContext(context.Background(), AIConfig{
		Provider:  "custom",
		Model:     "test-model",
		APIKey:    "test-key",
		BaseURL:   provider.URL,
		APIFormat: "openai",
	}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 2 {
		t.Fatalf("attempts = %d, want one retry", attempts.Load())
	}
	if result == "" {
		t.Fatal("expected provider response after retry")
	}
}

func TestUpdateActiveAIConfigReloadsMemory(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "lumen-ai-test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}

	InitEncryption("test-jwt-secret")
	srv := &Server{
		db:     database,
		config: &Config{JWTSecret: "test-jwt-secret", AI: AIConfig{Provider: "deepseek", Model: "old-model", APIKey: "old-key", BaseURL: "https://old.example/v1"}},
	}
	id, err := srv.saveProviderConfig(0, "deepseek", "测试", "old-model", "old-key", "https://old.example/v1", "openai", 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.setActiveConfig(id); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(map[string]any{
		"configId":    id,
		"provider":    "deepseek",
		"displayName": "测试",
		"model":       "new-model",
		"apiKey":      "new-key",
		"baseUrl":     "https://new.example/v1",
		"apiFormat":   "openai",
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/ai-settings", bytes.NewReader(body))
	res := httptest.NewRecorder()
	srv.handleUpdateAISettings(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	got := srv.getAIConfig()
	if got.Model != "new-model" || got.APIKey != "new-key" || got.BaseURL != "https://new.example/v1" {
		t.Fatalf("active config = %+v, want updated in-memory config", got)
	}
}
