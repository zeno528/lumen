import { useEffect } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Bookmark as BookmarkIcon, Trash2 } from 'lucide-react'
import type { Category } from '@/types'
import type { CategoryDeleteMode } from '@/api/categories'

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
  childCount,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  category: Category | null
  count: number
  childCount: number
  onConfirm: (mode: CategoryDeleteMode) => void
}) {
  // Enter 确认保留书签
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm(childCount > 0 ? 'promote' : 'keep')
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
          {childCount > 0 ? (
            <>
              <Button onClick={() => onConfirm('promote')}>
                保留子分类
              </Button>
              <Button variant="soft" onClick={() => onConfirm('keep')}>
                <BookmarkIcon size={14} /> 删除全部分类，保留书签
              </Button>
              <Button variant="destructive" onClick={() => onConfirm('all')}>
                <Trash2 size={14} /> 全部删除
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => onConfirm('keep')}>
                <BookmarkIcon size={14} /> 保留书签
              </Button>
              <Button variant="destructive" onClick={() => onConfirm('all')}>
                <Trash2 size={14} /> 一并删除
              </Button>
            </>
          )}
        </>
      }
    >
      <p className="text-sm text-(--text-secondary) mb-3 leading-relaxed">
        确定要删除分类 "
        <span className="text-(--text-primary) font-medium">{category.name}</span>" 吗？
      </p>
      <p className="text-xs text-(--text-muted)">
        该分类{childCount > 0 ? `及 ${childCount} 个子分类下共` : '下有'}{' '}
        <span className="text-(--accent) font-semibold">{count}</span> 个书签
      </p>
    </Dialog>
  )
}
