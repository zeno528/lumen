package main

import (
	"net/url"
	"strings"
	"testing"
)

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
