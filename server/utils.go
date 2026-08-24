package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/text/encoding/simplifiedchinese"
)

var httpClient = &http.Client{
	Timeout:       10 * time.Second,
	CheckRedirect: ssrfCheckRedirect,
}

// 直连专用客户端（VPS 在海外，国际站秒回，5s 足够覆盖慢站）
var directClient = &http.Client{
	Timeout:       5 * time.Second,
	CheckRedirect: ssrfCheckRedirect,
}

// isPrivateIP 检查是否为内网地址（SSRF 防护）
func isPrivateIP(host string) bool {
	// 去掉端口
	h := host
	if idx := strings.LastIndex(h, ":"); idx != -1 {
		h = h[:idx]
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return false
	}
	// 169.254.0.0/16 = 链路本地（含 AWS/GCP/Azure 云元数据 169.254.169.254，SSRF 核心目标）
	// 0.0.0.0/8 = 当前网络（部分系统可路由到本机）
	privateRanges := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "0.0.0.0/8", "169.254.0.0/16",
		"::1/128", "fc00::/7",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// isValidURL 校验 URL 是否安全（SSRF 防护）
func isValidURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return !isPrivateIP(u.Host)
}

// ssrfCheckRedirect 拦截重定向到内网/非 http(s) 目的，防攻击者用 evil.com -> 302 -> 169.254.169.254
// 绕过请求前的 isValidURL 校验。httpClient / directClient 共用。
func ssrfCheckRedirect(req *http.Request, via []*http.Request) error {
	if !isValidURL(req.URL.String()) {
		return fmt.Errorf("blocked redirect to: %s", req.URL.String())
	}
	if len(via) >= 10 {
		return fmt.Errorf("stopped after 10 redirects")
	}
	return nil
}

// mergeURLSlashesRegex 匹配连续 /（用于合并路径内多余 /，Nginx 默认 merge_slashes on 行为）。
// 不匹配协议分隔符 //：normalizeURL 只对 u.Path 操作，u.String() 重建协议部分。
var mergeURLSlashesRegex = regexp.MustCompile(`/+`)

// normalizeURL 与前端 lib/bookmark-utils.tsx 的 normalizeUrl 行为对齐：
//   - 补 https:// 前缀
//   - scheme/host 转小写
//   - 末尾 / 自动加（WHATWG / RFC 2616 §3.2.2 + RFC 3986 §6.2.3 强制）
//   - 路径中连续 / 合并为单个（Nginx 默认 merge_slashes on，业内主流）
//
// 仅服务端兜底：URL 入库前统一规范化，确保数据库存的永远一致（防止前端绕过）。
func normalizeURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return rawURL
	}
	lower := strings.ToLower(rawURL)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		rawURL = "https://" + rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return strings.ToLower(rawURL)
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Path = mergeURLSlashesRegex.ReplaceAllString(u.Path, "/")
	return u.String()
}

// handleFetchTitle GET /api/fetch-title?url=...
func (s *Server) handleFetchTitle(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少 url 参数"})
		return
	}

	// 第一阶段：直连目标站点（VPS 无 CORS 限制，直连最快最准）
	title, description := fetchPageMetaDirect(targetURL)

	// 第二阶段：CORS 代理降级
	if title == "" {
		title, description = fetchPageMetaByProxy(targetURL)
	}

	writeJSON(w, http.StatusOK, map[string]string{"title": title, "description": description})
}

// detectCharset 从 HTTP Content-Type header 和 HTML <meta> 标签检测字符编码（返回小写，如 "gbk"）
func detectCharset(contentType string, body []byte) string {
	// 1. HTTP header: Content-Type: text/html; charset=XXX
	if ct := strings.ToLower(contentType); ct != "" {
		if idx := strings.Index(ct, "charset="); idx != -1 {
			cs := strings.Trim(strings.TrimSpace(ct[idx+8:]), "\"';")
			if i := strings.IndexByte(cs, ';'); i != -1 {
				cs = cs[:i]
			}
			if cs != "" {
				return cs
			}
		}
	}
	// 2. HTML <meta charset> 或 <meta http-equiv>（前 2KB 找，meta 通常在 head 前部）
	head := body
	if len(head) > 2048 {
		head = head[:2048]
	}
	lower := strings.ToLower(string(head))
	if idx := strings.Index(lower, "charset="); idx != -1 {
		s := strings.TrimLeft(lower[idx+8:], " \"'")
		end := 0
		for end < len(s) && s[end] != '"' && s[end] != '\'' && s[end] != ' ' && s[end] != ';' && s[end] != '>' && s[end] != '\n' {
			end++
		}
		if end > 0 {
			return s[:end]
		}
	}
	return ""
}

// decodeHTMLBody 按检测到的编码把 body 解码为 UTF-8 字节；非 GBK 系原样返回。
// 解决 lol.qq.com 等 GBK 站点抓取后中文乱码（title 抓成 HTML 片段、description 乱码）。
func decodeHTMLBody(body []byte, contentType string) []byte {
	switch strings.ToLower(detectCharset(contentType, body)) {
	case "gbk", "gb2312", "gb_2312-80", "csgb2312":
		if decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(body); err == nil {
			return decoded
		}
	case "gb18030":
		if decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(body); err == nil {
			return decoded
		}
	}
	return body
}

// fetchHTMLDirect 直连获取页面 HTML
func fetchHTMLDirect(targetURL string) string {
	if !isValidURL(targetURL) {
		return ""
	}

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := directClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		return ""
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 100*1024))
	if err != nil {
		return ""
	}
	return string(decodeHTMLBody(body, resp.Header.Get("Content-Type")))
}

// fetchPageMetaDirect 直连目标站点获取标题和描述
func fetchPageMetaDirect(targetURL string) (string, string) {
	html := fetchHTMLDirect(targetURL)
	if html == "" {
		return "", ""
	}
	return extractTitle(html), extractDescription(html)
}

// fetchHTMLByProxy 通过 CORS 代理获取页面 HTML
func fetchHTMLByProxy(targetURL string) string {
	encoded := url.QueryEscape(targetURL)
	proxies := []string{
		"https://api.allorigins.win/raw?url=" + encoded,
		"https://corsproxy.io/?" + encoded,
	}

	for _, proxy := range proxies {
		resp, err := httpClient.Get(proxy)
		if err != nil {
			continue
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			continue
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 100*1024))
		resp.Body.Close()
		if err != nil {
			continue
		}
		return string(decodeHTMLBody(body, resp.Header.Get("Content-Type")))
	}
	return ""
}

// fetchPageMetaByProxy 通过 CORS 代理获取标题和描述
func fetchPageMetaByProxy(targetURL string) (string, string) {
	html := fetchHTMLByProxy(targetURL)
	if html == "" {
		return "", ""
	}
	title := extractTitle(html)
	if title != "" {
		return title, extractDescription(html)
	}
	return "", ""
}

// PageMeta 是从 <head> 中提取的元数据
type PageMeta struct {
	Title       string
	Description string
}

// extractPageMeta 用 tokenizer 从 HTML 中提取元数据。
// 优先解析 <head>（og/meta/<title>）；若 description 仍为空，继续解析 <body>，
// 取首个 <h1> 兜底 title、首个有意义 <p> 兜底 description（应对 meta 缺失的文档站/内页）。
// 注意：调用方负责关闭底层 reader（本函数不再 defer Close）。
func extractPageMeta(r io.Reader) PageMeta {
	var result PageMeta
	var ogDescription, twitterDescription, plainDescription string
	var titleText, h1Text, firstP strings.Builder
	var inTitle, inH1, inP, headDone bool
	finalizeHead := func() bool {
		result.Description = firstNonEmpty(ogDescription, twitterDescription, plainDescription)
		if title := strings.TrimSpace(titleText.String()); title != "" && result.Title == "" {
			result.Title = cleanTitle(title)
		}
		return result.Title != "" && result.Description != ""
	}

	tokenizer := html.NewTokenizer(r)
	for {
		tt := tokenizer.Next()
		if tt == html.ErrorToken {
			break
		}

		switch tt {
		case html.StartTagToken:
			t := tokenizer.Token()
			switch t.Data {
			case "body":
				if !headDone {
					if finalizeHead() {
						return result
					}
					headDone = true
				}
			case "title":
				inTitle = true
			case "h1":
				// 仅在 body 阶段收集首个 <h1>（head 内一般无 h1）
				if headDone && h1Text.Len() == 0 {
					inH1 = true
				}
			case "p":
				// 仅在 body 阶段收集首个 <p> 作为 description 兜底
				if headDone && firstP.Len() == 0 {
					inP = true
				}
			case "meta":
				name := getMetaAttr(t, "name")
				property := getMetaAttr(t, "property")
				content := getMetaAttr(t, "content")

				if content == "" {
					continue
				}

				// 收集完 <head> 后再按优先级选择，避免 DOM 顺序改变结果。
				switch {
				case property == "og:description" && ogDescription == "":
					ogDescription = content
				case (property == "twitter:description" || name == "twitter:description") && twitterDescription == "":
					twitterDescription = content
				case name == "description" && plainDescription == "":
					plainDescription = content
				// Title 优先级：og:title > twitter:title
				case property == "og:title" && result.Title == "":
					result.Title = content
				case name == "twitter:title" && result.Title == "":
					result.Title = content
				}
			}

		case html.TextToken:
			txt := string(tokenizer.Text())
			if inTitle {
				titleText.WriteString(txt)
			}
			if inH1 {
				h1Text.WriteString(txt)
			}
			if inP {
				firstP.WriteString(txt)
			}

		case html.EndTagToken:
			t := tokenizer.Token()
			switch t.Data {
			case "title":
				inTitle = false
			case "h1":
				inH1 = false
			case "p":
				inP = false
			case "head":
				if finalizeHead() {
					return result
				}
				headDone = true
			}
		}
	}

	finalizeHead()
	// body 兜底：首个 <h1>
	if h1 := strings.TrimSpace(h1Text.String()); h1 != "" && result.Title == "" {
		result.Title = h1
	}
	// body 兜底：首个 <p>（过滤过短的噪声，如 cookie/导航提示，阈值 10 字符）
	if p := strings.TrimSpace(firstP.String()); utf8.RuneCountInString(p) >= 10 && result.Description == "" {
		result.Description = summarizeDesc(p)
	}

	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func getMetaAttr(t html.Token, key string) string {
	for _, attr := range t.Attr {
		if attr.Key == key {
			return strings.TrimSpace(attr.Val)
		}
	}
	return ""
}

// cleanTitle 清洗 <title> 中常见的站点后缀
func cleanTitle(title string) string {
	// GitHub 特殊格式： "GitHub - owner/repo: 实际标题 · GitHub"
	if strings.HasPrefix(title, "GitHub - ") {
		if idx := strings.Index(title, ": "); idx != -1 {
			title = strings.TrimSpace(title[idx+2:])
		}
	}
	// 去掉尾部的 " · GitHub" 等站名后缀
	title = strings.TrimSuffix(title, " · GitHub")

	return title
}

// fetchPageMetaStreaming 直连抓取 + tokenizer 提取（含 head meta 与 body 正文兜底）。
// 仅直连，不走代理降级——AI 提取链路（handleAIMeta）直连失败时由 Serper 搜索兜底（searchSerper）。
// 公共 CORS 代理降级（fetchHTMLByProxy）保留给 handleFetchTitle（普通抓标题）使用。
func fetchPageMetaStreaming(ctx context.Context, targetURL string) PageMeta {
	if !isValidURL(targetURL) {
		return PageMeta{}
	}
	meta, _ := fetchPageMetaDirectStreaming(ctx, targetURL)
	return meta
}

// fetchPageMetaDirectStreaming 直连目标站点，流式提取元数据。
// 返回 (meta, ok)：ok=true 表示抓到了标题或描述。
func fetchPageMetaDirectStreaming(ctx context.Context, targetURL string) (PageMeta, bool) {
	req, err := http.NewRequestWithContext(ctx, "GET", targetURL, nil)
	if err != nil {
		return PageMeta{}, false
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Encoding", "identity") // 禁止压缩，方便直接解析

	resp, err := directClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		return PageMeta{}, false
	}
	defer resp.Body.Close()

	// 限流 512KB，防止超大页面（含正文兜底解析）拖慢/爆内存
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return PageMeta{}, false
	}
	// GBK 等非 UTF-8 编码先转码再解析（否则中文乱码致 title/description 解析错乱）
	meta := extractPageMeta(bytes.NewReader(decodeHTMLBody(body, resp.Header.Get("Content-Type"))))
	return meta, meta.Title != "" || meta.Description != ""
}

// searchSerper 调用 Serper Google 搜索 API，用 URL 作查询，返回首个命中结果的
// title + snippet。用于直连抓取失败（反爬 403 等）时的搜索兜底——借 Google 间接
// 拿到目标站点的标题与一句话描述（snippet 已是高质量摘要，无需再抓正文）。
func searchSerper(ctx context.Context, targetURL, apiKey string) PageMeta {
	if apiKey == "" {
		return PageMeta{}
	}

	bodyBytes, err := json.Marshal(map[string]any{
		"q":   targetURL, // 直接用 URL 作 query，Google 会精确命中该页
		"gl":  "us",
		"hl":  "en",
		"num": 3, // 多取几条便于 host 匹配择优（速度差异 <150ms，质量更可靠）
	})
	if err != nil {
		return PageMeta{}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://google.serper.dev/search", bytes.NewReader(bodyBytes))
	if err != nil {
		return PageMeta{}
	}
	req.Header.Set("X-API-KEY", apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := aiClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		return PageMeta{}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return PageMeta{}
	}

	var sr struct {
		Organic []struct {
			Title   string `json:"title"`
			Snippet string `json:"snippet"`
			Link    string `json:"link"`
		} `json:"organic"`
	}
	if err := json.Unmarshal(respBody, &sr); err != nil {
		return PageMeta{}
	}

	// 优先取 host 匹配的结果（避免 Google 返回同类但不同站的结果），否则取第一个
	targetHost := hostOf(targetURL)
	for _, r := range sr.Organic {
		if targetHost != "" && hostOf(r.Link) == targetHost {
			return PageMeta{Title: r.Title, Description: r.Snippet}
		}
	}
	if len(sr.Organic) > 0 {
		return PageMeta{Title: sr.Organic[0].Title, Description: sr.Organic[0].Snippet}
	}
	return PageMeta{}
}

// hostOf 提取 URL 的 host（小写，不含端口）
func hostOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// extractDescription 从 HTML 中提取 meta description，自动生成简洁摘要
func extractDescription(html string) string {
	lower := strings.ToLower(html)

	patterns := []string{
		`<meta name="description" content="`,
		`<meta name='description' content='`,
		`<meta property="og:description" content="`,
		`<meta property='og:description' content='`,
	}

	for _, p := range patterns {
		start := strings.Index(lower, p)
		if start == -1 {
			continue
		}
		contentStart := start + len(p)
		quote := p[len(p)-1:]
		end := strings.Index(html[contentStart:], quote)
		if end == -1 || end == 0 {
			continue
		}
		desc := strings.TrimSpace(html[contentStart : contentStart+end])
		desc = strings.ReplaceAll(desc, "&amp;", "&")
		desc = strings.ReplaceAll(desc, "&lt;", "<")
		desc = strings.ReplaceAll(desc, "&gt;", ">")
		desc = strings.ReplaceAll(desc, "&#39;", "'")
		desc = strings.ReplaceAll(desc, "&quot;", `"`)
		return summarizeDesc(desc)
	}
	return ""
}

// summarizeDesc 将描述截取为简洁摘要
func summarizeDesc(desc string) string {
	// 去掉 "网站名 - " 前缀（标题已包含）
	if idx := strings.Index(desc, " - "); idx != -1 && utf8.RuneCountInString(desc[:idx]) < 20 {
		desc = strings.TrimSpace(desc[idx+3:])
	}

	// 在 60 字符内找自然断句点
	const maxRunes = 60
	runes := []rune(desc)
	if len(runes) <= maxRunes {
		return desc
	}
	// 从 maxRunes 位置向前找最近的断句标点
	cutPoints := "，。；、,;"
	for i := maxRunes - 1; i >= maxRunes/2; i-- {
		if strings.ContainsRune(cutPoints, runes[i]) {
			return string(runes[:i])
		}
	}
	// 没找到断句点，硬截断
	return string(runes[:maxRunes])
}

// handleStats GET /api/stats
func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	var bookmarkCount int
	var categoryCount int

	if err := s.db.QueryRow("SELECT COUNT(*) FROM bookmarks").Scan(&bookmarkCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM categories").Scan(&categoryCount); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "查询失败"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"total_bookmarks":  bookmarkCount,
		"total_categories": categoryCount,
		"openapi":          "/openapi.json", // 暴露说明书路径给 AI（探测端点）
	})
}

func extractTitle(html string) string {
	lower := strings.ToLower(html)

	// <title>...</title>
	start := strings.Index(lower, "<title>")
	if start == -1 {
		return ""
	}
	end := strings.Index(lower, "</title>")
	if end == -1 || end <= start {
		return ""
	}

	title := html[start+7 : end]
	return strings.TrimSpace(title)
}

// extractLinkHref 从 HTML 中按优先级查找 favicon link 标签的 href
func extractLinkHref(html string) string {
	type prio struct {
		rel string
		typ string
	}
	priorities := []prio{
		{rel: "icon", typ: "image/svg+xml"},
		{rel: "icon", typ: ""},
		{rel: "shortcut icon", typ: ""},
		{rel: "apple-touch-icon", typ: ""},
	}

	// 找到所有 <link 标签起始位置
	linkStarts := regexp.MustCompile(`(?i)<\s*link\b`).FindAllStringIndex(html, -1)

	for _, p := range priorities {
		relRe := regexp.MustCompile(`(?i)\brel\s*=\s*["']\s*` + regexp.QuoteMeta(p.rel) + `\s*["']`)

		for _, loc := range linkStarts {
			// 只取当前 <link 标签的范围（到 > 为止），避免跨标签误匹配
			tagEnd := strings.Index(html[loc[0]:], ">")
			if tagEnd == -1 {
				continue
			}
			tag := html[loc[0] : loc[0]+tagEnd+1]

			if !relRe.MatchString(tag) {
				continue
			}

			if p.typ != "" {
				typeMatch := regexp.MustCompile(`(?i)\btype\s*=\s*["']([^"']+)["']`).FindStringSubmatch(tag)
				if len(typeMatch) < 2 || !strings.Contains(strings.ToLower(typeMatch[1]), p.typ) {
					continue
				}
			}

			// 双引号和单引号分开匹配
			hrefMatch := regexp.MustCompile(`(?i)\bhref\s*=\s*"([^"]*)"`).FindStringSubmatch(tag)
			if len(hrefMatch) < 2 {
				hrefMatch = regexp.MustCompile(`(?i)\bhref\s*=\s*'([^']*)'`).FindStringSubmatch(tag)
			}
			if len(hrefMatch) >= 2 {
				return hrefMatch[1]
			}
		}
	}
	return ""
}

// resolveURL 将相对路径转为绝对 URL
func resolveURL(href, baseURL string) string {
	if strings.HasPrefix(href, "data:") || strings.HasPrefix(href, "http") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return "https:" + href
	}
	if strings.HasPrefix(href, "/") {
		u, _ := url.Parse(baseURL)
		return u.Scheme + "://" + u.Host + href
	}
	return baseURL + "/" + href
}

// fetchFaviconFromPage 第一阶段：直连抓取目标页面 HTML，解析 <link> 标签
func fetchFaviconFromPage(targetURL string) string {
	if !isValidURL(targetURL) {
		return ""
	}

	resp, err := httpClient.Get(targetURL)
	if err != nil || resp.StatusCode != 200 {
		return ""
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024))
	html := string(body)

	href := extractLinkHref(html)
	if href == "" {
		return ""
	}
	return resolveURL(href, targetURL)
}

// tryCommonPaths 第二阶段：尝试常见 favicon 路径
func tryCommonPaths(baseURL string) string {
	if !isValidURL(baseURL) {
		return ""
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}
	origin := u.Scheme + "://" + u.Host

	paths := []string{
		"/favicon.ico",
		"/favicon.svg",
		"/apple-touch-icon.png",
		"/assets/favicon.ico",
		"/static/favicon.ico",
	}

	for _, path := range paths {
		faviconURL := origin + path
		resp, err := httpClient.Get(faviconURL)
		if err != nil {
			continue
		}
		if resp.StatusCode == 200 && strings.HasPrefix(resp.Header.Get("Content-Type"), "image") {
			resp.Body.Close()
			return faviconURL
		}
		resp.Body.Close()
	}
	return ""
}

// sniffImageMIME 用魔术字节嗅探图片真实格式，返回准确 MIME。
// 第三方 favicon 服务常返回不准的 Content-Type（如把 PNG 标成 image/x-icon），
// 浏览器看魔术字节能渲染但 data URI 标签会错；此函数以字节为准覆盖 HTTP 头。
// 嗅探不出返回空字符串，由调用方 fallback 到 HTTP Content-Type。
func sniffImageMIME(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	// SVG：文本格式，前 512 字节找 <svg（可能前面有 <?xml 声明或空白）
	peek := data
	if len(peek) > 512 {
		peek = peek[:512]
	}
	if strings.Contains(string(peek), "<svg") {
		return "image/svg+xml"
	}
	// PNG: 89 50 4E 47
	if len(data) >= 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return "image/png"
	}
	// JPEG: FF D8 FF
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg"
	}
	// GIF: 47 49 46 38 (GIF8)
	if len(data) >= 6 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 {
		return "image/gif"
	}
	// WEBP: RIFF....WEBP
	if len(data) >= 12 && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 &&
		data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50 {
		return "image/webp"
	}
	// ICO/CUR: 00 00 01 00 (ICO) / 00 00 02 00 (CUR)
	if len(data) >= 4 && data[0] == 0x00 && data[1] == 0x00 && (data[2] == 0x01 || data[2] == 0x02) && data[3] == 0x00 {
		return "image/x-icon"
	}
	return ""
}

// normalizeSVG 去除 SVG 内的配色方案自适应（prefers-color-scheme 媒体查询，
// dark 与 light 分支都删），固定为浅色模式颜色。
// 背景：品牌 SVG（theSVG/Simple Icons/站点自带）常写
//
//	@media (prefers-color-scheme: dark) { path { fill: #fff } }
//
// lumen 图标容器固定浅色背景，系统深色时这类图标渲染成白色 → 白底上隐身。
// 入库/输出前删除 dark 媒体查询块；若主填充色仍为白色（透明底白 logo），
// 则替换为深灰 #242422 保证白底可见。含深色填充的 SVG（如深底白字）不受影响。
func normalizeSVG(data []byte) []byte {
	s := string(data)
	if !strings.Contains(s, "prefers-color-scheme") && !hasWhiteFill(s) {
		return data
	}
	// 1) 删除所有 @media (prefers-color-scheme: dark) { ... } 块（花括号配对，支持嵌套）
	s = stripPrefersColorScheme(s)
	// 2) 全白图标兜底：复用框架 replaceWhitePaint 把白色换成深灰 #242422。
	// allPaintsWhite 保证仅全白才替换，深底白字（含非白 fill）天然不受影响。
	s = replaceWhitePaint(s, "242422")
	return []byte(s)
}

// stripPrefersColorScheme 删除 SVG 里所有 prefers-color-scheme 媒体查询块
//（dark 与 light 分支都删）。品牌图标常以任一写法声明深浅自适应，lumen 图标容器
// 固定浅色底，留着会让系统深色时图标变白隐身。保留 prefers-reduced-motion 等非配色查询。
func stripPrefersColorScheme(s string) string {
	var out strings.Builder
	i := 0
	for i < len(s) {
		idx := strings.Index(s[i:], "@media")
		if idx == -1 {
			out.WriteString(s[i:])
			break
		}
		idx += i
		out.WriteString(s[i:idx])
		// 找媒体查询条件里的 prefers-color-scheme（允许空格/大小写变化）
		head := s[idx:]
		brace := strings.Index(head, "{")
		if brace == -1 {
			out.WriteString(head)
			break
		}
		cond := strings.ToLower(head[:brace])
		if !strings.Contains(cond, "prefers-color-scheme") {
			// 非配色方案媒体查询（如 prefers-reduced-motion），原样保留整个块
			end := matchBrace(s, idx+brace)
			if end == -1 {
				out.WriteString(head)
				break
			}
			out.WriteString(s[idx : end+1])
			i = end + 1
			continue
		}
		// 配色方案媒体查询：跳过整个块
		end := matchBrace(s, idx+brace)
		if end == -1 {
			break
		}
		i = end + 1
	}
	return out.String()
}

// matchBrace 从 openIdx（指向 '{'）出发，返回配对的 '}' 下标；不配对返回 -1。
func matchBrace(s string, openIdx int) int {
	depth := 0
	for j := openIdx; j < len(s); j++ {
		switch s[j] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return j
			}
		}
	}
	return -1
}

// svgPaintRe 匹配 SVG 绘制色值：属性形式（fill="#fff"）与 CSS 形式（fill: #fff），
// 覆盖 3/4/6/8 位 hex 与命名色。normalizeSVG 流程专用；
// theSVG 流程继续用 paintRe（仅属性形式，语义已固化，勿动）。
var svgPaintRe = regexp.MustCompile(`(?i)(?:fill|stroke)\s*(?:=|:)\s*["']?(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)`)

// hasWhiteFill 判断 SVG 是否含白色绘制色（fill/stroke，属性或 CSS 形式）。
// 复用框架 isWhiteFill（theSVG 颜色判断），不枚举字符串。
func hasWhiteFill(s string) bool {
	for _, m := range svgPaintRe.FindAllStringSubmatch(s, -1) {
		if isWhiteFill(m[1]) {
			return true
		}
	}
	return false
}

// normalizeSVGDataURI 归一化 data URI 形式的 SVG（URL 编码 / base64 两种编码）；
// 非 SVG data URI（png/ico 等）或畸形 URI 原样返回，保持原编码形式。
// 摄入端统一入口：前端 fetchFaviconDataUri 提交的 data URI 入库前（resolveFavicon）、
// /api/favicon 输出前（serveFaviconURL）都过这里，DB 存的与端点吐的 SVG 均已归一化。
func normalizeSVGDataURI(uri string) string {
	commaIdx := strings.Index(uri, ",")
	if commaIdx == -1 {
		return uri
	}
	header := uri[:commaIdx]
	if !strings.Contains(header, "svg") {
		return uri
	}
	payload := uri[commaIdx+1:]
	if strings.Contains(header, "base64") {
		decoded, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return uri
		}
		return header + "," + base64.StdEncoding.EncodeToString(normalizeSVG(decoded))
	}
	decoded, err := url.QueryUnescape(payload)
	if err != nil {
		decoded = payload
	}
	return header + "," + url.QueryEscape(string(normalizeSVG([]byte(decoded))))
}

// ===== theSVG 品牌图标（首选源，registry 精准域名映射）=====

var (
	thesvgDomainMap map[string]string
	thesvgWordMap   map[string]string // 品牌词 -> slug（outlook -> microsoft-outlook），解决子域≠官网域名
	thesvgHexMap    map[string]string // slug -> hex
	thesvgMapMu     sync.RWMutex
)

// loadTheSvgRegistry 异步加载 theSVG 图标清单，建 域名->slug 精准映射。
// 启动时 go loadTheSvgRegistry()，不阻塞；失败 map 为空，fetchTheSvg 回退 slug 推导。
// registry.json 结构：{"total":N,"icons":[{"slug","url","aliases",...}]}，url 是品牌官网完整 URL，
// 据此建映射解决 "npmjs.com -> npm" 这类 slug 不匹配（fetchSimpleIcon 的"去 TLD 第一段"推导不准）。
func loadTheSvgRegistry() {
	resp, err := httpClient.Get("https://thesvg.org/api/registry.json")
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		log.Printf("theSVG registry 加载失败: %v", err)
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		log.Printf("theSVG registry 读取失败: %v", err)
		return
	}
	var reg struct {
		Total int `json:"total"`
		Icons []struct {
			Slug    string   `json:"slug"`
			URL     string   `json:"url"`
			Aliases []string `json:"aliases"`
			Hex     string   `json:"hex"`
		} `json:"icons"`
	}
	if err := json.Unmarshal(data, &reg); err != nil {
		log.Printf("theSVG registry 解析失败: %v", err)
		return
	}
	m := make(map[string]string, len(reg.Icons)*2)
	w := make(map[string]string, len(reg.Icons)*2)
	h := make(map[string]string, len(reg.Icons))
	// wordPriority: 该词是 slug 最后词（主品牌词，如 microsoft-outlook 的 outlook）优先级 2，
	// 是任一词优先级 1；冲突取优先级高的（outlook -> microsoft-outlook 而非 outlook-calendar）
	wordPriority := func(slug, word string) int {
		parts := strings.Split(slug, "-")
		if len(parts) > 0 && parts[len(parts)-1] == word {
			return 2
		}
		for _, p := range parts {
			if p == word {
				return 1
			}
		}
		return 0
	}
	for _, ic := range reg.Icons {
		for _, d := range domainsFromURL(ic.URL) {
			setShortestSlug(m, d, ic.Slug)
		}
		for _, a := range ic.Aliases {
			for _, d := range domainsFromURL(a) {
				setShortestSlug(m, d, ic.Slug)
			}
		}
		if ic.Hex != "" {
			h[ic.Slug] = ic.Hex
		}
		// 词索引：slug 按连字符拆词，每词 -> slug（冲突取优先级高的）
		for _, word := range strings.Split(ic.Slug, "-") {
			if word == "" {
				continue
			}
			lw := strings.ToLower(word)
			np := wordPriority(ic.Slug, lw)
			if es, ok := w[lw]; !ok {
				w[lw] = ic.Slug
			} else if np > wordPriority(es, lw) {
				w[lw] = ic.Slug
			}
		}
	}
	thesvgMapMu.Lock()
	thesvgDomainMap = m
	thesvgWordMap = w
	thesvgHexMap = h
	thesvgMapMu.Unlock()
	log.Printf("theSVG registry 已加载: %d 图标, %d 域名映射, %d 品牌词索引, %d hex", len(reg.Icons), len(m), len(w), len(h))
}

// domainsFromURL 从 URL 提取域名（带 www 和不带 www 两个变体）；非 http 返回 nil（aliases 可能是 slug 非 URL）
func domainsFromURL(raw string) []string {
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	if h := strings.TrimPrefix(host, "www."); h != host {
		return []string{host, h}
	}
	return []string{host, "www." + host}
}

// domainBasename 取域名主名（去 www/端口，取倒数第二段）：github.com -> github, npmjs.com -> npmjs
func domainBasename(domain string) string {
	host := strings.TrimPrefix(strings.ToLower(domain), "www.")
	if idx := strings.LastIndex(host, ":"); idx > 0 {
		host = host[:idx]
	}
	parts := strings.Split(host, ".")
	if len(parts) >= 2 {
		return parts[len(parts)-2]
	}
	return host
}

// matchPriority 域名主名与 slug 的匹配优先级：
// 3 = slug == 主名（github.com 主名 github == slug github）
// 2 = 子串关系（npmjs.com 主名 npmjs，slug npm 是其子串）
// 1 = 不匹配
func matchPriority(slug, base string) int {
	s := strings.ToLower(slug)
	b := strings.ToLower(base)
	if s == b {
		return 3
	}
	if strings.Contains(s, b) || strings.Contains(b, s) {
		return 2
	}
	return 1
}

// setShortestSlug 域名映射冲突时按优先级选 slug：
// 优先 slug == 域名主名（github.com -> github，而非寄宿项目 d/ace），
// 其次 slug 与主名子串相关（npmjs.com -> npm，而非 runkit），
// 都不匹配则保留先遇到的。解决 theSVG 里开源项目 url 寄宿在 github.com/npmjs.com 覆盖主品牌的问题。
func setShortestSlug(m map[string]string, domain, slug string) {
	existing, ok := m[domain]
	if !ok {
		m[domain] = slug
		return
	}
	base := domainBasename(domain)
	if matchPriority(slug, base) > matchPriority(existing, base) {
		m[domain] = slug
	}
}

// lookupTheSvgSlug 查域名映射表拿精准 slug
func lookupTheSvgSlug(host string) (string, bool) {
	thesvgMapMu.RLock()
	defer thesvgMapMu.RUnlock()
	if thesvgDomainMap == nil {
		return "", false
	}
	slug, ok := thesvgDomainMap[strings.ToLower(host)]
	return slug, ok
}

// lookupTheSvgWord 查品牌词索引拿 slug（outlook -> microsoft-outlook）
func lookupTheSvgWord(word string) (string, bool) {
	thesvgMapMu.RLock()
	defer thesvgMapMu.RUnlock()
	if thesvgWordMap == nil {
		return "", false
	}
	slug, ok := thesvgWordMap[strings.ToLower(word)]
	return slug, ok
}

// fetchTheSvgBySlug 按 slug 取 theSVG 图标 SVG（jsDelivr 镜像）
// lookupTheSvgHex 查 slug -> hex（品牌主色）
func lookupTheSvgHex(slug string) (string, bool) {
	thesvgMapMu.RLock()
	defer thesvgMapMu.RUnlock()
	if thesvgHexMap == nil {
		return "", false
	}
	hex, ok := thesvgHexMap[slug]
	return hex, ok
}

// isWhiteFill 判断 fill 值是否为不透明白色（3/4/6/8 位 hex 或 white 关键字）。
// 4 位 #RGBA、8 位 #RRGGBBAA 需 alpha 满（f/ff）才算不透明；纯白半透明（如 #fff0）不算，留作设计元素。
func isWhiteFill(v string) bool {
	switch strings.ToLower(v) {
	case "#fff", "#ffff", "#ffffff", "#ffffffff", "white":
		return true
	}
	return false
}

// replaceWhitePaint 把 SVG 里白色的 fill 和 stroke 替换成品牌主色 hex。
// theSVG default 变体对部分品牌是白色绘制色（fill 白如 Vercel/Anthropic，stroke 白如 shadcn/ui 两条描边线），
// 深色背景用，浅色卡片背景看不见；替换成品牌 hex 让浅背景也可见。
// 用正则替换覆盖 fill+stroke 所有白色格式，避免枚举遗漏（曾漏 #ffff 致 Anthropic 白图标、漏 stroke 致 shadcn 白图标入库）。
func replaceWhitePaint(svg, hex string) string {
	if hex == "" || !allPaintsWhite(svg) {
		return svg
	}
	// hex 本身是白色（Apple fff）时，白底容器看不见，用黑色兜底
	target := "#" + hex
	if isWhiteFill(target) {
		target = "#000"
	}
	return paintRe.ReplaceAllStringFunc(svg, func(match string) string {
		// match 形如 fill="#fff" 或 stroke="#ffffff"，按原属性名重建
		eq := strings.Index(match, `="`)
		val := match[eq+2 : len(match)-1]
		if isWhiteFill(val) {
			return match[:eq] + `="` + target + `"`
		}
		return match
	})
}

// paintRe 匹配 SVG 绘制色属性（fill + stroke）的值，统一处理白色替换。
// 只看 fill 会漏 stroke 白色 logo（如 shadcn/ui 两条白描边线）。
var paintRe = regexp.MustCompile(`(?:fill|stroke)="(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)"`)

// isNoneOrTransparent 判断绘制色值是否为无色（none/transparent），白色替换判断时忽略。
func isNoneOrTransparent(v string) bool {
	switch strings.ToLower(v) {
	case "none", "transparent":
		return true
	}
	return false
}

// allPaintsWhite 检查 SVG 所有绘制色（fill + stroke，忽略 none/transparent）是否都是白色（单色白 logo）。
// 多色 logo（含非白绘制色，如 YouTube 红背景）返回 false，白色是设计元素不该替换。
// none/transparent 视为无色忽略，避免 shadcn 这类 fill=none+stroke=#fff 的描边 logo 被误判为"含非白颜色"。
//
// 裸元素兜底：无 fill 也无 stroke 属性的绘制元素（path/circle/rect 等）默认 fill=#000 黑色，
// paintRe 匹配不到会被漏掉。若存在这类裸元素且根 <svg> 未设白色 fill（裸元素不继承白色），
// 它们实际是黑色 -> 非全白 logo，返回 false。修复 Notion 这类"白底(path #FFF) + 无 fill 黑 N(path 裸)"
// 被误判全白、白底被 replaceWhitePaint 替换成品牌色致整体全黑的问题。
// anthropic 靠根 <svg fill="#ffff"> 让裸 path 继承白色，rootHasWhiteFill 为 true 不受影响。
func allPaintsWhite(svg string) bool {
	matches := paintRe.FindAllStringSubmatch(svg, -1)
	hasWhite := false
	for _, m := range matches {
		v := m[1]
		if isNoneOrTransparent(v) {
			continue
		}
		if !isWhiteFill(v) {
			return false
		}
		hasWhite = true
	}
	if hasBareDrawElement(svg) && !rootHasWhiteFill(svg) {
		return false
	}
	return hasWhite
}

// drawElementRe 匹配 SVG 绘制元素（path/circle/rect/ellipse/polygon/polyline/line）的开始标签。
var drawElementRe = regexp.MustCompile(`<(?:path|circle|rect|ellipse|polygon|polyline|line)\b[^>]*>`)

// hasBareDrawElement 检测是否存在无 fill 也无 stroke 属性的绘制元素（裸元素，默认黑色填充）。
func hasBareDrawElement(svg string) bool {
	for _, tag := range drawElementRe.FindAllString(svg, -1) {
		if !strings.Contains(tag, "fill=") && !strings.Contains(tag, "stroke=") {
			return true
		}
	}
	return false
}

// svgRootRe / fillAttrRe 用于提取根 <svg> 的 fill 属性（判断裸子元素是否继承白色）。
var (
	svgRootRe  = regexp.MustCompile(`<svg\b[^>]*>`)
	fillAttrRe = regexp.MustCompile(`\bfill="([^"]*)"`)
)

// rootHasWhiteFill 检测根 <svg> 是否设了白色 fill（裸子元素继承白色，不算默认黑色）。
func rootHasWhiteFill(svg string) bool {
	root := svgRootRe.FindString(svg)
	if root == "" {
		return false
	}
	m := fillAttrRe.FindStringSubmatch(root)
	return len(m) >= 2 && isWhiteFill(m[1])
}

func fetchTheSvgBySlug(slug string) (string, bool) {
	resp, err := httpClient.Get("https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/" + slug + "/default.svg")
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		return "", false
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil || len(data) == 0 || !strings.HasPrefix(string(data), "<svg") {
		return "", false
	}
	svg := string(data)
	if hex, ok := lookupTheSvgHex(slug); ok {
		svg = replaceWhitePaint(svg, hex)
	}
	return svg, true
}

// commonSubdomainPrefixes 通用子域前缀黑名单：这些词作为子域第一段时跳过品牌词索引 + slug 推导，
// 避免不同品牌子域误命中同一品牌图标（如 mail.qq.com / mail.163.com 都误匹配 mail -> proton-mail 紫色 Proton）。
// 仍查域名映射（精准）；miss 后走 stripSubdomain 主域或阶段 1/2/3 抓站点自身 favicon。
var commonSubdomainPrefixes = map[string]bool{
	"mail": true, "app": true, "login": true, "console": true, "admin": true,
	"dashboard": true, "dash": true, "account": true, "accounts": true, "auth": true, "sso": true,
	"api": true, "portal": true, "platform": true, "my": true, "home": true, "m": true, "mobile": true,
	"secure": true, "shop": true, "store": true, "blog": true, "forum": true,
	"support": true, "help": true, "docs": true, "wiki": true, "news": true,
	"dev": true, "staging": true, "test": true, "web": true, "online": true,
	"cloud": true, "vpn": true, "proxy": true, "cdn": true, "static": true,
	"assets": true, "img": true, "images": true, "media": true, "files": true,
	"download": true, "upload": true, "panel": true, "cp": true, "manage": true,
}

// fetchTheSvg 从 theSVG 取品牌 SVG（首选源）。匹配顺序：
// 1. 域名映射（npmjs.com -> npm）-- 精准，总查
// 2. 通用子域前缀（mail/app/login 等）直接放弃，走主域/阶段 1/2/3 -- 避免不同品牌子域误匹配
// 3. 品牌词索引（outlook.live.com 第一段 outlook -> microsoft-outlook）-- 解决品牌官网域名 ≠ 用户子域
// 4. 回退域名第一段直接作 slug
func fetchTheSvg(domain string) (string, bool) {
	if idx := strings.LastIndex(domain, ":"); idx > 0 {
		domain = domain[:idx] // 去端口
	}
	host := strings.TrimPrefix(domain, "www.")
	parts := strings.SplitN(host, ".", 2)
	if parts[0] == "" {
		return "", false
	}

	if slug, ok := lookupTheSvgSlug(host); ok {
		return fetchTheSvgBySlug(slug)
	}
	if commonSubdomainPrefixes[strings.ToLower(parts[0])] {
		return "", false
	}
	if slug, ok := lookupTheSvgWord(parts[0]); ok {
		return fetchTheSvgBySlug(slug)
	}
	return fetchTheSvgBySlug(parts[0])
}

// fetchSimpleIcon 从 Simple Icons CDN 获取品牌 SVG，域名去 TLD 作为 slug 尝试
func fetchSimpleIcon(domain string) (string, bool) {
	// 去掉端口
	if idx := strings.LastIndex(domain, ":"); idx > 0 {
		domain = domain[:idx]
	}
	// 去掉 www. 前缀和 TLD，取主域名作为 slug
	// 例如 speedtest.net → speedtest, www.github.com → github
	host := strings.TrimPrefix(domain, "www.")
	parts := strings.SplitN(host, ".", 2)
	slug := parts[0]
	if slug == "" {
		return "", false
	}
	// 通用子域前缀（mail/app/dash 等）直接放弃，走主域/阶段 1/2/3 -- 与 fetchTheSvg 一致，
	// 避免 dash.cloudflare.com 误命中 simpleicons.org/dash（Dash 加密货币蓝图标）
	if commonSubdomainPrefixes[strings.ToLower(slug)] {
		return "", false
	}

	slugVariants := []string{slug}
	// 带 www 前缀的主域名也试试
	if host != slug {
		slugVariants = append(slugVariants, strings.ReplaceAll(host, ".", ""))
	}

	for _, s := range slugVariants {
		resp, err := httpClient.Get("https://cdn.simpleicons.org/" + s)
		if err != nil {
			continue
		}
		if resp.StatusCode == 200 {
			data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
			resp.Body.Close()
			if err == nil && len(data) > 0 && strings.HasPrefix(string(data), "<svg") {
				return string(data), true
			}
		} else {
			resp.Body.Close()
		}
	}
	return "", false
}

// handleFavicon GET /api/favicon?url=...
//
// 抓取优先级（关键：阶段0 品牌库跨原始+主域先试，优先于阶段1 站点自身 favicon）：
// 1. 阶段0 品牌库 theSVG/Simple Icons（原始 domain）-- docs.docker.com 因 docs 黑名单 miss
// 2. 阶段0 品牌库（主域 mainDomain）-- docker.com 命中 theSVG docker SVG，优于阶段1 抓 PNG
// 3. 阶段1/2 站点自身 favicon（直连 <link> + 常见路径，原始 + 主域）
// 4. 阶段3 第三方服务兜底（原始 + 主域）
//
// 旧实现把阶段0 和阶段1/2 放一个 tryFetchExact 里，子域 docs.docker.com 在阶段1 抓到 PNG 提前返回，
// 错失主域 docker.com 的 theSVG docker SVG；拆分后阶段0 跨原始+主域优先，命中高质量 SVG。
func (s *Server) handleFavicon(w http.ResponseWriter, r *http.Request) {
	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少 url 参数"})
		return
	}

	domain := extractDomain(targetURL)
	mainDomain := stripSubdomain(domain)

	// 阶段0：品牌 SVG（theSVG 首选 + Simple Icons 备选）-- 先原始再主域，优先于站点自身 favicon
	if s.tryBrandIcon(w, domain) {
		return
	}
	if mainDomain != domain && s.tryBrandIcon(w, mainDomain) {
		return
	}
	// 阶段1/2：站点自身 favicon（直连 <link> + 常见路径）-- 先原始再主域
	if s.trySiteFavicon(w, targetURL) {
		return
	}
	if mainDomain != domain && s.trySiteFavicon(w, "https://"+mainDomain) {
		return
	}
	// 阶段3：第三方服务兜底（原始 + 主域名）
	// 主域优先：子域（如 agent.qq.com）在第三方服务常拿不到真实图标、返回通用占位图，
	// 提前返回会遮蔽主域 qq.com 的品牌图标；主域结果更准。
	if mainDomain != domain && s.tryFetchThirdParty(w, mainDomain) {
		return
	}
	if s.tryFetchThirdParty(w, domain) {
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "favicon 未找到"})
}

// tryBrandIcon 阶段0：品牌 SVG（theSVG 首选 + Simple Icons 备选）
func (s *Server) tryBrandIcon(w http.ResponseWriter, domain string) bool {
	if svg, ok := fetchTheSvg(domain); ok {
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Cache-Control", "public, max-age=604800")
		w.Write(normalizeSVG([]byte(svg)))
		return true
	}
	if svg, ok := fetchSimpleIcon(domain); ok {
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Cache-Control", "public, max-age=604800")
		w.Write(normalizeSVG([]byte(svg)))
		return true
	}
	return false
}

// trySiteFavicon 阶段1/2：直连目标页 <link> 解析 + 常见路径
func (s *Server) trySiteFavicon(w http.ResponseWriter, targetURL string) bool {
	if faviconURL := fetchFaviconFromPage(targetURL); faviconURL != "" {
		if s.serveFaviconURL(w, faviconURL) {
			return true
		}
	}
	if commonURL := tryCommonPaths(targetURL); commonURL != "" {
		if s.serveFaviconURL(w, commonURL) {
			return true
		}
	}
	return false
}

// tryFetchThirdParty 第三方 favicon 服务兜底（并发取首个成功）
//
// 升级点（vs 旧顺序逐个试）：
//   - 扩充到 6 家：Google S2、DuckDuckGo（业内覆盖率最高）+ favicone/favicon.im/icon.horse + Logo.dev。
//     Logo.dev 50M+ 公司 logo，fallback=404 让 missing 返回 404（不返回 monogram 占首位），由下方 200+image 判断跳过。
//     注意 Google S2 / DDG 限流未公开，仅作兜底且依赖 httpClient 超时 + 浏览器/CDN 缓存，
//     不大规模裸依赖（参考 tavily 调研：二者 ToS 未公开精确速率阈值）。
//   - 并发请求取首个成功，失败场景延迟从 5×10s=50s 降到单次超时（6s）。
//   - 拿到首个成功即返回，cancel 其余请求，异步 drain 关闭剩余成功 body 防 goroutine/连接泄漏。
func (s *Server) tryFetchThirdParty(w http.ResponseWriter, domain string) bool {
	safeDomain := url.PathEscape(domain)
	services := []string{
		"https://www.google.com/s2/favicons?domain=" + safeDomain + "&sz=64",
		"https://icons.duckduckgo.com/ip3/" + safeDomain + ".ico",
		"https://favicone.com/" + safeDomain + "?s=64",
		"https://favicon.im/" + safeDomain,
		"https://icon.horse/icon/" + safeDomain,
		"https://img.logo.dev/" + safeDomain + "?token=" + s.config.LogoDevToken + "&fallback=404&format=png&size=64",
	}
	// 6s 总超时：单家慢/挂不至于拖垮整个抓取（旧实现最坏 5×10s=50s）
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	type result struct {
		contentType string
		body        io.ReadCloser
	}
	results := make(chan result, len(services))

	for _, svc := range services {
		go func(u string) {
			req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
			if err != nil {
				results <- result{}
				return
			}
			resp, err := httpClient.Do(req)
			if err != nil {
				results <- result{}
				return
			}
			if resp.StatusCode == 200 && strings.HasPrefix(resp.Header.Get("Content-Type"), "image") {
				results <- result{contentType: resp.Header.Get("Content-Type"), body: resp.Body}
				return
			}
			resp.Body.Close()
			results <- result{}
		}(svc)
	}

	// 取首个成功即返回；其余未消费的 result 由后台 goroutine drain，关闭成功 body 防泄漏
	for i := 0; i < len(services); i++ {
		r := <-results
		if r.body != nil {
			cancel()
			go func(remaining int) {
				for j := 0; j < remaining; j++ {
					if rr := <-results; rr.body != nil {
						rr.body.Close()
					}
				}
			}(len(services) - i - 1)
			w.Header().Set("Content-Type", r.contentType)
			w.Header().Set("Cache-Control", "public, max-age=604800")
			if strings.Contains(r.contentType, "svg") {
				// SVG 归一化后再写出（第三方服务也可能返回深色自适应 SVG）
				data, err := io.ReadAll(io.LimitReader(r.body, 512<<10))
				r.body.Close()
				if err == nil {
					w.Write(normalizeSVG(data))
				}
				return true
			}
			io.Copy(w, r.body)
			r.body.Close()
			return true
		}
	}
	return false
}

// extractDomain 从 URL 或裸域名中提取域名部分
func extractDomain(raw string) string {
	if strings.HasPrefix(raw, "http") {
		parts := strings.SplitN(raw, "//", 2)
		if len(parts) == 2 {
			raw = parts[1]
		}
	}
	return strings.Split(raw, "/")[0]
}

// stripSubdomain 剥离子域名，返回主域名（如 my.feishu.cn → feishu.cn）
// 仅处理多级子域名，单级域名（如 feishu.cn）原样返回
func stripSubdomain(domain string) string {
	parts := strings.Split(domain, ".")
	// 至少需要 3 段才有子域名可剥（如 my.feishu.cn）
	if len(parts) <= 2 {
		return domain
	}
	// 处理 .co.uk 等双段后缀：如果倒数第二段 ≤ 3 字符，保留它
	secondLevel := parts[len(parts)-2]
	if len(secondLevel) <= 3 {
		if len(parts) <= 3 {
			return domain // 如 feishu.cn、baidu.co.uk，已经是主域名
		}
		return strings.Join(parts[len(parts)-3:], ".")
	}
	return strings.Join(parts[1:], ".")
}

// serveFaviconURL 代理指定的 favicon URL，成功返回 true
func (s *Server) serveFaviconURL(w http.ResponseWriter, faviconURL string) bool {
	// data URI 直接返回（SVG 先归一化，非 SVG 原样）
	if strings.HasPrefix(faviconURL, "data:") {
		faviconURL = normalizeSVGDataURI(faviconURL)
		// data:image/svg+xml,...
		parts := strings.SplitN(faviconURL, ",", 2)
		if len(parts) == 2 {
			mimeType := strings.TrimSuffix(parts[0][5:], ";base64") // 去掉 "data:" 和可能的 ";base64"
			w.Header().Set("Content-Type", mimeType)
			w.Header().Set("Cache-Control", "public, max-age=604800")
			body := parts[1]
			// non-base64 data URI（如 SVG URL 编码）先解码，避免前端 encodeURIComponent 双重编码（%3C -> %253C）
			if !strings.Contains(parts[0], "base64") {
				if decoded, err := url.QueryUnescape(body); err == nil {
					body = decoded
				}
			}
			w.Write([]byte(body))
			return true
		}
		return false
	}

	if !isValidURL(faviconURL) {
		return false
	}
	resp, err := httpClient.Get(faviconURL)
	if err != nil || resp.StatusCode != 200 {
		return false
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image") && !strings.HasPrefix(ct, "svg") {
		return false
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	if err != nil || len(data) == 0 {
		return false
	}
	if strings.Contains(ct, "svg") {
		data = normalizeSVG(data)
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=604800")
	w.Write(data)
	return true
}

// handleHealth GET /api/health
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"openapi": "/openapi.json", // 暴露说明书路径给 AI（探测端点）
	})
}
