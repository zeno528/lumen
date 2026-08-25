/**
 * AI Provider 元数据 -- 对齐后端 ai_settings.go allowedProviders / providerDefaults。
 * model/baseUrl 以**新后端** providerDefaults 为权威（AI_PRESETS 模型版本较旧，
 * 保存时后端也会按 providerDefaults 补默认）；label 用中文显示名。
 *
 * modelOptions: 该 provider 常用模型候选列表（前端 Combobox 下拉用，纯展示辅助，
 * 不进后端）。第一个对齐 model（默认模型）。custom 不设（用户手填）。
 *
 * logo: 厂商 SVG 路径（/public/providers/），null 表示该厂商暂无 logo
 * format: API 调用格式描述（显示在下拉选项里）
 */
export interface AIProviderPreset {
  model: string
  modelOptions?: string[]
  baseUrl: string
  label: string
  logo: string | null
  format: string
  formats?: Array<{
    value: 'openai' | 'anthropic'
    label: string
    baseUrl: string
  }>
}

export const AI_PRESETS: Record<string, AIProviderPreset> = {
  deepseek: {
    model: 'deepseek-v4-flash',
    modelOptions: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    baseUrl: 'https://api.deepseek.com/v1',
    label: 'DeepSeek',
    logo: '/providers/deepseek.svg',
    format: 'OpenAI / Anthropic 格式',
    formats: [
      { value: 'openai', label: 'OpenAI Chat Completions 格式', baseUrl: 'https://api.deepseek.com/v1' },
      { value: 'anthropic', label: 'Anthropic Messages 格式', baseUrl: 'https://api.deepseek.com/anthropic' },
    ],
  },
  zhipu: {
    model: 'glm-5-turbo',
    modelOptions: ['glm-5-turbo', 'glm-5.2'],
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    label: '智谱 GLM',
    logo: '/providers/zhipu.svg',
    format: 'OpenAI / Anthropic 格式',
    formats: [
      { value: 'openai', label: 'OpenAI Chat Completions 格式', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
      { value: 'anthropic', label: 'Anthropic Messages 格式', baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
    ],
  },
  minimax: {
    model: 'MiniMax-M3',
    modelOptions: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5'],
    baseUrl: 'https://api.minimaxi.com/anthropic',
    label: 'MiniMax',
    logo: '/providers/minimax.svg',
    format: 'Anthropic 格式',
  },
  siliconflow: {
    model: 'Qwen/Qwen3.5-122B-A10B',
    modelOptions: [
      'Qwen/Qwen3.5-122B-A10B',
      'Qwen/Qwen3.6-27B',
      'Qwen/Qwen3.5-27B',
    ],
    baseUrl: 'https://api.siliconflow.cn/v1',
    label: '硅基流动',
    logo: '/providers/siliconcloud-siliconflow.svg',
    format: 'OpenAI 格式',
  },
}

/** 自定义厂商（可显式选择 OpenAI / Anthropic 协议）-- 复用同一渲染逻辑 */
export const CUSTOM_PROVIDER_PRESET: AIProviderPreset = {
  model: '',
  baseUrl: '',
  label: '自定义',
  logo: null,
  format: '兼容 OpenAI / Anthropic 格式',
}

/** 各 provider 密钥申请地址（custom 无固定入口） */
export const AI_APPLY_URLS: Record<string, string> = {
  deepseek: 'https://platform.deepseek.com',
  zhipu: 'https://open.bigmodel.cn',
  minimax: 'https://platform.minimaxi.com',
  siliconflow: 'https://cloud.siliconflow.cn/i/3SOwJUoq',
}

/** 下拉顺序（custom 在最后）*/
export const AI_PROVIDER_ORDER = [
  'deepseek',
  'zhipu',
  'minimax',
  'siliconflow',
  'custom',
]

export const CUSTOM_API_FORMATS = [
  { value: 'openai', label: 'OpenAI Chat Completions 兼容格式' },
  { value: 'anthropic', label: 'Anthropic Messages 格式' },
]

export const ANTHROPIC_FORMAT_PRESET = {
  modelOptions: ['claude-opus-4-8', 'claude-sonnet-5'],
  keyURL: 'https://console.anthropic.com',
}
