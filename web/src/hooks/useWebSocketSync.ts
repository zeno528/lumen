import { useEffect, useRef } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import {
  ALL_SYNCED_RESOURCES,
  RESOURCE_TO_QUERY_KEY,
  type WSInvalidateMessage,
} from '@/lib/ws-types'

const MAX_RETRIES = 10
const CONNECT_TIMEOUT_MS = 10_000 // 连接建立超时：10s 内未 onopen 则 close 触发重连

/**
 * WebSocket 实时同步 hook —— 挂载后建立 `/api/ws` 长连接，接收服务端 `invalidate`
 * 广播并按 resource 名映射到对应 query key 触发 refetch。
 *
 * - 不引第三方 WS 库（原生 WebSocket，符合 KISS / Ponytail 原则）
 * - ticket 复用 `api()`（自动带 Bearer + 401→onUnauthorized 踢登录）
 * - `onopen` 全量 invalidate（离线补齐：拉回断线期间另一端变更）
 * - `onclose` 指数退避 + ±30% 抖动重连（base 1s / max 30s / 上限 10 次）
 * - 连接建立超时 10s：`new WebSocket` 后挂 timer，到点仍 CONNECTING 则 close 走重连（原生 WS 无握手超时）
 * - cleanup 关连接 + 清 timers + 阻重连（卸载/登出硬导航触发）
 *
 * 挂在 `_authed.tsx` 的 `AuthedLayout`：`beforeLoad` 保 token 存在；登出硬导航
 * `/login` → AuthedLayout 卸载 → useEffect cleanup → `ws.close(1000)`。
 */
export function useWebSocketSync(qc: QueryClient) {
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)
  // 连接建立超时 timer：原生 WebSocket 不支持握手超时，靠这个兜底
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 首次连接标记：mount 时 refetchOnMount 刚拉过最新数据，首次 onopen 不再 invalidate
  // （否则与 mount refetch 撞车，bookmarks 全量请求发两遍）。仅重连时全量补齐。
  const isFirstConnect = useRef(true)

  useEffect(() => {
    const token = useAuthStore.getState().token
    if (!token) return // 防御：beforeLoad 已保 token，store 异步时仍兜底

    closedRef.current = false

    const connect = () => {
      api<{ ticket: string }>('/ws/ticket')
        .then(({ ticket }) => {
          if (closedRef.current) return // cleanup 已触发，丢弃迟到响应
          const proto = location.protocol === 'https:' ? 'wss' : 'ws'
          const url = `${proto}://${location.host}/api/ws?ticket=${encodeURIComponent(ticket)}`
          const ws = new WebSocket(url)
          wsRef.current = ws

          // 连接建立超时：原生 WebSocket 不支持握手超时，10s 仍 CONNECTING 则 close，
          // 交由 onclose -> scheduleReconnect 走既有退避（避免卡在握手期不重连）
          connectTimerRef.current = setTimeout(() => {
            if (ws.readyState === WebSocket.CONNECTING) ws.close()
          }, CONNECT_TIMEOUT_MS)

          ws.onopen = () => {
            if (connectTimerRef.current) {
              clearTimeout(connectTimerRef.current)
              connectTimerRef.current = null
            }
            useUIStore.getState().setWsStatus('connected')
            retryRef.current = 0
            // 首次连接跳过：mount 时刚拉过最新数据，再 invalidate 会与 mount refetch 撞车
            // 重复请求。仅重连时全量 invalidate -- 补齐断线期间错过的另一端变更。
            if (isFirstConnect.current) {
              isFirstConnect.current = false
              return
            }
            ALL_SYNCED_RESOURCES.forEach((res) => {
              const key = RESOURCE_TO_QUERY_KEY[res]
              if (key) qc.invalidateQueries({ queryKey: key })
            })
          }

          ws.onmessage = (ev) => {
            let msg: WSInvalidateMessage
            try {
              msg = JSON.parse(ev.data as string)
            } catch {
              return // 非 JSON / 半包，忽略
            }
            if (msg?.type === 'invalidate' && Array.isArray(msg.resources)) {
              msg.resources.forEach((res) => {
                const key = RESOURCE_TO_QUERY_KEY[res]
                if (key) qc.invalidateQueries({ queryKey: key }) // 未知 resource 忽略
              })
            }
          }

          ws.onclose = () => {
            if (closedRef.current) return // 手动关闭，不重连
            scheduleReconnect()
          }

          ws.onerror = () => {
            // 统一走 onclose 重连逻辑（避免重复编排退避）
            ws.close()
          }
        })
        .catch(() => {
          // ticket 请求失败：401 已由 client.ts 跳登录；网络抖动等 → 重试
          if (closedRef.current) return
          scheduleReconnect()
        })
    }

    const scheduleReconnect = () => {
      if (retryRef.current >= MAX_RETRIES) {
        useUIStore.getState().setWsStatus('disconnected')
        return
      }
      useUIStore.getState().setWsStatus('reconnecting')
      const attempt = retryRef.current
      retryRef.current += 1
      const base = Math.min(1000 * 2 ** attempt, 30000)
      const delay = base * (0.7 + Math.random() * 0.6) // ±30% 抖动，防雷同同步重连
      timerRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      closedRef.current = true
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current)
        connectTimerRef.current = null
      }
      wsRef.current?.close(1000, 'cleanup')
      wsRef.current = null
    }
  }, [qc])
}
