import { lazy, Suspense, useEffect, useState } from 'react'
import { createFileRoute, redirect, Outlet, isRedirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { useWebSocketSync } from '@/hooks/useWebSocketSync'
import { getIdSearchMode } from '@/api/settings'
import { AppShell } from '@/components/desktop/app-shell'
import { useUIStore } from '@/stores/ui'

// 设置模态框懒加载：settingsOpen=true 时才渲染加载 chunk，不进首屏
const SettingsDialog = lazy(() =>
  import('@/components/shared/settings-dialog').then((m) => ({ default: m.SettingsDialog })),
)
import { loadFaviconCache } from '@/lib/favicon-cache'

// 进入受保护区域时同步加载图标缓存到内存（localStorage 同步读，首批渲染即可用，消除刷新闪烁）
loadFaviconCache()

/**
 * 受保护路由组 —— beforeLoad 检查 token，无则跳登录。
 * AppShell 提供顶栏 + 侧边栏 + 主内容区，子路由（bookmarks/settings）渲染在 <Outlet/>。
 *
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ cause }) => {
    const token = useAuthStore.getState().token
    if (!token) {
      throw redirect({ to: '/login' })
    }
    // 仅路由「进入」时联网校验 token。搜索参数变化（如切换分类 ?category=N）等 cause='stay'
    // 导航不重复联网：否则每次切分类都等一次 /api/auth/verify 网络往返（~700ms），期间旧视图
    // 被重新挂上入场动画整体闪烁，随后同步纠正又播一遍 → 切分类双闪。token 有效性由后续
    // 每个 API 请求的 401 兜底（onUnauthorized → 登出跳登录），无安全缺口。
    if (cause !== 'enter') return
    // 验证 token 有效性：失效（401）直接跳登录，避免乐观渲染受保护页面后 401 闪烁跳转
    // 用原生 fetch 不走 api() 客户端，避免 401 触发 onUnauthorized 的 location.href 与 redirect 冲突
    try {
      const res = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        useAuthStore.getState().logout()
        throw redirect({ to: '/login' })
      }
    } catch (e) {
      if (isRedirect(e)) throw e
      // 网络错误等放行，后续 API 401 兜底
    }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const qc = useQueryClient()
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  // 延迟卸载 SettingsDialog：关闭时等 Dialog 退场动画（350ms）播完再卸载，避免无过渡动画
  const [settingsMounted, setSettingsMounted] = useState(false)
  useEffect(() => {
    if (settingsOpen) {
      setSettingsMounted(true)
    } else {
      const t = window.setTimeout(() => setSettingsMounted(false), 350)
      return () => window.clearTimeout(t)
    }
  }, [settingsOpen])
  useWebSocketSync(qc) // WebSocket 实时同步：服务端 invalidate 广播 → 自动 refetch

  // ID 搜索模式跨设备同步：本地持久化值先用于首帧，挂载后空闲时查服务端并覆盖校准
  useEffect(() => {
    const check = () => {
      getIdSearchMode()
        .then((r) => useUIStore.getState().setIdSearchMode(r.enabled))
        .catch(() => {})
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(check, { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(check, 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <AppShell>
      <Outlet />
      {settingsMounted && (
        <Suspense fallback={null}>
          <SettingsDialog />
        </Suspense>
      )}
    </AppShell>
  )
}
