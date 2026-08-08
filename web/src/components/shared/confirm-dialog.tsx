import { type ReactNode, useEffect } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/**
 * 二次确认对话框 —— 全局复用。
 * 支持主操作 + 副操作（如删除模态框的「仅清除图标」）。
 * 副操作用琥珀色（--secondary-action），主操作用 destructive 红色，区分危险等级。
 *
 * Enter/Space 确认主操作。
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = '确认删除',
  message,
  confirmText = '删除',
  cancelText = '取消',
  danger = true,
  secondaryAction,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** 可选副操作（如"仅清除图标"），点完也调 onClose */
  secondaryAction?: { label: string; onClick: () => void }
}) {
  // Enter / Space 确认主操作
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onConfirm()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onConfirm, onClose])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="soft" onClick={onClose}>
            {cancelText}
          </Button>
          {secondaryAction && (
            <button
              type="button"
              onClick={() => {
                secondaryAction.onClick()
                onClose()
              }}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 h-9 px-3 rounded-[10px] text-sm font-normal bg-[var(--secondary-action)] text-white hover:opacity-90 transition-opacity"
            >
              {secondaryAction.label}
            </button>
          )}
          <Button
            variant={danger ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm text-(--text-secondary) leading-relaxed whitespace-pre-line">
        {message}
      </p>
    </Dialog>
  )
}
