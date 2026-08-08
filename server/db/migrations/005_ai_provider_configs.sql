-- Per-provider AI configuration storage
CREATE TABLE IF NOT EXISTS ai_provider_configs (
    provider          TEXT PRIMARY KEY,
    model             TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    base_url          TEXT NOT NULL DEFAULT '',
    key_created_at    TEXT NOT NULL DEFAULT '',
    key_last_used_at  TEXT NOT NULL DEFAULT '',
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Migrate existing single-config data from settings table (idempotent)
INSERT OR IGNORE INTO ai_provider_configs (provider, model, api_key_encrypted, base_url, key_created_at)
SELECT
    s1.value,
    COALESCE(s2.value, ''),
    COALESCE(s3.value, ''),
    COALESCE(s4.value, ''),
    COALESCE(s5.value, '')
FROM settings s1
LEFT JOIN settings s2 ON s2.key = 'ai_model'
LEFT JOIN settings s3 ON s3.key = 'ai_api_key_encrypted'
LEFT JOIN settings s4 ON s4.key = 'ai_base_url'
LEFT JOIN settings s5 ON s5.key = 'ai_key_created_at'
WHERE s1.key = 'ai_provider'
  AND s1.value != '';

-- Active provider pointer
INSERT OR IGNORE INTO settings (key, value)
VALUES ('ai_active_provider', (SELECT value FROM settings WHERE key = 'ai_provider'));
