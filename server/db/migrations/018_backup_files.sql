CREATE TABLE IF NOT EXISTS backup_files (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    filename     TEXT NOT NULL UNIQUE,
    size_bytes   INTEGER NOT NULL,
    source       TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
    created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
