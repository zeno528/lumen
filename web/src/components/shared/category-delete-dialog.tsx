import { useEffect } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Bookmark as BookmarkIcon, Trash2 } from 'lucide-react'
import type { Category } from '@/types'

/**
 * 删除分类确认对话框。
 *
 * 实现走新架构：Dialog + Button 统一组件。
 *
 * Enter 确认「保留书签」。
 */
export function CategoryDeleteDialog({
  open,
  onClose,
  category,
  count,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  category: Category | null
  count: number
  onConfirm: (keepBookmarks: boolean) => void
}) {
  // Enter 确认保留书签
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm(true)
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onConfirm, onClose])
  if (!category) return null
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="确认删除分类"
      footer={
        <>
          <Button variant="soft" onClick={onClose}>取消</Button>
          <Button onClick={() => onConfirm(true)}>
            <BookmarkIcon size={14} /> 保留书签
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(false)}>
            <Trash2 size={14} /> 一并删除
          </Button>
        </>
      }
    >
      <p className="text-sm text-(--text-secondary) mb-3 leading-relaxed">
        确定要删除分类 "
        <span className="text-(--text-primary) font-medium">{category.name}</span>" 吗？
      </p>
      <p className="text-xs text-(--text-muted)">
        该分类下有{' '}
        <span className="text-(--accent) font-semibold">{count}</span> 个书签
      </p>
    </Dialog>
  )
}
