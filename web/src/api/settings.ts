import { api, ApiError } from './client'
import { useAuthStore } from '@/stores/auth'
import type { ApiToken, ApiTokenCreated } from '@/types'

// ===== 账户（auth.go）=====

/** 当前账号（留空保持不变提示用）*/
export function getUsername(): Promise<{ username: string }> {
  return api('/auth/username')
}

/** 当前昵称 */
export function getNickname(): Promise<{ nickname: string }> {
  return api('/auth/nickname')
}

/** 当前头像 */
export interface AvatarSettings {
  avatar: string
  avatarColor: string
  avatarImage?: string
}

export function getAvatar(): Promise<AvatarSettings> {
  return api('/auth/avatar')
}

/** 修改头像 */
export function updateAvatar(body: AvatarSettings): Promise<AvatarSettings & { ok: boolean }> {
  return api('/auth/avatar', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** GitHub OAuth 是否可用 */
export function getGitHubStatus(): Promise<{ enabled: boolean }> {
  return api('/auth/github/status')
}

/** 改昵称（不需密码，PUT /api/auth/nickname）*/
export function updateNickname(nickname: string): Promise<{ nickname: string }> {
  return api('/auth/nickname', {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  })
}

/**
 * 改账号/密码（需当前密码验证，PUT /api/auth/password）。
 * 成功后 token 失效，调用方应强制重登。
 *
 * 注意：绕过统一 api 客户端——后者对所有 401 自动 logout+跳登录，
 * 但“旧密码错”是业务 401，应留在页面提示，故此处用原生 fetch 手动处理。
 */
export async function updatePassword(body: {
  currentPassword: string
  newPassword?: string
  username?: string
  nickname?: string
}): Promise<void> {
  const token = useAuthStore.getState().token
  const res = await fetch('/api/auth/password', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = '修改失败'
    try {
      const d = await res.json()
      msg = d.error || msg
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(res.status, res.status === 401 ? '当前密码错误' : msg)
  }
}

// ===== 用户偏好设置（user_settings.go，跨设备同步）=====

/** GET /api/settings/id-search-mode — 读 ID 搜索模式开关 */
export function getIdSearchMode(): Promise<{ enabled: boolean }> {
  return api('/settings/id-search-mode')
}

/** PUT /api/settings/id-search-mode — 写 ID 搜索模式开关 */
export function setIdSearchMode(enabled: boolean): Promise<{ ok: boolean }> {
  return api('/settings/id-search-mode', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

// ===== API Token（tokens.go，msk_ 体系）=====

/** Token 列表（脱敏）*/
export function listTokens(): Promise<ApiToken[]> {
  return api('/tokens')
}

/** 创建 Token —— 明文仅此一次返回 */
export function createToken(name?: string): Promise<ApiTokenCreated> {
  return api('/tokens', {
    method: 'POST',
    body: JSON.stringify({ name: name ?? '' }),
  })
}

/** 改 Token 名 */
export function updateToken(id: number, name: string): Promise<{ ok: boolean }> {
  return api(`/tokens/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

/** 撤销 Token */
export function deleteToken(id: number): Promise<{ ok: boolean }> {
  return api(`/tokens/${id}`, { method: 'DELETE' })
}

// ===== AI 设置（ai_settings.go / ai_provider_configs.go）=====

/** 已保存配置摘要（不含密钥明文）*/
export interface SavedConfig {
  id: number
  provider: string
  displayName?: string
  model: string
  baseUrl: string
  hasKey: boolean
  keyHint?: string
  keyCreatedAt?: string
}

/** GET /api/ai-settings 响应 */
export interface AISettings {
  activeConfigId?: number
  activeProvider?: string
  provider?: string
  model?: string
  hasKey?: boolean
  keyHint?: string
  baseUrl?: string
  source?: 'db' | 'env'
  savedConfigs?: SavedConfig[]
}

export function getAISettings(): Promise<AISettings> {
  return api('/ai-settings')
}

/** 保存配置（PUT /api/ai-settings）。configId=0 新增，>0 更新；返回新 configId */
export function updateAISettings(body: {
  configId: number
  provider: string
  displayName: string
  model: string
  apiKey: string
  baseUrl: string
}): Promise<{ ok: boolean; configId: number; message: string }> {
  return api('/ai-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * 切换激活配置（PUT /api/ai-settings/switch）。
 * configId 传 0 = 取消激活（关开关，清空 activeConfigId）。
 */
export function switchAIProvider(configId: number): Promise<{
  ok: boolean
  model: string
  baseUrl: string
  hasKey: boolean
  keyHint: string
}> {
  return api('/ai-settings/switch', {
    method: 'PUT',
    body: JSON.stringify({ configId }),
  })
}

/** 删除某配置（DELETE /api/ai-settings/config/{id}）*/
export function deleteAIProviderConfig(configId: number): Promise<{ ok: boolean }> {
  return api(`/ai-settings/config/${configId}`, { method: 'DELETE' })
}

/** 复制配置（含密钥），并使用当前供应商名称追加 copy 后缀。*/
export function copyAIConfig(configId: number, displayName: string): Promise<{ ok: boolean; configId: number }> {
  return api('/ai-settings/copy', {
    method: 'POST',
    body: JSON.stringify({ configId, displayName }),
  })
}

// ===== Serper（serper.go）=====

export function getSerperKey(): Promise<{ hasKey: boolean; keyHint: string }> {
  return api('/serper-key')
}

export function saveSerperKey(apiKey: string): Promise<{ ok: boolean; keyHint: string }> {
  return api('/serper-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  })
}

export function deleteSerperKey(): Promise<{ ok: boolean }> {
  return api('/serper-key', { method: 'DELETE' })
}

/** 测试 Serper key（POST /api/serper-key/test）。apiKey 可选——不传则用已配置的 */
export function testSerperKey(apiKey?: string, signal?: AbortSignal): Promise<{
  ok: boolean
  error?: string
  latency?: number
}> {
  return api('/serper-key/test', {
    method: 'POST',
    body: JSON.stringify(apiKey ? { apiKey } : {}),
    signal,
  })
}

/**
 * 测试 AI Provider 连通性（POST /api/ai-test）。
 * 发一个 max_tokens=1 的最小请求；apiKey 不传则后端用已保存的。
 * 注意：HTTP 状态恒 200，成败看 body.ok。
 */
export function testAIConnection(
  body: {
    configId?: number
    provider: string
    model: string
    apiKey?: string
    baseUrl?: string
  },
  signal?: AbortSignal,
): Promise<{ ok: boolean; latency?: number; error?: string; statusCode?: number }> {
  return api('/ai-test', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  })
}
