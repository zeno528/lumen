import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/query-persist-client-core'
import type { Persister, PersistedClient } from '@tanstack/query-persist-client-core'
import '@fontsource-variable/inter'
import './styles/main.css'
import { setAuthQueryClient } from '@/stores/auth'
import { readAvatarCache } from '@/lib/avatar-cache'
import { getCustomAvatarUrl, preloadAvatarImage } from '@/lib/avatar-upload'
import { applyTheme, getSavedTheme } from '@/lib/theme'
import { router } from './router'

/* 初始化主题（深浅 data-theme + 配色 data-accent），避免首屏闪烁 */
applyTheme(getSavedTheme())
document.documentElement.dataset.accent = localStorage.getItem('accent') || 'terracotta'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
const appRoot = root

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // staleTime 5min：跨设备变更由 WS 实时推送 invalidate（useWebSocketSync），
      // 不再依赖主动 refetch 同步；5min 内刷新命中 persist 缓存零网络，真正秒开。
      // WS 断开时由 refetchOnWindowFocus / refetchOnReconnect（默认 true）兜底补齐。
      staleTime: 5 * 60 * 1000,
      // refetchOnMount 用默认 true（staleTime 内不 refetch）：跨设备同步职责已移交 WS
      // （onmessage invalidate + onopen 重连补齐），不再需要 'always' 绕过 staleTime
      // 强制刷新 -- 那会让 persist 缓存形同虚设（每次刷新都重拉万条数据）。
      // persist 持久化要求 gcTime 远大于 staleTime，否则缓存被提前 GC 失去持久化意义
      gcTime: 1000 * 60 * 60 * 24, // 24h
    },
  },
})

/* ========== Query 缓存持久化到 localStorage（同步 persister，零延迟落盘）==========
   刷新页面后 React Query 内存缓存清空，bookmarks/categories 需重新走网络，
   期间分类栏与书签视图空白约 0.5s。用官方 persistQueryClient 把缓存持久化到 localStorage：
   刷新瞬间恢复上次数据 → 立即渲染 → 后台静默 refetch（staleTime 30s 触发刷新）。
   既零白屏又实时，比 spinner 等待体验好。

   【为什么不用官方 createSyncStoragePersister】它内部用 setTimeout 节流，
   即使 throttleTime=0，写入也被推到下一个宏任务；而 React 渲染走微任务更早完成 ——
   存在"UI 已显示新值、localStorage 尚未落盘"的窗口，改完内容立刻刷新会闪一下旧值。
   这里自定义同步 persister：persistClient 不经节流、直接 setItem，在 cache 变化的
   同一同步栈落盘（先于 React 渲染），保证刷新永远拿到最新值。
   代价：每次 cache 变化同步写一次 LS（约十几 ms），书签操作不频繁，可接受。

   buster：后端返回结构变更时改这个字符串，让所有用户旧缓存整体失效。 */
const PERSIST_KEY = 'REACT_QUERY_OFFLINE_CACHE'
const localStoragePersister: Persister = {
  persistClient(client: PersistedClient) {
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(client))
    } catch {
      /* quota exceeded 等静默忽略（同官方 trySave 行为） */
    }
  },
  restoreClient(): PersistedClient | undefined {
    try {
      const cached = window.localStorage.getItem(PERSIST_KEY)
      return cached ? (JSON.parse(cached) as PersistedClient) : undefined
    } catch {
      return undefined
    }
  },
  removeClient() {
    try {
      window.localStorage.removeItem(PERSIST_KEY)
    } catch {
      /* ignore */
    }
  },
}
setAuthQueryClient(queryClient)
const [, restoreQueryCache] = persistQueryClient({
  queryClient,
  persister: localStoragePersister,
  buster: 'v1',
})

function preloadMobileAvatar(avatar: ReturnType<typeof readAvatarCache>) {
  const url = getCustomAvatarUrl(avatar?.avatar, avatar?.avatarImage)
  if (!url || !window.matchMedia('(max-width: 768px)').matches) return
  preloadAvatarImage(url)
}

function startApp() {
  // 完成持久化缓存恢复后，以专用的头像缓存覆盖它：头像真值，不能让上一轮 Query 缓存的
  // 旧头像在首帧短暂盖过当前头像。
  // 昵称不在此覆盖：localStorage['nickname'] 只有本端保存时更新，跨端变更会拿旧值盖新值，
  // 且 setQueryData 会重置 freshness 阻止 refetch —— 交给持久化 Query 缓存（每次 fetch/WS
  // 刷新自动落盘）作唯一本地水合来源。
  const cachedAvatar = readAvatarCache()
  if (cachedAvatar) queryClient.setQueryData(['auth-avatar'], cachedAvatar)
  // 移动端仅预解码本地头像，避免 <img> 首次绘制晚于头像容器。
  // Data URI 已在 localStorage 中，不产生额外网络请求。
  preloadMobileAvatar(cachedAvatar)

  createRoot(appRoot).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void restoreQueryCache.then(startApp, startApp)
