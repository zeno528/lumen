package main

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	backupMinFreeBytes    = int64(256 << 20) // 256MB 硬保护，避免备份写满生产盘
	backupMaxNameLength   = 120
	backupMaxGzipBytes    = int64(512 << 20) // 解压防护：单库快照超过 512MB 视为异常
	backupIntervalDefault = 24
	backupCountDefault    = 3
)

type BackupFile struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	SizeBytes   int64  `json:"size_bytes"`
	Source      string `json:"source"`
	CreatedAt   string `json:"created_at"`
}

type backupSettings struct {
	IntervalHours int
	MaxCount      int
	LastRunAt     string
	NextRunAt     string
	LastError     string
}

type backupSettingsAPIResponse struct {
	IntervalHours int    `json:"interval_hours"`
	MaxCount      int    `json:"max_count"`
	LastRunAt     string `json:"last_run_at,omitempty"`
	NextRunAt     string `json:"next_run_at,omitempty"`
	LastError     string `json:"last_error,omitempty"`
}

func validBackupInterval(hours int) bool {
	return hours == 0 || hours == 6 || hours == 12 || hours == 24 || hours == 168
}

func validBackupMaxCount(count int) bool {
	// 7 是设计文档中的默认保留份数，因此也必须作为可选档位暴露。
	return count == 3 || count == 5 || count == 7 || count == 10 || count == 20
}

func parseBackupInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func parseBackupTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.IsZero() {
		return time.Time{}
	}
	return parsed.UTC()
}

func formatBackupTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func (s *Server) setAppSetting(key, value string) error {
	_, err := s.db.Exec(
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
		key, value, value,
	)
	return err
}

func (s *Server) loadBackupSettings() (backupSettings, error) {
	settings := backupSettings{
		IntervalHours: backupIntervalDefault,
		MaxCount:      backupCountDefault,
	}
	rows, err := s.db.Query("SELECT key, value FROM settings WHERE key LIKE 'backup_%'")
	if err != nil {
		return settings, err
	}
	defer rows.Close()

	values := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return settings, err
		}
		values[key] = value
	}
	if err := rows.Err(); err != nil {
		return settings, err
	}

	settings.IntervalHours = parseBackupInt(values["backup_interval_hours"], backupIntervalDefault)
	settings.MaxCount = parseBackupInt(values["backup_max_count"], backupCountDefault)
	settings.LastRunAt = values["backup_last_run_at"]
	settings.NextRunAt = values["backup_next_run_at"]
	settings.LastError = values["backup_last_error"]
	if !validBackupInterval(settings.IntervalHours) || !validBackupMaxCount(settings.MaxCount) {
		return settings, fmt.Errorf("备份配置无效")
	}
	return settings, nil
}

// 空的 next_run_at 会按当前时间推导；调度器首次发现后立即落盘，避免每次重启都推迟周期。
func (s backupSettings) effectiveNextRun() string {
	if s.IntervalHours == 0 {
		return ""
	}
	if next := parseBackupTime(s.NextRunAt); !next.IsZero() {
		return formatBackupTime(next)
	}
	interval := time.Duration(s.IntervalHours) * time.Hour
	if last := parseBackupTime(s.LastRunAt); !last.IsZero() {
		return formatBackupTime(last.Add(interval))
	}
	return formatBackupTime(time.Now().UTC().Add(interval))
}

func (s backupSettings) apiResponse() backupSettingsAPIResponse {
	return backupSettingsAPIResponse{
		IntervalHours: s.IntervalHours,
		MaxCount:      s.MaxCount,
		LastRunAt:     s.LastRunAt,
		NextRunAt:     s.NextRunAt,
		LastError:     s.LastError,
	}
}

func (s *Server) handleGetBackupSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.loadBackupSettings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份配置失败"})
		return
	}
	response := settings.apiResponse()
	if settings.IntervalHours != 0 {
		response.NextRunAt = settings.effectiveNextRun()
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleUpdateBackupSettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		IntervalHours int `json:"interval_hours"`
		MaxCount      int `json:"max_count"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if !validBackupInterval(input.IntervalHours) || !validBackupMaxCount(input.MaxCount) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不支持的备份间隔或数量"})
		return
	}

	s.backupMu.Lock()
	defer s.backupMu.Unlock()

	current, err := s.loadBackupSettings()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份配置失败"})
		return
	}
	desired := backupSettings{
		IntervalHours: input.IntervalHours,
		MaxCount:      input.MaxCount,
		LastRunAt:     current.LastRunAt,
		LastError:     current.LastError,
	}
	if desired.IntervalHours != 0 {
		now := time.Now().UTC()
		if current.IntervalHours == desired.IntervalHours && current.NextRunAt != "" {
			desired.NextRunAt = current.NextRunAt
		} else {
			desired.NextRunAt = formatBackupTime(now.Add(time.Duration(desired.IntervalHours) * time.Hour))
		}
	} else {
		desired.NextRunAt = ""
	}

	pairs := map[string]string{
		"backup_interval_hours": strconv.Itoa(desired.IntervalHours),
		"backup_max_count":      strconv.Itoa(desired.MaxCount),
		"backup_next_run_at":    desired.NextRunAt,
	}
	for key, value := range pairs {
		if err := s.setAppSetting(key, value); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "保存备份配置失败"})
			return
		}
	}
	writeJSON(w, http.StatusOK, desired.apiResponse())
}

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()

	rows, err := s.db.Query(
		`SELECT id, display_name, filename, size_bytes, source, created_at
		 FROM backup_files ORDER BY id DESC`,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份列表失败"})
		return
	}
	defer rows.Close()

	files := []BackupFile{}
	for rows.Next() {
		var item BackupFile
		var filename string
		if err := rows.Scan(&item.ID, &item.DisplayName, &filename, &item.SizeBytes, &item.Source, &item.CreatedAt); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份列表失败"})
			return
		}
		if _, err := os.Stat(filepath.Join(s.config.BackupDir, filename)); err == nil {
			files = append(files, item)
		}
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份列表失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"backups": files})
}

func (s *Server) handleRunBackup(w http.ResponseWriter, r *http.Request) {
	file, err := s.CreateBackup(r.Context(), "manual")
	if err != nil {
		_ = s.setAppSetting("backup_last_error", err.Error())
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建备份失败: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, file)
}

func (s *Server) getBackupRecord(r *http.Request) (string, BackupFile, error) {
	id := chi.URLParam(r, "id")
	var record BackupFile
	var filename string
	err := s.db.QueryRow(
		`SELECT id, display_name, filename, size_bytes, source, created_at
		 FROM backup_files WHERE id = ?`, id,
	).Scan(&record.ID, &record.DisplayName, &filename, &record.SizeBytes, &record.Source, &record.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", record, fmt.Errorf("备份不存在")
	}
	if err != nil {
		return "", record, err
	}
	path := filepath.Join(s.config.BackupDir, filename)
	cleanDir, cleanPath := filepath.Clean(s.config.BackupDir), filepath.Clean(path)
	if !strings.HasPrefix(cleanPath, cleanDir+string(os.PathSeparator)) {
		return "", record, fmt.Errorf("非法备份路径")
	}
	return path, record, nil
}

func (s *Server) handleRenameBackup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DisplayName string `json:"display_name"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	name := strings.TrimSpace(input.DisplayName)
	if name == "" || len([]rune(name)) > backupMaxNameLength {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "名称需为 1-120 个字符"})
		return
	}

	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	result, err := s.db.Exec("UPDATE backup_files SET display_name = ? WHERE id = ?", name, chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新备份名称失败"})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "备份不存在"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "display_name": name})
}

func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()

	id := chi.URLParam(r, "id")
	var filename string
	err := s.db.QueryRow("SELECT filename FROM backup_files WHERE id = ?", id).Scan(&filename)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "备份不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份失败"})
		return
	}

	result, err := s.db.Exec("DELETE FROM backup_files WHERE id = ?", id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除备份失败"})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "备份不存在"})
		return
	}
	if err := os.Remove(filepath.Join(s.config.BackupDir, filename)); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "删除备份文件失败"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) CreateBackup(ctx context.Context, source string) (BackupFile, error) {
	var zero BackupFile
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	if ctx.Err() != nil {
		return zero, ctx.Err()
	}

	settings, err := s.loadBackupSettings()
	if err != nil {
		return zero, err
	}
	if err := os.MkdirAll(s.config.BackupDir, 0700); err != nil {
		return zero, fmt.Errorf("创建备份目录失败: %w", err)
	}

	var pageSize, pageCount int64
	if err := s.db.QueryRow("PRAGMA page_size").Scan(&pageSize); err != nil {
		return zero, fmt.Errorf("读取数据库大小失败: %w", err)
	}
	if err := s.db.QueryRow("PRAGMA page_count").Scan(&pageCount); err != nil {
		return zero, fmt.Errorf("读取数据库大小失败: %w", err)
	}
	required := backupMinFreeBytes + pageSize*pageCount*3
	free, diskErr := diskFreeBytes(s.config.BackupDir)
	if diskErr == nil && free < required {
		return zero, fmt.Errorf("磁盘可用空间不足")
	}

	now := time.Now().UTC()
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return zero, err
	}
	id := strconv.FormatInt(now.UnixNano(), 10) + "-" + hex.EncodeToString(random)
	filename := id + ".db.gz"
	rawTemp := filepath.Join(s.config.BackupDir, id+".tmp")
	finalTemp := rawTemp + ".gz.tmp"
	target := filepath.Join(s.config.BackupDir, filename)
	defer func() {
		_ = os.Remove(rawTemp)
		_ = os.Remove(finalTemp)
	}()

	// VACUUM INTO：官方推荐的一致性备份方式，顺带压实空闲页
	// （历史删除留下的 freelist 会让整文件页拷贝虚胖数倍）。
	if _, err := s.db.ExecContext(ctx, "VACUUM INTO ?", rawTemp); err != nil {
		return zero, fmt.Errorf("生成数据库快照失败: %w", err)
	}
	info, err := os.Stat(rawTemp)
	if err != nil {
		return zero, err
	}
	if info.Size() <= 0 {
		return zero, fmt.Errorf("数据库快照为空")
	}
	if err := compressSQLiteSnapshot(rawTemp, finalTemp); err != nil {
		return zero, fmt.Errorf("压缩快照失败: %w", err)
	}
	info, err = os.Stat(finalTemp)
	if err != nil {
		return zero, err
	}
	if err := os.Rename(finalTemp, target); err != nil {
		return zero, err
	}
	_ = os.Chmod(target, 0600)

	displayName := now.Format("备份 2006-01-02 15:04")
	createdAt := formatBackupTime(now)
	record := BackupFile{
		ID:          id,
		DisplayName: displayName,
		SizeBytes:   info.Size(),
		Source:      source,
		CreatedAt:   createdAt,
	}
	if _, err := s.db.Exec(
		`INSERT INTO backup_files (id, display_name, filename, size_bytes, source, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		record.ID, record.DisplayName, filename, record.SizeBytes, record.Source, record.CreatedAt,
	); err != nil {
		_ = os.Remove(target)
		return zero, err
	}
	if err := s.pruneOldBackups(settings.MaxCount); err != nil {
		return record, err
	}

	statusErr := s.setAppSetting("backup_last_run_at", createdAt)
	statusErr = errors.Join(statusErr, s.setAppSetting("backup_last_error", ""))
	if statusErr != nil {
		return record, statusErr
	}
	return record, nil
}

func (s *Server) pruneOldBackups(maxCount int) error {
	rows, err := s.db.Query(
		`SELECT id, filename FROM backup_files ORDER BY id DESC LIMIT -1 OFFSET ?`, maxCount,
	)
	if err != nil {
		return err
	}
	var removeIDs []string
	var removeFiles []string
	for rows.Next() {
		var id, filename string
		if err := rows.Scan(&id, &filename); err != nil {
			rows.Close()
			return err
		}
		removeIDs, removeFiles = append(removeIDs, id), append(removeFiles, filename)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for i, id := range removeIDs {
		if _, err := s.db.Exec("DELETE FROM backup_files WHERE id = ?", id); err != nil {
			return err
		}
		if err := os.Remove(filepath.Join(s.config.BackupDir, removeFiles[i])); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func compressSQLiteSnapshot(source, destination string) error {
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	gz, err := gzip.NewWriterLevel(dst, gzip.BestCompression)
	if err != nil {
		dst.Close()
		return err
	}
	if _, err := io.Copy(gz, src); err != nil {
		gz.Close()
		dst.Close()
		return err
	}
	if err := gz.Close(); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Sync(); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

func (s *Server) RunBackupScheduler(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	check := func() {
		settings, err := s.loadBackupSettings()
		if err != nil {
			return
		}
		effective := settings
		effective.NextRunAt = settings.effectiveNextRun()
		if settings.IntervalHours == 0 || parseBackupTime(effective.NextRunAt).After(time.Now()) {
			if settings.IntervalHours != 0 && settings.NextRunAt == "" {
				_ = s.setAppSetting("backup_next_run_at", effective.NextRunAt)
			}
			return
		}

		file, err := s.CreateBackup(ctx, "auto")
		now := time.Now().UTC()
		nextDelay := time.Duration(settings.IntervalHours) * time.Hour
		if err != nil {
			// 快照/磁盘偶发失败按小时退避，避免每分钟反复打满 IO。
			retryDelay := time.Hour
			if nextDelay < retryDelay {
				retryDelay = nextDelay
			}
			_ = s.setAppSetting("backup_next_run_at", formatBackupTime(now.Add(retryDelay)))
			message := err.Error()
			if len([]rune(message)) > 500 {
				message = string([]rune(message)[:500])
			}
			_ = s.setAppSetting("backup_last_error", message)
			return
		}
		_ = s.setAppSetting("backup_last_run_at", file.CreatedAt)
		_ = s.setAppSetting("backup_next_run_at", formatBackupTime(parseBackupTime(file.CreatedAt).Add(nextDelay)))
		_ = s.setAppSetting("backup_last_error", "")
	}
	check()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check()
		}
	}
}

func (s *Server) openVerifiedSnapshot(filename string) (*sql.DB, func(), error) {
	path := filepath.Join(s.config.BackupDir, filename)
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()

	gz, err := gzip.NewReader(file)
	if err != nil {
		return nil, nil, fmt.Errorf("备份格式无效: %w", err)
	}
	tmp, err := os.CreateTemp(s.config.BackupDir, "restore-*.db")
	if err != nil {
		return nil, nil, err
	}
	tmpPath := tmp.Name()
	cleanup := func() {
		tmp.Close()
		os.Remove(tmpPath)
	}
	written, err := io.Copy(tmp, io.LimitReader(gz, backupMaxGzipBytes))
	closeErr := gz.Close()
	syncErr := tmp.Sync()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = syncErr
	}
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	if written <= 0 || written >= backupMaxGzipBytes {
		cleanup()
		return nil, nil, fmt.Errorf("备份过大或不完整")
	}
	_ = tmp.Close()

	db, err := sql.Open("sqlite", tmpPath)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.PingContext(context.Background()); err != nil {
		db.Close()
		cleanup()
		return nil, nil, fmt.Errorf("备份无法打开: %w", err)
	}
	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		db.Close()
		cleanup()
		return nil, nil, fmt.Errorf("备份完整性校验失败")
	}
	return db, func() {
		db.Close()
		cleanup()
	}, nil
}

func tableColumns(db *sql.DB, table string, allowed map[string]bool) (map[string]bool, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, pk int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		if allowed[name] {
			columns[name] = true
		}
	}
	return columns, rows.Err()
}

func commonColumns(snapshot, live map[string]bool, allowed []string) ([]string, error) {
	columns := make([]string, 0, len(allowed))
	for _, name := range allowed {
		if snapshot[name] && live[name] {
			columns = append(columns, name)
		}
	}
	return columns, nil
}

func requireColumns(columns []string, required ...string) error {
	found := make(map[string]bool, len(columns))
	for _, column := range columns {
		found[column] = true
	}
	for _, column := range required {
		if !found[column] {
			return fmt.Errorf("备份缺少字段 %s，架构不兼容", column)
		}
	}
	return nil
}

func quoteIdentifiers(columns []string) []string {
	quoted := make([]string, len(columns))
	for i, column := range columns {
		quoted[i] = `"` + column + `"`
	}
	return quoted
}

func restoreTableRows(tx *sql.Tx, snapshot *sql.DB, table string, columns []string) (int, error) {
	quoted := quoteIdentifiers(columns)
	selectSQL := "SELECT " + strings.Join(quoted, ", ") + ` FROM "` + table + `" ORDER BY id`
	insertSQL := `INSERT INTO "` + table + `" (` + strings.Join(quoted, ", ") + `) VALUES (` +
		strings.TrimSuffix(strings.Repeat("?, ", len(columns)), ", ") + `)`

	stmt, err := tx.Prepare(insertSQL)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()
	rows, err := snapshot.Query(selectSQL)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(values))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return count, err
		}
		if _, err := stmt.Exec(values...); err != nil {
			return count, err
		}
		count++
	}
	return count, rows.Err()
}

func resetTableSequence(tx *sql.Tx, table string) error {
	var maxID any
	if err := tx.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM "` + table + `"`).Scan(&maxID); err != nil {
		return err
	}
	result, err := tx.Exec("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", maxID, table)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		_, err = tx.Exec("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", table, maxID)
		return err
	}
	return nil
}

func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()

	path, _, err := s.getBackupRecord(r)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "备份不存在") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "备份不存在"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份失败"})
		}
		return
	}
	base := filepath.Base(path)
	snapshot, closeSnapshot, err := s.openVerifiedSnapshot(base)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	defer closeSnapshot()

	categoryAllowed := map[string]bool{
		"id": true, "name": true, "icon": true, "color": true, "sort_order": true,
	}
	bookmarkAllowed := map[string]bool{
		"id": true, "url": true, "title": true, "description": true, "category_id": true,
		"tags": true, "favicon": true, "sort_order": true, "created_at": true, "updated_at": true,
		"is_favorite": true, "source": true, "source_id": true, "github_list": true,
		"search_text": true, "favicon_version": true,
	}
	snapshotCategories, err := tableColumns(snapshot, "categories", categoryAllowed)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "备份架构不兼容"})
		return
	}
	snapshotBookmarks, err := tableColumns(snapshot, "bookmarks", bookmarkAllowed)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "备份架构不兼容"})
		return
	}
	liveCategories, err := tableColumns(s.db, "categories", categoryAllowed)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取主表结构失败"})
		return
	}
	liveBookmarks, err := tableColumns(s.db, "bookmarks", bookmarkAllowed)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取主表结构失败"})
		return
	}
	categoryColumns, err := commonColumns(snapshotCategories, liveCategories, []string{"id", "name", "icon", "color", "sort_order"})
	if err = errors.Join(err, requireColumns(categoryColumns, "id", "name")); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	bookmarkColumns, err := commonColumns(snapshotBookmarks, liveBookmarks, bookmarkAllowedOrder())
	if err = errors.Join(err, requireColumns(bookmarkColumns, "id", "url", "title", "category_id")); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "恢复失败"})
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM bookmarks"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "恢复书签失败"})
		return
	}
	if _, err := tx.Exec("DELETE FROM categories"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "恢复分类失败"})
		return
	}
	if _, err := restoreTableRows(tx, snapshot, "categories", categoryColumns); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "恢复分类数据失败: " + err.Error()})
		return
	}
	count, err := restoreTableRows(tx, snapshot, "bookmarks", bookmarkColumns)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "恢复书签数据失败: " + err.Error()})
		return
	}
	if err := errors.Join(resetTableSequence(tx, "categories"), resetTableSequence(tx, "bookmarks")); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新恢复序列失败"})
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "提交恢复事务失败"})
		return
	}
	s.broadcastInvalidated("bookmarks", "categories")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "restored_bookmarks": count})
}

func (s *Server) handleBackupPreview(w http.ResponseWriter, r *http.Request) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()

	path, _, err := s.getBackupRecord(r)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "备份不存在") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "备份不存在"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "读取备份失败"})
		}
		return
	}
	snapshot, closeSnapshot, err := s.openVerifiedSnapshot(filepath.Base(path))
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	defer closeSnapshot()

	var bookmarks, categories int
	if err := snapshot.QueryRow("SELECT COUNT(*) FROM categories").Scan(&categories); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "备份架构不兼容"})
		return
	}
	if err := snapshot.QueryRow("SELECT COUNT(*) FROM bookmarks").Scan(&bookmarks); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "备份架构不兼容"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bookmarks": bookmarks, "categories": categories})
}

func bookmarkAllowedOrder() []string {
	return []string{
		"id", "url", "title", "description", "category_id", "tags", "favicon",
		"sort_order", "created_at", "updated_at", "is_favorite", "source",
		"source_id", "github_list", "search_text", "favicon_version",
	}
}
