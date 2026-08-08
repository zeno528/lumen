-- 007: AI 配置加 display_name（custom 配置的自定义名字；预设厂商留空，展示回退到 provider label）
ALTER TABLE ai_provider_configs ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
