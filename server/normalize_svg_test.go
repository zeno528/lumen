package main

import (
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
)

// normalizeSVG 核心场景：品牌 SVG 自带的深色自适应应被删除，固定为浅色模式颜色。
func TestNormalizeSVG_StripsDarkMediaQuery(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>path{fill:#242422}@media (prefers-color-scheme: dark){path{fill:#ffffff}}</style><path d="M1 1h22v22H1z"/></svg>`
	out := string(normalizeSVG([]byte(in)))
	if strings.Contains(out, "prefers-color-scheme") {
		t.Fatalf("dark media query 未被删除: %s", out)
	}
	if strings.Contains(out, "#ffffff") {
		t.Fatalf("白色填充残留（应固定为浅色模式颜色）: %s", out)
	}
	if !strings.Contains(out, "#242422") {
		t.Fatalf("浅色模式颜色丢失: %s", out)
	}
}

// 无空格/压缩写法的媒体查询也应能处理。
func TestNormalizeSVG_CompactMediaQuery(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:#111}@media(prefers-color-scheme:dark){path{fill:#fff}}</style><path d="M0 0h10v10H0z"/></svg>`
	out := string(normalizeSVG([]byte(in)))
	if strings.Contains(out, "prefers-color-scheme") || strings.Contains(out, "#fff") {
		t.Fatalf("压缩写法未处理: %s", out)
	}
}

// 普通 SVG（无自适应）应原样返回。
func TestNormalizeSVG_PlainSVGUntouched(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M0 0h24v24H0z"/></svg>`
	out := normalizeSVG([]byte(in))
	if string(out) != in {
		t.Fatalf("普通 SVG 不应被修改: %s", out)
	}
}

// 本身就是白色图标（透明底白 logo）→ 应兜底替换为深色。
func TestNormalizeSVG_WhiteLogoFallback(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ffffff" d="M0 0h24v24H0z"/></svg>`
	out := string(normalizeSVG([]byte(in)))
	if strings.Contains(out, "#ffffff") {
		t.Fatalf("白色图标未兜底替换: %s", out)
	}
	if !strings.Contains(out, "#242422") {
		t.Fatalf("白色图标应替换为深灰 #242422: %s", out)
	}
}

// 深底白字图标（含深色背景填充）→ 不应误伤，保持原样。
func TestNormalizeSVG_DarkBackgroundWhiteForeground(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0F172A"/><path fill="#ffffff" d="M2 2h20v20H2z"/></svg>`
	out := string(normalizeSVG([]byte(in)))
	if !strings.Contains(out, "#ffffff") {
		t.Fatalf("深底白字图标不应被替换（有深色背景）: %s", out)
	}
}

// 非 SVG 数据（PNG 字节）不应被误处理——normalizeSVG 只处理 SVG 文本。
func TestNormalizeSVG_NonSVGUntouched(t *testing.T) {
	in := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	out := normalizeSVG(in)
	if len(out) != len(in) {
		t.Fatalf("非 SVG 数据不应被修改")
	}
}

// normalizeSVGDataURI：URL 编码的 SVG data URI（前端 fetchFaviconDataUri 产出形式）
// 归一化后仍是合法 data URI，深色自适应被去除。
func TestNormalizeSVGDataURI_URLEncoded(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:#111}@media(prefers-color-scheme:dark){path{fill:#fff}}</style><path d="M0 0h10v10H0z"/></svg>`
	in := "data:image/svg+xml," + url.QueryEscape(svg)
	out := normalizeSVGDataURI(in)
	if !strings.HasPrefix(out, "data:image/svg+xml,") {
		t.Fatalf("data URI 头被破坏: %s", out)
	}
	decoded, err := url.QueryUnescape(strings.TrimPrefix(out, "data:image/svg+xml,"))
	if err != nil || !strings.HasPrefix(decoded, "<svg") {
		t.Fatalf("归一化后 data URI 解码失败: %v %s", err, decoded)
	}
	if strings.Contains(decoded, "prefers-color-scheme") {
		t.Fatalf("dark media query 未被删除: %s", decoded)
	}
}

// normalizeSVGDataURI：base64 编码的 SVG data URI 同样归一化，保持 base64 形式。
func TestNormalizeSVGDataURI_Base64(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg"><style>@media (prefers-color-scheme: dark){path{fill:#fff}}</style><path fill="#242422" d="M0 0h10v10H0z"/></svg>`
	in := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
	out := normalizeSVGDataURI(in)
	if !strings.HasPrefix(out, "data:image/svg+xml;base64,") {
		t.Fatalf("base64 形式被破坏: %s", out)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(out, "data:image/svg+xml;base64,"))
	if err != nil {
		t.Fatalf("归一化后 base64 解码失败: %v", err)
	}
	if strings.Contains(string(decoded), "prefers-color-scheme") {
		t.Fatalf("dark media query 未被删除: %s", decoded)
	}
	if !strings.Contains(string(decoded), "#242422") {
		t.Fatalf("深色填充丢失（深底 logo 被误伤）: %s", decoded)
	}
}

// normalizeSVGDataURI：非 SVG data URI（PNG base64）原样返回。
func TestNormalizeSVGDataURI_NonSVGUntouched(t *testing.T) {
	in := "data:image/png;base64,iVBORw0KGgo="
	if out := normalizeSVGDataURI(in); out != in {
		t.Fatalf("非 SVG data URI 不应被修改: %s", out)
	}
}

