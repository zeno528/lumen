package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"lumen/server/db"
)

func TestMigrateClearsLegacyCategoryHierarchy(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	if _, err := database.Exec(`
		CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			icon TEXT NOT NULL DEFAULT 'fa-folder',
			color TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			parent_id INTEGER
		);
		CREATE TABLE bookmarks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
		);
		INSERT INTO schema_migrations (version) VALUES (1), (2), (3), (4), (5), (6), (7), (12), (13), (14);
		INSERT INTO categories (id, name, parent_id) VALUES (1, 'Parent', NULL), (2, 'Child', 1);
		INSERT INTO bookmarks (id, category_id) VALUES (1, 2);
	`); err != nil {
		t.Fatal(err)
	}

	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}

	// 迁移历史：015 清空层级数据、016 删除 parent_id 列；019 为两级分类重新加回该列。
	// 关键不变量：旧层级数据必须已被清空——迁移后所有分类的 parent_id 都应是 NULL。
	var linkedCount int
	if err := database.QueryRow("SELECT COUNT(*) FROM categories WHERE parent_id IS NOT NULL").Scan(&linkedCount); err != nil {
		t.Fatal(err)
	}
	if linkedCount != 0 {
		t.Fatalf("categories with parent_id = %d, want 0（旧层级数据必须被清空）", linkedCount)
	}

	var categoryCount int
	if err := database.QueryRow("SELECT COUNT(*) FROM categories").Scan(&categoryCount); err != nil {
		t.Fatal(err)
	}
	if categoryCount != 2 {
		t.Fatalf("categories = %d, want 2", categoryCount)
	}

	var categoryID sql.NullInt64
	if err := database.QueryRow("SELECT category_id FROM bookmarks WHERE id = 1").Scan(&categoryID); err != nil {
		t.Fatal(err)
	}
	if !categoryID.Valid || categoryID.Int64 != 2 {
		t.Fatalf("bookmark category_id = %v, want 2", categoryID)
	}

	if _, err := database.Exec("DELETE FROM categories WHERE id = 2"); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow("SELECT category_id FROM bookmarks WHERE id = 1").Scan(&categoryID); err != nil {
		t.Fatal(err)
	}
	if categoryID.Valid {
		t.Fatalf("bookmark category_id = %v, want NULL after category deletion", categoryID)
	}
}
