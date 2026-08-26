package main

import "testing"

func TestValidateAIResultKeepsFillWhenCategorySuggestionInvalid(t *testing.T) {
	newResult := func() map[string]string {
		return map[string]string{
			"title_cn":       "Go - 开源编程语言",
			"description_cn": "提供Go语言官方源码仓库和贡献信息。",
			"tags":           "Go语言,编程工具,开源项目",
		}
	}
	for name, tc := range map[string]struct {
		result     map[string]string
		category   string
		evidence   string
		categories []string
		wantCat    string
	}{
		"no_categories": {newResult(), "AI工具", "证据", nil, ""},
		"unknown":       {newResult(), "新分类", "", []string{"开发工具"}, ""},
		"missing_quote": {newResult(), "开发工具", "", []string{"开发工具"}, "开发工具"},
	} {
		t.Run(name, func(t *testing.T) {
			tc.result["category"] = tc.category
			if tc.evidence != "" {
				tc.result["category_evidence"] = tc.evidence
			}
			if err := validateAIResult(tc.result, tc.categories, tc.evidence); err != nil {
				t.Fatal(err)
			}
			if got := tc.result["category"]; got != tc.wantCat {
				t.Fatalf("category = %q, want %q", got, tc.wantCat)
			}
		})
	}
}
