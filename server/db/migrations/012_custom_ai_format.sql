-- 自定义供应商显式保存协议；旧 Anthropic 预设并入自定义的 Anthropic 格式，保留所有配置数据。
ALTER TABLE ai_provider_configs ADD COLUMN api_format TEXT NOT NULL DEFAULT 'openai';

UPDATE ai_provider_configs
SET provider = 'custom', api_format = 'anthropic'
WHERE provider = 'anthropic';
