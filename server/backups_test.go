package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestBackupEndpointsRequireJWT(t *testing.T) {
	api := newTestAPI(t)
	requests := []struct{ method, path string }{
		{http.MethodGet, "/api/backups/settings"},
		{http.MethodPut, "/api/backups/settings"},
		{http.MethodGet, "/api/backups"},
		{http.MethodPost, "/api/backups/run"},
		{http.MethodPatch, "/api/backups/missing"},
		{http.MethodDelete, "/api/backups/missing"},
		{http.MethodGet, "/api/backups/missing/preview"},
		{http.MethodPost, "/api/backups/missing/restore"},
	}
	for _, request := range requests {
		res := api.request(t, request.method, request.path, "", nil)
		if res.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without JWT = %d, want 401", request.method, request.path, res.Code)
		}
	}
}

func TestBackupSettingsValidation(t *testing.T) {
	api := newTestAPI(t)
	token := login(t, api)

	invalid := map[string]int{"interval_hours": 13, "max_count": 3}
	if res := api.request(t, http.MethodPut, "/api/backups/settings", token, invalid); res.Code != http.StatusBadRequest {
		t.Fatalf("invalid interval status = %d, want 400", res.Code)
	}

	disabled := map[string]int{"interval_hours": 0, "max_count": 5}
	if res := api.request(t, http.MethodPut, "/api/backups/settings", token, disabled); res.Code != http.StatusOK {
		t.Fatalf("disabled settings status = %d, body=%s", res.Code, res.Body.String())
	}
}

func TestBackupRenameRestoreDeleteAndPrune(t *testing.T) {
	api := newTestAPI(t)
	token := login(t, api)
	categoryID := createCategory(t, api, token, "Restore Test")

	createRes := api.request(t, http.MethodPost, "/api/bookmarks", token, map[string]any{
		"url":         "https://example.com/original",
		"title":       "Original title",
		"description": "Before restore",
		"favicon":     "data:image/png;base64,AAAA",
		"tags":        []string{"restore"},
		"category_id": categoryID,
	})
	requireStatus(t, createRes, http.StatusCreated)
	bookmark := decodeJSON[struct {
		Bookmark Bookmark `json:"bookmark"`
	}](t, createRes).Bookmark

	runRes := api.request(t, http.MethodPost, "/api/backups/run", token, nil)
	requireStatus(t, runRes, http.StatusOK)
	backup := decodeJSON[BackupFile](t, runRes)

	preview := decodeJSON[struct {
		Bookmarks  int `json:"bookmarks"`
		Categories int `json:"categories"`
	}](t, api.request(t, http.MethodGet, "/api/backups/"+backup.ID+"/preview", token, nil))
	if preview.Bookmarks != 1 || preview.Categories != 1 {
		t.Fatalf("backup preview = %+v, want 1 bookmark + 1 category", preview)
	}

	renameRes := api.request(t, http.MethodPatch, "/api/backups/"+backup.ID, token,
		map[string]string{"display_name": "Before mistake"})
	requireStatus(t, renameRes, http.StatusOK)
	files := decodeJSON[struct {
		Backups []BackupFile `json:"backups"`
	}](t, api.request(t, http.MethodGet, "/api/backups", token, nil)).Backups
	if len(files) != 1 || files[0].DisplayName != "Before mistake" {
		t.Fatalf("renamed backup list = %+v", files)
	}

	updateRes := api.request(t, http.MethodPut, "/api/bookmarks/"+strconv.FormatInt(bookmark.ID, 10), token,
		map[string]string{"title": "Changed after backup"})
	requireStatus(t, updateRes, http.StatusOK)
	extra := api.request(t, http.MethodPost, "/api/bookmarks", token, map[string]any{
		"url":   "https://example.com/after-backup",
		"title": "Created after backup",
	})
	requireStatus(t, extra, http.StatusCreated)

	restoreRes := api.request(t, http.MethodPost, "/api/backups/"+backup.ID+"/restore", token, nil)
	requireStatus(t, restoreRes, http.StatusOK)
	current := listBookmarks(t, api, token, "/api/bookmarks")
	if len(current) != 1 || current[0].Title != "Original title" || current[0].CategoryID == nil ||
		*current[0].CategoryID != categoryID {
		t.Fatalf("restored bookmarks = %+v", current)
	}

	deleteRes := api.request(t, http.MethodDelete, "/api/backups/"+backup.ID, token, nil)
	requireStatus(t, deleteRes, http.StatusNoContent)
	filesAfterDelete := decodeJSON[struct {
		Backups []BackupFile `json:"backups"`
	}](t, api.request(t, http.MethodGet, "/api/backups", token, nil)).Backups
	if len(filesAfterDelete) != 0 {
		t.Fatalf("backups after delete = %+v", filesAfterDelete)
	}
}

func TestBackupPrunesOldestBeyondMaximum(t *testing.T) {
	api := newTestAPI(t)
	token := login(t, api)
	if res := api.request(t, http.MethodPut, "/api/backups/settings", token,
		map[string]int{"interval_hours": 24, "max_count": 3}); res.Code != http.StatusOK {
		t.Fatalf("configure backup status = %d", res.Code)
	}
	for i := 0; i < 4; i++ {
		if res := api.request(t, http.MethodPost, "/api/backups/run", token, nil); res.Code != http.StatusOK {
			t.Fatalf("backup #%d status = %d, body=%s", i+1, res.Code, res.Body.String())
		}
	}
	files := decodeJSON[struct {
		Backups []BackupFile `json:"backups"`
	}](t, api.request(t, http.MethodGet, "/api/backups", token, nil)).Backups
	if len(files) != 3 {
		t.Fatalf("backup count = %d, want 3", len(files))
	}
	if files[0].CreatedAt < files[1].CreatedAt {
		t.Fatalf("backup order is not newest first: %+v", files)
	}
}

func TestBackupCorruptionLeavesCurrentDataUnchanged(t *testing.T) {
	api := newTestAPI(t)
	token := login(t, api)
	createCategory(t, api, token, "Corrupt Test")
	created := api.request(t, http.MethodPost, "/api/bookmarks", token, map[string]any{
		"url":   "https://example.com/corrupt",
		"title": "Original",
	})
	requireStatus(t, created, http.StatusCreated)

	filename := "corrupt.db.gz"
	if err := os.MkdirAll(api.backupDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(api.backupDir, filename), []byte("not a gzip"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := api.db.Exec(`INSERT INTO backup_files (id,display_name,filename,size_bytes,source,created_at)
		VALUES ('corrupt','Corrupt',?,20,'manual','2026-01-01T00:00:00Z')`, filename); err != nil {
		t.Fatal(err)
	}
	res := api.request(t, http.MethodPost, "/api/backups/corrupt/restore", token, nil)
	if res.Code != http.StatusUnprocessableEntity {
		t.Fatalf("corrupt restore status = %d, want 422", res.Code)
	}
	current := listBookmarks(t, api, token, "/api/bookmarks")
	if len(current) != 1 || current[0].Title != "Original" {
		t.Fatalf("current bookmarks changed after failed restore: %+v", current)
	}
}
