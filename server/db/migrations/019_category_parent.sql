-- 重新引入固定两级分类层级：parent_id 指向父分类，NULL = 顶级。
-- 与 013（已废弃）的区别：本次约束两级封顶——应用层校验父分类必须是顶级，
-- 删除父分类时子分类升级为顶级，拖拽排序仅限同级兄弟。
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
