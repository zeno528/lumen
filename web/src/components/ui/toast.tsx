import { useEffect, useState, type ReactNode } from 'react'
import { Check, X, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error' | 'warning' | 'loading'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  msg: string
  type: ToastType
  /** 自定义图标（如 AI 厂商 logo），覆盖默认 type 图标 */
  icon?: ReactNode
  action?: ToastAction
  /** 退场动画中：挂 .hide → toastOut 0.4s → 真正移除 */
  hiding?: boolean
}

let toastIdCounter = 0
const listeners = new Set<(items: ToastItem[]) => void>()
let toastQueue: ToastItem[] = []
const TOAST_DURATION = 2650
const ACTION_TOAST_DURATION = 5000
/** loading toast 的 dismiss 回调表（用户主动取消时调，通常 abort fetch）。
 *  resolve 看到 id 已被 dismiss 时静默 —— 避免"用户 X 关掉 → fetch 完成又复活 toast"的体验 bug */
const onDismissMap = new Map<number, () => void>()
type ToastTimer = {
  timeout: ReturnType<typeof setTimeout> | null
  startedAt: number
  remaining: number
  paused: boolean
}
const toastTimers = new Map<number, ToastTimer>()
const hoveredToastIds = new Set<number>()

function notify() {
  for (const l of listeners) l(toastQueue)
}

/** 从队列移除（退场动画播完后调用） */
function removeItem(id: number) {
  clearAutoHide(id)
  hoveredToastIds.delete(id)
  toastQueue = toastQueue.filter((x) => x.id !== id)
  notify()
}

function clearAutoHide(id: number) {
  const timer = toastTimers.get(id)
  if (timer?.timeout != null) clearTimeout(timer.timeout)
  toastTimers.delete(id)
}

function scheduleAutoHide(id: number, duration: number) {
  clearAutoHide(id)
  const timer: ToastTimer = {
    timeout: null,
    startedAt: performance.now(),
    remaining: duration,
    paused: hoveredToastIds.has(id),
  }
  toastTimers.set(id, timer)
  if (timer.paused) return
  timer.timeout = setTimeout(() => {
    toastTimers.delete(id)
    startHiding(id)
  }, duration)
}

function pauseAutoHide(id: number) {
  hoveredToastIds.add(id)
  const timer = toastTimers.get(id)
  if (!timer || timer.paused) return
  if (timer.timeout != null) clearTimeout(timer.timeout)
  timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.startedAt))
  timer.paused = true
}

function resumeAutoHide(id: number) {
  hoveredToastIds.delete(id)
  const timer = toastTimers.get(id)
  if (!timer || !timer.paused) return
  if (timer.remaining <= 0) {
    toastTimers.delete(id)
    startHiding(id)
    return
  }
  timer.paused = false
  timer.startedAt = performance.now()
  timer.timeout = setTimeout(() => {
    toastTimers.delete(id)
    startHiding(id)
  }, timer.remaining)
}

export const toast = {
  success(msg: string, icon?: ReactNode, action?: ToastAction) {
    push({ id: ++toastIdCounter, msg, type: 'success', icon, action })
  },
  error(msg: string) {
    push({ id: ++toastIdCounter, msg, type: 'error' })
  },
  warning(msg: string) {
    push({ id: ++toastIdCounter, msg, type: 'warning' })
  },
  /** 创建 loading toast（不自动消失），返回 id 供 resolve 使用
   *  icon 可传自定义节点（如 AI 厂商 logo），不传则用默认旋转 Loader2
   *  opts.onDismiss：X 按钮点击 / 用户主动取消时调（通常 abort 异步任务）*/
  loading(msg: string, icon?: ReactNode, opts?: { onDismiss?: () => void }): number {
    const id = ++toastIdCounter
    if (opts?.onDismiss) onDismissMap.set(id, opts.onDismiss)
    push({ id, msg, type: 'loading', icon }, /* autoHide */ false)
    return id
  },
  /** 主动关闭 loading toast：触发 onDismiss 回调（abort）+ 立即从队列移除。
   *  比 startHiding 多一步：跳过 450ms 退场动画，立即清掉，避免 fetch 完成时 resolve 复活。
   *  注意：不删除 onDismissMap —— 让后续 resolve 还能通过 onDismissMap.has(id)
   *  识别"曾今是 loading 已被用户主动 dismiss"，走静默分支而不是复活 fallback。
   *  非 loading toast 不应调用（success/error/warning 用 X 按钮的 startHiding 走退场动画即可）。*/
  dismiss(id: number) {
    onDismissMap.get(id)?.()
    clearAutoHide(id)
    hoveredToastIds.delete(id)
    toastQueue = toastQueue.filter((x) => x.id !== id)
    notify()
  },
  /** 把 loading toast 切换成最终状态（success/error/warning），然后自动消失。
   *  三态判断：
   *  1. exists（还在 queue） → 转 final state 后自动消失（正常完成 / ESC 中断）
   *  2. !exists && onDismissMap.has → 曾今是 loading 已被用户 dismiss → 静默（X 取消）
   *  3. !exists && !onDismissMap.has → 完全没存在过（resolve 误传 id）→ fallback 新建（兼容旧行为）*/
  resolve(id: number, msg: string, type: 'success' | 'error' | 'warning', action?: ToastAction) {
    const exists = toastQueue.some((x) => x.id === id)
    if (exists) {
      onDismissMap.delete(id) // 正常完成的 loading 不再需要 dismiss 回调
      toastQueue = toastQueue.map((x) =>
        x.id === id ? { ...x, msg, type, icon: undefined, action } : x,
      )
      notify()
      scheduleAutoHide(id, action ? ACTION_TOAST_DURATION : TOAST_DURATION)
    } else if (!onDismissMap.has(id)) {
      push({ id: ++toastIdCounter, msg, type })
    }
    // else: 曾今是 loading 已被用户 dismiss，静默不复活
  },
}

function push(t: ToastItem, autoHide = true) {
  toastQueue = [...toastQueue, t]
  notify()
  // 带操作入口的提示保留 5s，普通提示保持 2.65s
  // loading 类型不自动消失，等 resolve 调用
  if (autoHide) scheduleAutoHide(t.id, t.action ? ACTION_TOAST_DURATION : TOAST_DURATION)
}

/**
 * 触发退场动画：标记 hiding → 渲染加 .hide class → CSS toastOut 0.4s → 移除
 */
function startHiding(id: number) {
  clearAutoHide(id)
  hoveredToastIds.delete(id)
  if (!toastQueue.some((x) => x.id === id && !x.hiding)) return
  toastQueue = toastQueue.map((x) =>
    x.id === id && !x.hiding ? { ...x, hiding: true } : x,
  )
  notify()
  // 0.4s 退场动画 + 50ms 缓冲
  setTimeout(() => removeItem(id), 450)
}

const Icon = ({ type, icon }: { type: ToastType; icon?: ReactNode }) => {
  if (icon) return <span className="toast-icon">{icon}</span>
  if (type === 'loading')
    return <Loader2 size={16} className="toast-icon animate-spin" />
  if (type === 'success')
    return (
      <span className="toast-icon inline-flex items-center justify-center w-4 h-4 rounded-full bg-current shrink-0">
        <Check size={11} className="text-black" strokeWidth={3} />
      </span>
    )
  if (type === 'error')
    return (
      <span className="toast-icon inline-flex items-center justify-center w-4 h-4 rounded-full bg-current shrink-0">
        <X size={11} className="text-black" strokeWidth={3} />
      </span>
    )
  return <AlertTriangle size={16} className="toast-icon" />
}

/**
 * Toast 容器。
 * 全局单例（模块级 module 单例 + Set<listener> 订阅模式，有意不用 Zustand：
 * toast 场景只需 ToastContainer 一个订阅者，模块单例更轻量、避免无谓 re-render；
 * 如果未来 toast 需要配合持久化/SSR，再考虑迁移到 Zustand）。
 * 调用 toast.success/error/warning/loading(msg) 即可。堆叠多个。
 * 入场 toastIn 0.35s、退场 toastOut 0.4s（先挂 .hide 再移除 DOM）。
 * loading toast 不自动消失，调 toast.resolve(id, msg, type) 切换为最终状态。
 */
export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>(toastQueue)

  const activateAction = (item: ToastItem) => {
    item.action?.onClick()
    startHiding(item.id)
  }

  useEffect(() => {
    listeners.add(setItems)
    return () => {
      listeners.delete(setItems)
    }
  }, [])

  return (
    <div className="toast-container">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn('toast', t.type, t.action && 'has-action', t.hiding && 'hide')}
          onClick={t.action ? () => activateAction(t) : undefined}
          onMouseEnter={() => pauseAutoHide(t.id)}
          onMouseLeave={() => resumeAutoHide(t.id)}
        >
          <Icon type={t.type} icon={t.icon} />
          <span>{t.msg}</span>
          {t.action && <span className="toast-action">{t.action.label}</span>}
          <button
            type="button"
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation()
              // loading toast（注册过 onDismiss）走 dismiss：立即移除 + 触发 abort，
              //   避免 fetch 完成时 resolve 复活 toast 造成"X 没用"错觉
              // 其他 toast 走 startHiding：保留 0.4s 退场动画的统一体验
              if (onDismissMap.has(t.id)) toast.dismiss(t.id)
              else startHiding(t.id)
            }}
            aria-label="关闭"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
