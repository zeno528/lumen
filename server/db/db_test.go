package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"lumen/server/db"
)

func TestMigrateRemovesLegacyCategoryParentColumn(t *testing.T) {
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

	rows, err := database.Query("PRAGMA table_info(categories)")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		if name == "parent_id" {
			t.Fatal("legacy parent_id column should be removed")
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
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
