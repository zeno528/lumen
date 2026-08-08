/**
 * API 客户端 —— 统一 fetch 封装。
 * - 自动注入 Authorization: Bearer（JWT 与 msk_ token 共用，后端按前缀区分）
 * - 401 清 token 跳登录
 * - 错误归一化为 ApiError
 * 走 Vite proxy（/api → localhost:8081），同源规避 CORS。
 */
const BASE = '/api'

let getToken: () => string | null = () => null
let onUnauthorized: () => void = () => {}

/** 由 auth store 注册 token 来源与 401 回调（避免循环依赖）*/
export function configureApiClient(opts: {
  getToken: () => string | null
  onUnauthorized: () => void
}) {
  getToken = opts.getToken
  onUnauthorized = opts.onUnauthorized
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (!res.ok) {
    // 401 但未携带 token → 是登录页 POST /auth/login 的"账号或密码错误"，不跳登录
    // 401 且携带 token → token 失效/被改 → 触发 onUnauthorized 清 token 跳登录
    if (res.status === 401 && token) {
      onUnauthorized()
    }
    let msg = `请求失败 (${res.status})`
    try {
      const data = await res.json()
      msg = data.error ?? msg
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(res.status, msg)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}
