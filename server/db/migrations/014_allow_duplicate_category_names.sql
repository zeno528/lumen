-- 重建 categories 去掉 name 唯一约束（允许父子分类同名）。
-- ⚠️ PRAGMA foreign_keys 必须在 BEGIN 之前设置：事务内它是 no-op，届时 DROP TABLE
-- 会触发隐式 DELETE，bookmarks 的 ON DELETE SET NULL 会把所有书签清成未分类。
PRAGMA foreign_keys=OFF;

BEGIN;

CREATE TABLE categories_without_name_unique (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'fa-folder',
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    parent_id INTEGER REFERENCES categories_without_name_unique(id) ON DELETE RESTRICT
);

INSERT INTO categories_without_name_unique (id, name, icon, color, sort_order, parent_id)
SELECT id, name, icon, color, sort_order, parent_id FROM categories;

DROP TABLE categories;
ALTER TABLE categories_without_name_unique RENAME TO categories;
CREATE INDEX idx_categories_parent ON categories(parent_id);

COMMIT;

PRAGMA foreign_keys=ON;
