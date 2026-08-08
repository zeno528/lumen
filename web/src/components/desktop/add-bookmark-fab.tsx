import { Plus } from 'lucide-react'
import { useUIStore } from '@/stores/ui'

/**
 * 桌面端悬浮添加书签按钮。
 *
 * 右下角圆 58×58 fab-btn（accent 色），hover scale 1.1，active scale 0.95。
 * 移动端用 mobile-fab-menu 不渲染本组件（mobile-shell.tsx 的 .mobile-fab-menu）。
 */
export function AddBookmarkFab() {
  const openCreateBookmark = useUIStore((s) => s.openCreateBookmark)
  return (
    <button
      className="fab-btn"
      onClick={openCreateBookmark}
      title="添加书签"
      aria-label="添加书签"
    >
      <Plus size={22} />
      {/* 隐藏的 label 用于屏幕阅读器（visible label 由视觉 SVG 表征）*/}
      <span className="fab-btn-label">添加书签</span>
    </button>
  )
}
