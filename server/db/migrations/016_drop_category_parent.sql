-- The hierarchy data was cleared in 015. Rebuild the table without the legacy column.
PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE categories_flat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'fa-folder',
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO categories_flat (id, name, icon, color, sort_order)
SELECT id, name, icon, color, sort_order FROM categories;

DROP TABLE categories;
ALTER TABLE categories_flat RENAME TO categories;

COMMIT;

PRAGMA foreign_keys=ON;
