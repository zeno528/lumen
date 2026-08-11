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
import { router } from './router'

/* 初始化主题（深浅 data-theme + 配色 data-accent），避免首屏闪烁 */
const savedTheme = localStorage.getItem('theme') || 'light'
document.documentElement.dataset.theme =
  savedTheme === 'dark' ? 'notion-dark' : savedTheme
document.documentElement.dataset.accent = localStorage.getItem('accent') || 'gold'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
const appRoot = root

/* ========== 昵称 / 头像 首屏 hydration ==========
   fetchNickname 优先读 localStorage 缓存；新项目用 TanStack Query
   没有现成持久化层，会导致首屏 queryData=undefined → 渲染兜底 "用户" → 异步拉取完成后
   跳到真实昵称 → 闪烁。这里给 queryClient 用 initialData 从 localStorage 预填充，
   让 query 首次渲染就有数据，与 localStorage 缓存行为对齐。
   —— 这是 SSR/hydrate 模式下 queryClient 的标准用法，不算引入持久化层。 */
function readCachedNickname(): { nickname: string } | undefined {
  try {
    const cached = localStorage.getItem('nickname')
    return cached ? { nickname: cached } : undefined
  } catch {
    return undefined
  }
}
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

function startApp() {
  // 先完成持久化缓存恢复，再以专用的昵称/头像缓存覆盖它：两者是账户设置真值，
  // 不能让上一轮 Query 缓存的旧头像在首帧短暂盖过当前头像。
  const cachedNick = readCachedNickname()
  if (cachedNick) queryClient.setQueryData(['auth-nickname'], cachedNick)
  const cachedAvatar = readAvatarCache()
  if (cachedAvatar) queryClient.setQueryData(['auth-avatar'], cachedAvatar)

  createRoot(appRoot).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void restoreQueryCache.then(startApp, startApp)
