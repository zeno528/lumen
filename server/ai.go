package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
)

var aiClient = &http.Client{
	Timeout: 30 * time.Second,
}

// categoryExamples 分类 few-shot 示例池：仅当示例的分类名确实出现在用户已有分类中才注入
// （保证示例的标签空间与真实分类一致；few-shot 中格式/标签空间比示例本身更关键，见 Min et al. 2022）
var categoryExamples = []struct{ url, category string }{
	{"https://platform.openai.com/", "AI工具"},
	{"https://huggingface.co/", "AI工具"},
	{"https://github.com/", "开发工具"},
	{"https://www.docker.com/", "开发工具"},
	{"https://www.figma.com/", "UI设计"},
	{"https://www.vultr.com/", "VPS工具"},
	{"https://www.namecheap.com/", "域名购买"},
}

// aiTestClient 单独给 /api/ai-test 用：测试是 max_tokens:1 最小探针，正常 2~5s 应答，
// 15s 兜底覆盖抖动又远小于 aiClient 的 30s（避免用户看 30s spinner 以为卡死）。
// 前端兜底 10~12s 自动 abort，后端 15s 是最后防线，须 > 前端。
var aiTestClient = &http.Client{
	Timeout: 15 * time.Second,
}

// aiSystemPrompt 统一系统提示词：设定角色 + 强制 JSON 输出（OpenAI / Anthropic 路径共用，避免两处硬编码）
const aiSystemPrompt = "你是一个书签信息提取助手。用户会给你URL和页面信息，你必须严格按照要求的JSON格式回复。不要解释，不要输出规则内容，只输出JSON。"

// ==================== 通用逻辑 ====================

// handleAIMeta POST /api/ai-meta — 本地提取 + AI 翻译
func (s *Server) handleAIMeta(w http.ResponseWriter, r *http.Request) {
	ai := s.getAIConfig()
	if ai.Provider == "" || ai.APIKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "AI 功能未配置 (需设置 AI_PROVIDER 和 AI_API_KEY 环境变量)"})
		return
	}

	var req struct {
		URL        string   `json:"url"`
		Categories []string `json:"categories"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少 url 参数"})
		return
	}

	// ========== 第一层：本地 Tokenizer 提取 ==========
	t1 := time.Now()
	meta := fetchPageMetaStreaming(req.URL)
	log.Printf("[AI Meta] 本地提取耗时: %v", time.Since(t1))

	// 第一层抓空（反爬 403 / JS 渲染站直连拿不到）→ Serper 搜索兜底：借 Google 拿 title + snippet
	usedSerper := false
	serperKey := s.getSerperKey()
	if meta.Title == "" && meta.Description == "" && serperKey != "" {
		tSerper := time.Now()
		if sm := searchSerper(req.URL, serperKey); sm.Title != "" || sm.Description != "" {
			meta = sm
			usedSerper = true
			log.Printf("[AI Meta] Serper 兜底命中, 耗时: %v", time.Since(tSerper))
		} else {
			log.Printf("[AI Meta] Serper 兜底未命中, 耗时: %v", time.Since(tSerper))
		}
	}

	// ========== 第二层：构建轻量 Prompt ==========
	var prompt string
	// 清洗标题：去掉 "GitHub - owner/repo: ..." 前缀
	meta.Title = cleanTitle(meta.Title)
	// 清洗描述：去掉 GitHub 仓库后缀（如 " - owner/repo"）
	if meta.Description != "" && strings.Contains(meta.Description, " - ") {
		parts := strings.SplitN(meta.Description, " - ", 2)
		if strings.Contains(parts[1], "GitHub") || strings.Contains(parts[1], "/") {
			meta.Description = strings.TrimSpace(parts[0])
		}
	}

	// 构建分类排除提示
	tagExclude := ""
	// 分类建议提示：优先复用已有分类，其次新建
	categoryRule := "- category: 给出这个网站所属的中文分类名（2-6字）"
	// few-shot 示例块：只注入分类名确实在用户已有分类里的示例，保持标签空间一致
	examplesBlock := ""
	if len(req.Categories) > 0 {
		tagExclude = "\n- tags 不要使用以下已有分类名: " + strings.Join(req.Categories, "、")
		categoryRule = "- category: 必须从已有分类中选出语义最匹配、最具体的一个并原样返回其名称（禁止选宽泛分类）；仅当都不合适时才新建（2-6字）"
		catSet := make(map[string]bool, len(req.Categories))
		for _, c := range req.Categories {
			catSet[strings.TrimSpace(c)] = true
		}
		var exs []string
		for _, ex := range categoryExamples {
			if catSet[ex.category] {
				exs = append(exs, fmt.Sprintf("<example><url>%s</url><category>%s</category></example>", ex.url, ex.category))
			}
		}
		if len(exs) > 0 {
			examplesBlock = "\n<examples>\n" + strings.Join(exs, "\n") + "\n</examples>"
		}
	}

	if meta.Title != "" || meta.Description != "" {
		// 本地提取到了内容，AI 只需翻译
		prompt = fmt.Sprintf(`你是一个书签整理专家。根据以下信息生成书签的中文标题、描述、标签和分类。技术术语保留英文。

<rules>
- title_cn: 严格使用“网站名 - 页面用途”格式；网站名在前，中间只能使用半角空格-半角空格，禁止使用冒号、竖线或破折号；页面用途只写有信息量的主题或动作，禁止以“页面”“网站”“文档”结尾
- description_cn: 必填，一句话说明这个精确页面收录的具体内容或能完成的动作；禁止只介绍整个网站、模型或品牌，30-60字
- URL 中有意义的路径、查询参数或片段标识的是精确页面；title_cn 和 description_cn 必须描述该页面，不得退回成通用网站介绍
- 只根据提供的 URL 和页面证据输出事实；没有证据不得补充或猜测
- tags: 必须给出恰好4个用户日常会输入的中文检索词，每个2-8字，英文逗号分隔；少于或多于4个都不合格；优先页面主题、用途、对象的简单常用叫法；即使标题或描述已有相同词也要保留，禁止英文、复杂专业术语、宽泛词和重复标签；排除 AI、工具、平台、网站、示例等宽泛标签%s
- %s
- 无论原文是什么语言，都要翻译成中文并精简到30-60字，不要堆砌细节
- 只输出JSON，不用解释: {"title_cn":"网站名 - 页面用途","description_cn":"...","tags":"标签1,标签2,标签3,标签4","category":"分类名"}
</rules>

<categories>%s</categories>%s

<page>
URL: %s
页面标题: %s
页面描述: %s
</page>`, tagExclude, categoryRule, strings.Join(req.Categories, "、"), examplesBlock, req.URL, meta.Title, meta.Description)
	} else {
		// 什么都没抓到，仅依据 URL 中可验证的信息生成。
		prompt = fmt.Sprintf(`你是一个书签整理专家。只根据这个URL中可验证的信息生成中文标题、描述、标签和分类。技术术语保留英文。

<rules>
- title_cn: 严格使用“网站名 - 页面用途”格式；网站名在前，中间只能使用半角空格-半角空格，禁止使用冒号、竖线或破折号；页面用途只写有信息量的主题或动作，禁止以“页面”“网站”“文档”结尾
- description_cn: 必填，只根据 URL 中可验证的信息说明这个精确页面的具体内容或能完成的动作；禁止只介绍整个网站、模型或品牌，30-60字
- URL 中有意义的路径、查询参数或片段标识的是精确页面；title_cn 和 description_cn 必须描述该页面，不得退回成通用网站介绍
- 只根据提供的 URL 和页面证据输出事实；没有证据不得补充或猜测
- tags: 必须给出恰好4个用户日常会输入的中文检索词，每个2-8字，英文逗号分隔；少于或多于4个都不合格；优先页面主题、用途、对象的简单常用叫法；即使标题或描述已有相同词也要保留，禁止英文、复杂专业术语、宽泛词和重复标签；排除 AI、工具、平台、网站、示例等宽泛标签%s
- %s
- 只输出JSON，不用解释: {"title_cn":"网站名 - 页面用途","description_cn":"...","tags":"标签1,标签2,标签3,标签4","category":"分类名"}
</rules>

<categories>%s</categories>%s

<page>
URL: %s
</page>`, tagExclude, categoryRule, strings.Join(req.Categories, "、"), examplesBlock, req.URL)
	}

	text, err := callAI(ai, prompt)
	log.Printf("[AI Meta] AI 翻译耗时: %v", time.Since(t1))
	if err != nil {
		log.Printf("AI 翻译失败: %v", err)
		// 兜底：返回本地提取的原始内容
		writeJSON(w, http.StatusOK, map[string]string{
			"title":          meta.Title,
			"description":    meta.Description,
			"title_cn":       meta.Title,
			"description_cn": meta.Description,
			"category":       "",
			"usedSerper":     fmt.Sprint(usedSerper),
		})
		return
	}

	// 兜底：剥离模型输出的 thinking 标签（MiniMax / DeepSeek 等）
	text = regexp.MustCompile(`(?s)<think.*?>.*?</think\s*>`).ReplaceAllString(text, "")
	text = strings.TrimSpace(text)

	result, err := parseAIResult(text)
	if err != nil {
		log.Printf("AI 结果解析失败: %v", err)
		// 兜底：返回本地提取的原始内容
		writeJSON(w, http.StatusOK, map[string]string{
			"title":          meta.Title,
			"description":    meta.Description,
			"title_cn":       meta.Title,
			"description_cn": meta.Description,
			"category":       "",
			"usedSerper":     fmt.Sprint(usedSerper),
		})
		return
	}

	// 组装最终结果：原始内容 + AI 翻译
	if _, ok := result["title_cn"]; !ok {
		result["title_cn"] = meta.Title
	}
	if _, ok := result["description_cn"]; !ok {
		result["description_cn"] = meta.Description
	}
	if _, ok := result["category"]; !ok {
		result["category"] = ""
	}
	if tags, ok := result["tags"]; ok {
		result["tags"] = normalizeAITags(tags)
	}
	result["title"] = meta.Title
	result["description"] = meta.Description
	result["usedSerper"] = fmt.Sprint(usedSerper)

	// 更新最后使用时间（按激活配置 id；env 模式 ConfigID=0 跳过）
	if ai.ConfigID > 0 {
		s.db.Exec("UPDATE ai_provider_configs SET key_last_used_at = ? WHERE id = ?", time.Now().Format("2006-01-02 15:04"), ai.ConfigID)
	}

	writeJSON(w, http.StatusOK, result)
}

// callAI 根据 provider 调用对应的 API，返回响应文本
func callAI(cfg AIConfig, prompt string) (string, error) {
	// 路由按 baseUrl 判断 API 格式（智谱同时支持 paas/v4 OpenAI 格式和 /anthropic Anthropic 格式）：
	// - baseUrl 含 /anthropic（智谱 Anthropic 端点 open.bigmodel.cn/api/anthropic / MiniMax）或 anthropic 原生 -> Anthropic 格式
	// - 否则（智谱 paas/v4 / DeepSeek / 硅基流动 / OpenAI / custom）-> OpenAI 兼容格式
	if strings.Contains(cfg.BaseURL, "/anthropic") || cfg.Provider == "anthropic" {
		return callAnthropicProvider(cfg, prompt)
	}
	return callOpenAIProvider(cfg, prompt)
}

// parseAIResult 从 AI 响应文本中提取 JSON 结果
func parseAIResult(text string) (map[string]string, error) {
	// 正则提取包含 title 的 JSON 对象（匹配 "title" 和 "title_cn" 等）
	jsonRe := regexp.MustCompile(`\{[^{}]*"title[^"]*"[^{}]*\}`)
	match := jsonRe.FindString(text)
	if match != "" {
		text = match
	} else {
		text = strings.TrimSpace(text)
		text = strings.TrimPrefix(text, "```json")
		text = strings.TrimPrefix(text, "```")
		text = strings.TrimSuffix(text, "```")
		text = strings.TrimSpace(text)
	}

	var result map[string]string
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		result = extractFieldsFromText(text)
		if result == nil {
			return nil, fmt.Errorf("解析 AI 结果失败: %v", err)
		}
	}
	if title, ok := result["title_cn"]; ok {
		result["title_cn"] = normalizeAITitle(title)
	}
	return result, nil
}

// normalizeAITitle 把模型常用的标题分隔符统一成“网站名 - 页面用途”。
func normalizeAITitle(title string) string {
	title = strings.TrimSpace(title)
	separators := []string{" - ", "：", ":", "｜", "|", " — ", " – "}
	index, separator := -1, ""
	for _, candidate := range separators {
		if i := strings.Index(title, candidate); i >= 0 && (index == -1 || i < index) {
			index, separator = i, candidate
		}
	}
	if index <= 0 {
		return title
	}

	site := strings.TrimSpace(title[:index])
	purpose := strings.TrimSpace(title[index+len(separator):])
	if purpose == "" {
		return title
	}
	purpose = strings.NewReplacer("：", "，", ":", "，", "｜", "，", "|", "，", " — ", "，", " – ", "，", " - ", "，").Replace(purpose)
	purpose = strings.TrimSuffix(purpose, "页面")
	if purpose == "" {
		return title
	}
	return site + " - " + purpose
}

func normalizeAITags(tags string) string {
	seen := make(map[string]struct{})
	result := make([]string, 0, 4)
	for _, tag := range strings.FieldsFunc(tags, func(r rune) bool { return r == ',' || r == '，' }) {
		tag = strings.TrimSpace(tag)
		key := strings.ToLower(tag)
		if tag == "" || !containsHan(tag) {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, tag)
		if len(result) == 4 {
			break
		}
	}
	return strings.Join(result, ",")
}

func containsHan(text string) bool {
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// ==================== OpenAI 兼容 Provider (DeepSeek / OpenAI / Custom) ====================

type openaiAPIResponse struct {
	Choices []struct {
		Message struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func callOpenAIProvider(cfg AIConfig, prompt string) (string, error) {
	// URL 格式: {baseURL}/chat/completions
	apiURL := strings.TrimRight(cfg.BaseURL, "/") + "/chat/completions"

	reqBody := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]string{
			{"role": "system", "content": aiSystemPrompt},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.3,
		"max_tokens":  1024,
	}
	// 关闭思考模式，避免 thinking 挤占输出致 JSON 解析失败、回退本地英文兜底：
	// - deepseek / zhipu: DeepSeek 官方 / 智谱 GLM-4.7+ 默认开 thinking，用 thinking.type=disabled 关闭
	// - siliconflow: Qwen3.x 默认开 thinking，用 chat_template_kwargs.enable_thinking=false（vLLM 标准）
	//   + 顶层 enable_thinking=false（硅基流动适配）双保险关闭
	switch cfg.Provider {
	case "deepseek", "zhipu":
		reqBody["thinking"] = map[string]string{"type": "disabled"}
	case "siliconflow":
		reqBody["chat_template_kwargs"] = map[string]bool{"enable_thinking": false}
		reqBody["enable_thinking"] = false
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", apiURL, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := aiClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API 返回 %d: %s", resp.StatusCode, string(body))
	}

	var openaiResp openaiAPIResponse
	if err := json.Unmarshal(body, &openaiResp); err != nil {
		return "", fmt.Errorf("解析响应失败: %v", err)
	}

	if openaiResp.Error != nil {
		return "", fmt.Errorf("API 错误: %s", openaiResp.Error.Message)
	}

	if len(openaiResp.Choices) == 0 || openaiResp.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("API 返回空结果")
	}

	return openaiResp.Choices[0].Message.Content, nil
}

// ==================== Anthropic Provider ====================

type anthropicAPIResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func callAnthropicProvider(cfg AIConfig, prompt string) (string, error) {
	// URL 格式: {baseURL}/v1/messages
	apiURL := strings.TrimRight(cfg.BaseURL, "/") + "/v1/messages"

	reqBody := map[string]any{
		"model":  cfg.Model,
		"system": aiSystemPrompt,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.3,
		"max_tokens":  1024,
		"thinking":    map[string]string{"type": "disabled"},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", apiURL, strings.NewReader(string(bodyBytes)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := aiClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API 返回 %d: %s", resp.StatusCode, string(body))
	}

	var anthropicResp anthropicAPIResponse
	if err := json.Unmarshal(body, &anthropicResp); err != nil {
		return "", fmt.Errorf("解析响应失败: %v", err)
	}

	if anthropicResp.Error != nil {
		return "", fmt.Errorf("API 错误: %s", anthropicResp.Error.Message)
	}

	for _, block := range anthropicResp.Content {
		if block.Type == "text" && block.Text != "" {
			return block.Text, nil
		}
	}
	return "", fmt.Errorf("API 返回空结果")
}

// ==================== 兜底解析 ====================

// extractFieldsFromText 从非 JSON 文本中提取 title/description 字段
func extractFieldsFromText(text string) map[string]string {
	result := map[string]string{}

	extract := func(patterns []string) string {
		for _, p := range patterns {
			re := regexp.MustCompile(p)
			matches := re.FindStringSubmatch(text)
			if len(matches) >= 2 {
				val := strings.TrimSpace(matches[len(matches)-1])
				val = strings.TrimPrefix(val, "**")
				val = strings.TrimSuffix(val, "**")
				return strings.TrimSpace(val)
			}
		}
		return ""
	}

	if v := extract([]string{`(?i)title[_\s]*(cn|中文)[:\s]+(.+)`}); v != "" {
		result["title_cn"] = v
	}
	if v := extract([]string{`(?i)description[_\s]*(cn|中文)[:\s]+(.+)`}); v != "" {
		result["description_cn"] = v
	}
	if v := extract([]string{`(?i)title[:\s]+(.+)`}); v != "" {
		result["title"] = v
	}
	if v := extract([]string{`(?i)description[:\s]+(.+)`}); v != "" {
		result["description"] = v
	}

	if len(result) == 0 {
		return nil
	}
	if _, ok := result["title_cn"]; !ok {
		result["title_cn"] = result["title"]
	}
	if _, ok := result["description_cn"]; !ok {
		result["description_cn"] = result["description"]
	}

	return result
}

// handleAITest POST /api/ai-test — 测试 AI 连通性（max_tokens=1 最小化请求）
func (s *Server) handleAITest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConfigID int64  `json:"configId"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
		APIKey   string `json:"apiKey"`
		BaseURL  string `json:"baseUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求"})
		return
	}

	if req.Provider == "" || req.Model == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请先填写提供商和模型"})
		return
	}

	apiKey := req.APIKey
	if apiKey == "" {
		// 输入框未填：优先按 configId 取（编辑已保存），再按 provider 取（新建复用同 provider 已存 key）
		if req.ConfigID > 0 {
			cfg := s.getProviderConfig(req.ConfigID)
			if cfg != nil && cfg.APIKeyEncrypted != "" {
				if decrypted, err := Decrypt(cfg.APIKeyEncrypted); err == nil {
					apiKey = decrypted
				}
			}
		}
		if apiKey == "" && req.Provider != "" {
			var encKey string
			s.db.QueryRow("SELECT api_key_encrypted FROM ai_provider_configs WHERE provider = ? AND api_key_encrypted != '' LIMIT 1", req.Provider).Scan(&encKey)
			if encKey != "" {
				if decrypted, err := Decrypt(encKey); err == nil {
					apiKey = decrypted
				}
			}
		}
	}
	if apiKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请先填写 API 密钥"})
		return
	}

	baseURL := req.BaseURL

	start := time.Now()
	var err error
	httpStatus := 0 // 非 200 时记 provider 返回的状态码（透传前端区分 401 key错 / 402 欠费），网络错误保持 0

	if strings.Contains(baseURL, "/anthropic") || req.Provider == "anthropic" {
		// Anthropic: {baseURL}/v1/messages
		apiURL := strings.TrimRight(baseURL, "/") + "/v1/messages"
		reqBody := map[string]any{
			"model": req.Model,
			"messages": []map[string]string{
				{"role": "user", "content": "Hi"},
			},
			"max_tokens": 1,
			"thinking":   map[string]string{"type": "disabled"},
		}
		bodyBytes, _ := json.Marshal(reqBody)
		httpReq, _ := http.NewRequest("POST", apiURL, strings.NewReader(string(bodyBytes)))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("x-api-key", apiKey)
		httpReq.Header.Set("anthropic-version", "2023-06-01")

		resp, doErr := aiTestClient.Do(httpReq)
		if doErr != nil {
			err = fmt.Errorf("请求失败: %v", doErr)
		} else {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 200 {
				httpStatus = resp.StatusCode
				err = fmt.Errorf("API 返回 %d: %s", resp.StatusCode, string(body))
			}
		}
	} else {
		// OpenAI 兼容 (deepseek / zhipu / siliconflow / custom)
		apiURL := strings.TrimRight(baseURL, "/") + "/chat/completions"
		reqBody := map[string]any{
			"model": req.Model,
			"messages": []map[string]string{
				{"role": "user", "content": "Hi"},
			},
			"max_tokens": 1,
		}
		bodyBytes, _ := json.Marshal(reqBody)
		httpReq, _ := http.NewRequest("POST", apiURL, strings.NewReader(string(bodyBytes)))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)

		resp, doErr := aiTestClient.Do(httpReq)
		if doErr != nil {
			err = fmt.Errorf("请求失败: %v", doErr)
		} else {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 200 {
				httpStatus = resp.StatusCode
				err = fmt.Errorf("API 返回 %d: %s", resp.StatusCode, string(body))
			}
		}
	}

	latency := time.Since(start).Milliseconds()

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         false,
			"error":      err.Error(),
			"latency":    latency,
			"statusCode": httpStatus,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"latency": latency,
	})
}
