package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestParseAIResultNormalizesTitleToSiteAndPageTemplate(t *testing.T) {
	result, err := parseAIResult(`{"title_cn":"Starter Story：真实盈利创业项目数据库"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := result["title_cn"]; got != "Starter Story - 真实盈利创业项目数据库" {
		t.Fatalf("title_cn = %q, want fixed site-and-page template", got)
	}
}

func TestParseAIResultDropsGenericPageSuffix(t *testing.T) {
	result, err := parseAIResult(`{"title_cn":"DeepSeek API Docs - 提示词库页面"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := result["title_cn"]; got != "DeepSeek API Docs - 提示词库" {
		t.Fatalf("title_cn = %q, want a meaningful page purpose without generic suffix", got)
	}
}

func TestNormalizeAITagsKeepsThreeSimpleChineseTerms(t *testing.T) {
	got := normalizeAITags("提示词库, Prompt, DeepSeek, 代码助手, 写作助手, 角色扮演, 代码助手")
	if got != "提示词库,代码助手,写作助手" {
		t.Fatalf("normalizeAITags() = %q, want four simple Chinese terms", got)
	}
}

func TestNormalizeAITagsStripsAIPrefix(t *testing.T) {
	got := normalizeAITags("AI 排行,模型评测,AI评测,人工智能助手,大模型")
	if got != "排行,模型评测,评测" {
		t.Fatalf("normalizeAITags() = %q, want AI prefixes stripped and deduped", got)
	}
}

func TestValidateAIResultRequiresEvidenceAndExistingCategory(t *testing.T) {
	evidence := "OpenClaw is a personal AI assistant that connects models, tools, and messaging channels."
	valid := map[string]string{
		"title_cn":          "OpenClaw - 个人智能助手",
		"description_cn":    "在本地设备与常用聊天渠道运行的个人智能助手，可连接模型、工具和消息服务。",
		"tags":              "个人助手,智能代理,本地运行",
		"category":          "分类甲",
		"category_evidence": "personal AI assistant",
	}
	if err := validateAIResult(valid, []string{"分类甲", "分类乙"}, evidence); err != nil {
		t.Fatal(err)
	}

	valid["tags"] = "个人助手,智能代理"
	// Qwen/MiniMax 常给 1-2 个标签，强卡"恰好3"会整体作废可用结果（生产 30 天 6 次误伤），
	// 已放宽为至少 1 个；0 个仍拒绝
	if err := validateAIResult(valid, []string{"分类甲", "分类乙"}, evidence); err != nil {
		t.Fatalf("two usable tags must pass, got %v", err)
	}

	invalid := map[string]string{
		"title_cn":       "Your own personal AI assistant",
		"description_cn": "Your own personal AI assistant. Any OS. Any platform.",
		"tags":           "",
		"category":       "未知分类",
	}
	if err := validateAIResult(invalid, []string{"分类甲", "分类乙"}, evidence); err == nil {
		t.Fatal("expected incomplete English result to be rejected")
	}
}

func TestFormatCategoryProfilesUsesOnlyProvidedSamples(t *testing.T) {
	profiles := []categoryProfile{{
		Name:     "分类甲",
		Examples: []string{"例子标题：例子描述", "第二个例子"},
	}}
	got := formatCategoryProfiles(profiles)
	if !strings.Contains(got, "分类甲") || !strings.Contains(got, "例子标题") {
		t.Fatalf("profile text = %q, want category and its examples", got)
	}
}

func TestUsesAnthropicFormatForSelectedProviders(t *testing.T) {
	for _, provider := range []string{"custom", "deepseek", "zhipu"} {
		if !usesAnthropicFormat(AIConfig{Provider: provider, APIFormat: "anthropic"}) {
			t.Fatalf("%s Anthropic selection must use Messages format", provider)
		}
		if usesAnthropicFormat(AIConfig{Provider: provider, APIFormat: "openai"}) {
			t.Fatalf("%s OpenAI selection must use Chat Completions", provider)
		}
	}
}

func TestDefaultBaseURLFollowsAPIFormat(t *testing.T) {
	tests := []struct {
		provider  string
		apiFormat string
		want      string
	}{
		{"deepseek", "openai", "https://api.deepseek.com/v1"},
		{"deepseek", "anthropic", "https://api.deepseek.com/anthropic"},
		{"zhipu", "openai", "https://open.bigmodel.cn/api/coding/paas/v4"},
		{"zhipu", "anthropic", "https://open.bigmodel.cn/api/anthropic"},
		{"mimo", "openai", "https://api.xiaomimimo.com/v1"},
		{"mimo", "anthropic", "https://api.xiaomimimo.com/anthropic"},
	}
	for _, tt := range tests {
		if got := defaultBaseURL(tt.provider, tt.apiFormat); got != tt.want {
			t.Fatalf("defaultBaseURL(%q, %q) = %q, want %q", tt.provider, tt.apiFormat, got, tt.want)
		}
	}
}

func TestCustomOpenAIRequestUsesChatCompletionsTransport(t *testing.T) {
	req, err := newOpenAIRequest(AIConfig{
		Provider: "custom",
		APIKey:   "test-key",
		BaseURL:  "https://api.deepseek.com/v1/",
	}, map[string]any{"model": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.String() != "https://api.deepseek.com/v1/chat/completions" {
		t.Fatalf("URL = %q", req.URL)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer test-key" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestCustomDeepSeekDisablesThinkingForMetadataFill(t *testing.T) {
	body := openAIRequestBody(AIConfig{
		Provider: "custom",
		Model:    "deepseek-v4-flash",
		BaseURL:  "https://api.deepseek.com/v1",
	}, "test")
	thinking, ok := body["thinking"].(map[string]string)
	if !ok || thinking["type"] != "disabled" {
		t.Fatalf("thinking = %#v, want disabled", body["thinking"])
	}
}

func TestBookmarkSearchIncludesCategoriesTermsAndLiteralWildcards(t *testing.T) {
	api := newTestAPI(t)
	jwt := login(t, api)
	categoryID := createCategory(t, api, jwt, "Engineering")

	res := api.request(t, "POST", "/api/bookmarks", jwt, BookmarkInput{
		URL:         "https://example.com/precision-search",
		Title:       "Release notes",
		Description: "100% coverage for user_name",
		CategoryID:  &categoryID,
		Tags:        []string{"release"},
	})
	requireStatus(t, res, 201)
	res = api.request(t, "POST", "/api/bookmarks", jwt, BookmarkInput{
		URL:   "https://example.com/near-match",
		Title: "100X coverage for userXname",
	})
	requireStatus(t, res, 201)

	assertSearchIDs := func(search string, want []int64) {
		t.Helper()
		got := listBookmarks(t, api, jwt, "/api/bookmarks?search="+url.QueryEscape(search))
		if len(got) != len(want) {
			t.Fatalf("search %q returned %d bookmarks, want %d: %+v", search, len(got), len(want), got)
		}
		for i, id := range want {
			if got[i].ID != id {
				t.Fatalf("search %q result %d id = %d, want %d", search, i, got[i].ID, id)
			}
		}
	}

	assertSearchIDs("Engineering", []int64{1})
	assertSearchIDs("release precision", []int64{1})
	assertSearchIDs("release absent", nil)
	assertSearchIDs("100%", []int64{1})
	assertSearchIDs("user_name", []int64{1})
}

func TestExtractPageMetaUsesPriorityAndKeepsTitleFallbackAndQualifier(t *testing.T) {
	meta := extractPageMeta(strings.NewReader(`<!doctype html><html><head>
		<meta name="description" content="plain description">
		<meta name="twitter:description" content="twitter description">
		<meta property="og:description" content="og description">
		<title>Feature flags - Project documentation</title>
	</head><body></body></html>`))
	if meta.Description != "og description" {
		t.Fatalf("description = %q, want og description", meta.Description)
	}
	if meta.Title != "Feature flags - Project documentation" {
		t.Fatalf("title = %q, want full page qualifier", meta.Title)
	}
}

func TestExtractPageMetaFinalizesAtBodyWithoutClosingHead(t *testing.T) {
	meta := extractPageMeta(strings.NewReader(`<!doctype html><html><head>
		<title>Feature flags - Project documentation</title>
		<meta name="twitter:description" content="twitter description">
		<body><p>Body fallback must not replace complete head metadata.</p></body></html>`))
	if meta.Title != "Feature flags - Project documentation" {
		t.Fatalf("title = %q, want title fallback before body", meta.Title)
	}
	if meta.Description != "twitter description" {
		t.Fatalf("description = %q, want twitter description", meta.Description)
	}
}
