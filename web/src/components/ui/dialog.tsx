import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 模态框 -- Tailwind 实现 .modal-overlay/.modal 视觉。
 * backdrop-filter + ::after 渐变线 + transition 留在 CSS（Tailwind 表达不了），
 * 其余全部走 Tailwind 工具类。
 *
 * createPortal 挂到 document.body，关闭先移 .active 播退场动画再卸载。
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth,
  headerExtra,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  maxWidth?: number
  headerExtra?: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [exiting, setExiting] = useState(false)
  const exitTimer = useRef<number | null>(null)

  const cleanupExitTimer = useCallback(() => {
    if (exitTimer.current != null) {
      window.clearTimeout(exitTimer.current)
      exitTimer.current = null
    }
  }, [])

  useEffect(() => {
    if (open) {
      setExiting(false)
      cleanupExitTimer()
      requestAnimationFrame(() => setMounted(true))
    } else {
      setMounted(false)
      setExiting(true)
      cleanupExitTimer()
      exitTimer.current = window.setTimeout(() => setExiting(false), 350)
      return cleanupExitTimer
    }
  }, [open, cleanupExitTimer])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 关闭时 open=false 但 mounted/exiting 仍为旧值（state 异步），需保留渲染让退场 transition 播完
  if (!open && !mounted && !exiting) return null

  const content = (
    <div
      className={cn('modal-overlay', mounted && 'modal-overlay-active')}
    >
      <div
        className={cn('modal modal-md', mounted && 'modal-active')}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <header className="modal-header divider-fade-bottom">
          <h2 className="modal-title">{title}</h2>
          {headerExtra}
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && (
          <footer className="modal-footer modal-footer-right">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
  return createPortal(content, document.body)
}
