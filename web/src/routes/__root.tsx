import { useEffect } from 'react'
import { createRootRoute, HeadContent, Outlet, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth'
import { ToastContainer, toast } from '@/components/ui/toast'

/**
 * 根布局壳 —— 渲染 <Outlet/> + 全局 Toast 容器。
 * 处理 GitHub OAuth 回调：/?token=xxx 时写入 token 并跳到书签页；
 * ?error=xxx 时 toast 提示。
 */
export const Route = createRootRoute({
  beforeLoad: () => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      useAuthStore.getState().setToken(token)
      window.history.replaceState({}, '', window.location.pathname)
      throw redirect({ to: '/bookmarks' })
    }
  },
  component: RootLayout,
})

function RootLayout() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    if (!error) return
    const map: Record<string, string> = {
      github_not_configured: 'GitHub 登录未配置',
      oauth_missing_params: '授权参数缺失',
      oauth_invalid_state: '授权状态异常',
      oauth_token_failed: '获取 GitHub Token 失败',
      oauth_user_failed: '获取 GitHub 用户信息失败',
      oauth_unauthorized: '该 GitHub 账号未授权',
    }
    toast.error(map[error] || `GitHub 登录失败 (${error})`)
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  // 禁止移动端双击缩放（iOS Safari 忽略 touch-action 时的兜底）
  useEffect(() => {
    let lastTouchEnd = 0
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now()
      if (now - lastTouchEnd <= 300) e.preventDefault()
      lastTouchEnd = now
    }
    document.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => document.removeEventListener('touchend', onTouchEnd)
  }, [])

  return (
    <>
      {/* 启用 TanStack Router head 管理：子路由 routeOptions.head 声明的 title/meta
          由此组件统一渲染到 document.head（自动去重 + 路由切换自动卸载） */}
      <HeadContent />
      <Outlet />
      <ToastContainer />
    </>
  )
}
