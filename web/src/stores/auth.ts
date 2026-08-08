import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QueryClient } from '@tanstack/react-query'
import { configureApiClient } from '@/api/client'

// queryClient 运行时注入（main.tsx 创建后调 setAuthQueryClient）。
// logout 时清 auth 相关 query cache：这些缓存持久化到 localStorage + staleTime 5min，
// 不清会导致改账号后重登仍命中旧缓存（如旧 username），显示与实际不一致。
let authQueryClient: QueryClient | null = null
export function setAuthQueryClient(qc: QueryClient) {
  authQueryClient = qc
}

interface AuthState {
  token: string | null
  setToken: (t: string | null) => void
  logout: () => void
}

/**
 * 认证 store —— JWT 持久化到 localStorage。
 * 后端 cookie 是 SameSite=Strict; Secure; HttpOnly，dev 跨端口种不上，
 * 故全程走 Bearer header，token 由前端自管。
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      logout: () => {
        set({ token: null })
        // 清 auth 相关缓存（持久化 + staleTime 5min，不清则重登显示旧账号/昵称/头像）
        authQueryClient?.removeQueries({ queryKey: ['auth-username'] })
        authQueryClient?.removeQueries({ queryKey: ['auth-nickname'] })
        authQueryClient?.removeQueries({ queryKey: ['auth-avatar'] })
      },
    }),
    {
      name: 'lumen-auth',
      // 仅持久化 token（setToken/logout 是函数，序列化无意义；未来加非 JSON 字段也安全）
      partialize: (s) => ({ token: s.token }),
    },
  ),
)

// 注册到 API 客户端（import 本模块即生效）
configureApiClient({
  getToken: () => useAuthStore.getState().token,
  onUnauthorized: () => {
    useAuthStore.getState().logout()
    window.location.href = '/login'
  },
})
