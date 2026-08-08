-- 006: AI 配置支持同 provider 多份（provider 不再唯一，改 id 自增主键）
-- SQLite 不能直接改主键，重建表。

CREATE TABLE ai_provider_configs_new (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    provider          TEXT NOT NULL DEFAULT '',
    model             TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    base_url          TEXT NOT NULL DEFAULT '',
    key_created_at    TEXT NOT NULL DEFAULT '',
    key_last_used_at  TEXT NOT NULL DEFAULT '',
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 迁移已有配置数据（每行保留原值，生成新自增 id）
INSERT INTO ai_provider_configs_new (provider, model, api_key_encrypted, base_url, key_created_at, key_last_used_at, updated_at)
SELECT provider, model, api_key_encrypted, base_url, key_created_at, key_last_used_at, updated_at
FROM ai_provider_configs;

DROP TABLE ai_provider_configs;
ALTER TABLE ai_provider_configs_new RENAME TO ai_provider_configs;

-- 迁移 active 指针：key ai_active_provider -> ai_active_config_id，
-- value 由 provider 名换成对应配置 id（找不到则置空 = 取消激活）
UPDATE settings
SET key = 'ai_active_config_id',
    value = COALESCE((SELECT CAST(id AS TEXT) FROM ai_provider_configs WHERE provider = settings.value), '')
WHERE key = 'ai_active_provider';
