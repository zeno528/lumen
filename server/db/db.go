package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

func Connect(dbPath string) (*sql.DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// 启用 WAL 模式，提升并发读性能
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}
	// WAL 模式下 NORMAL 安全且快
	if _, err := db.Exec("PRAGMA synchronous=NORMAL"); err != nil {
		return nil, fmt.Errorf("set synchronous: %w", err)
	}
	// 写冲突时等待 5 秒
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		return nil, fmt.Errorf("set busy_timeout: %w", err)
	}
	// 缓存加大到 20MB
	if _, err := db.Exec("PRAGMA cache_size=-20000"); err != nil {
		return nil, fmt.Errorf("set cache_size: %w", err)
	}
	// 外键约束
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	// 连接池配置
	db.SetMaxOpenConns(1) // SQLite 单写
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(5 * time.Minute)

	return db, nil
}

func Migrate(db *sql.DB) error {
	// 创建迁移记录表
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}

	files, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("read migration files: %w", err)
	}

	for _, file := range files {
		var version int
		fmt.Sscanf(filepath.Base(file), "%d_", &version)

		var exists int
		err := db.QueryRow("SELECT 1 FROM schema_migrations WHERE version = ?", version).Scan(&exists)
		if err == sql.ErrNoRows {
			content, err := migrationFS.ReadFile(file)
			if err != nil {
				return fmt.Errorf("read migration %s: %w", file, err)
			}

			log.Printf("Running migration: %s", file)
			if _, err := db.Exec(string(content)); err != nil {
				return fmt.Errorf("execute migration %s: %w", file, err)
			}

			if _, err := db.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version); err != nil {
				return fmt.Errorf("record migration %s: %w", file, err)
			}
		}
	}

	return nil
}
