package main

import (
	"net/http"
	"strconv"
	"testing"
)

func TestFaviconVersionSurvivesNonIconUpdates(t *testing.T) {
	api := newTestAPI(t)
	token := login(t, api)

	res := api.request(t, http.MethodPost, "/api/bookmarks", token, BookmarkInput{
		URL:     "https://example.com/docs",
		Title:   "Docs",
		Favicon: "data:image/png;base64,AAAA",
	})
	requireStatus(t, res, http.StatusCreated)
	created := decodeJSON[struct {
		Bookmark Bookmark `json:"bookmark"`
	}](t, res).Bookmark
	if created.FaviconVersion == "" {
		t.Fatal("created favicon version is empty")
	}

	update := api.request(t, http.MethodPut,
		"/api/bookmarks/"+strconv.FormatInt(created.ID, 10), token, map[string]string{"title": "Docs 2"})
	requireStatus(t, update, http.StatusOK)
	first := listBookmarks(t, api, token, "/api/bookmarks")[0]
	if first.FaviconVersion != created.FaviconVersion {
		t.Fatalf("non-icon edit changed favicon version: %q -> %q", created.FaviconVersion, first.FaviconVersion)
	}

	clear := api.request(t, http.MethodPut,
		"/api/bookmarks/"+strconv.FormatInt(created.ID, 10), token, map[string]string{"favicon": ""})
	requireStatus(t, clear, http.StatusOK)
	cleared := listBookmarks(t, api, token, "/api/bookmarks")[0]
	if cleared.HasFavicon || cleared.FaviconVersion != "" {
		t.Fatalf("cleared icon = has=%v version=%q", cleared.HasFavicon, cleared.FaviconVersion)
	}
}
