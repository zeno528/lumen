import { useState, useEffect, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLongPress } from '@/hooks/use-long-press'
import { DRAG_TYPE_BOOKMARK, DRAG_TYPE_CATEGORY, getCategoryDropAction, hasDragType, setDragId, type CategoryDropAction } from '@/lib/category-dnd'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

/**
 * 拖拽 MIME 类型。
 * 与 bookmark-card.tsx 的 DRAG_TYPE_BOOKMARK 保持一致（书签拖到分类靠它识别）。
 */
/**
 * 侧边栏分类项。
 *
 * 拖拽：
 * - 仅真实分类（传 category）可拖可放；虚拟分类（all/favorites/uncategorized）不传 → 不可拖不可放
 * - 整张分类卡片都是 drag handle
 * - dragover/dragenter 按 dataTransfer.types 派发高亮：分类排序 cat-drag-over-before/after(按中线切顶/底线)、cat-drag-over-inside(归入父级)、书签拖入 cat-drag-over-bookmark
 * - 拖到自己不高亮（draggedCatId === category.id）
 *
 * 架构升级点：
 * - 视觉用 React state（dragOver）驱动 className，不再手动 classList
 * - draggedCatId 由父组件 Sidebar 持有并传入（跨项判断"是否拖到自己"）
 * - SidebarItem 是外部稳定组件，本地 setState 只重渲染自己，DOM 节点不卸载，HTML5 DnD 不中断
 *
 * ⚠️ dragenter/dragover 阶段只能读 dataTransfer.types 不能读 data（浏览器安全限制），
 * 所以用 types 判断来源类型决定高亮 class；真正取数据在 drop 里。
 */
export function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  onContext,
  category,
  draggedCatId,
  onDragStart,
  onDrag,
  onDragEnd,
  canNestDrop = false,
  onNestDragOver,
  onTargetDragLeave,
  onBookmarkDragTargetChange,
  onDrop,
  isNew = false,
  style,
  variant = 'default',
  iconColor,
  selected = false,
  onSelect,
  childCount = 0,
  expanded = false,
  onExpand,
  dragResult = false,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onContext?: (e: React.MouseEvent) => void
  /** 真实分类对象；虚拟分类不传 → 不可拖不可放 */
  category?: Category
  /** 当前被拖的分类 id（父组件持有，用于排除自身高亮）*/
  draggedCatId?: number | null
  onDragStart?: (event: React.DragEvent, category: Category) => void
  onDrag?: (event: React.DragEvent) => void
  onDragEnd?: () => void
  /** 当前被拖分类没有子分类时，中部落点才允许归入目标父分类。 */
  canNestDrop?: boolean
  onNestDragOver?: (event: React.DragEvent, target: Category) => void
  onTargetDragLeave?: (target: Category) => void
  onBookmarkDragTargetChange?: (target: Category | null) => void
  /** 分类拖到边缘时排序，拖到中部时归入目标父分类。 */
  onDrop?: (e: React.DragEvent, targetCat: Category, action: CategoryDropAction) => void
  /** 新建分类：挂 pop-in*/
  isNew?: boolean
  /** 透传 style（用于入场动画 animationDelay 错开）*/
  style?: React.CSSProperties
  /** 容器配色：default（分类颜色浅底）、pill（设置页 tab 走批量模式 token）*/
  variant?: 'default' | 'pill'
  /** 分类图标颜色：同时用于生成图标的浅色容器 */
  iconColor?: string
  /** 批量模式选中高亮 */
  selected?: boolean
  /** 批量模式点击选择（传入则替代 onClick；只对真实分类用，虚拟分类不传）*/
  onSelect?: (e: React.MouseEvent, id: number) => void
  childCount?: number
  expanded?: boolean
  onExpand?: (e: React.MouseEvent) => void
  /** 拖拽完成后的落位标记：独立于 hover 的着重色描边 */
  dragResult?: boolean
}) {
  // dragOver：null=未悬停 / 'cat'=分类排序悬停(带 before|after 落点) / 'bookmark'=书签拖入悬停
  // cat.pos 决定顶部线(before)还是底部线(after)高亮，所见即所得，
  // 修复"高亮永远顶部但落点按中线判定"导致的放不准错位
  const [dragOver, setDragOver] = useState<
    { kind: 'cat'; action: CategoryDropAction } | { kind: 'bookmark' } | null
  >(null)
  // pop-in 动画结束后移除 class：
  // .pop-in 有 pointer-events: none，若 class 挂 1.5s（父 isNew state），1.5s 内不可点。
  // 用内部 state 在 popIn animationend 后移除，恢复 pointer-events。
  const [showPopIn, setShowPopIn] = useState(isNew)
  useEffect(() => {
    if (isNew) setShowPopIn(true)
  }, [isNew])
  const isReal = !!category
  const isDragging = isReal && draggedCatId === category!.id

  // 触摸设备长按 350ms 后松手触发右键菜单；移动则交给原生拖拽。
  const longPress = useLongPress(
    (x, y) => {
      if (!onContext) return
      onContext({ clientX: x, clientY: y, preventDefault: () => {} } as React.MouseEvent)
    },
    { delay: 350, triggerOnRelease: true },
  )

  // 分类图标 dragstart
  // 额外写一份 text/plain fallback：部分浏览器/环境下自定义 MIME 类型在 drop 时读不到，
  // 导致 fromId 为空、排序请求发不出去。
  const handleDragStart = (e: React.DragEvent) => {
    if (!isReal) return
    onDragStart?.(e, category!)
    setDragId(e.dataTransfer, DRAG_TYPE_CATEGORY, category!.id)
  }
  const handleDragEnd = () => {
    setDragOver(null)
    onDragEnd?.()
  }

  // 真实分类作为 drop 目标
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!isReal || category!.id === draggedCatId) return
    // 书签拖入也应在有子分类的父分类上悬停展开子分类卡片。
    if (hasDragType(Array.from(e.dataTransfer.types), DRAG_TYPE_BOOKMARK)) {
      onBookmarkDragTargetChange?.(category!)
      onNestDragOver?.(e, category!)
      return
    }
    // 分类排序：按鼠标在 target 内纵向中线实时切 before/after 高亮
    // 只在 pos 变化时 setState，避免 dragover 每像素移动触发重渲染
    const action = getDropAction(e)
    if (action.kind === 'make-child') onNestDragOver?.(e, category!)
    setDragOver((cur) =>
      cur?.kind === 'cat' && sameDropAction(cur.action, action) ? cur : { kind: 'cat', action },
    )
  }
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isReal) return
    // 拖到自己不高亮
    if (category!.id === draggedCatId) return
    // 按 types 派发高亮：书签拖入用绿色，分类排序用 accent
    const isBookmark = hasDragType(Array.from(e.dataTransfer.types), DRAG_TYPE_BOOKMARK)
    if (isBookmark) {
      // 等值守卫：dragenter 频繁进入时不反复重建同一状态对象，避免无意义重渲染
      setDragOver((cur) => (cur?.kind === 'bookmark' ? cur : { kind: 'bookmark' }))
      onBookmarkDragTargetChange?.(category!)
      onNestDragOver?.(e, category!)
      return
    }
    const action = getDropAction(e)
    if (action.kind === 'make-child') onNestDragOver?.(e, category!)
    setDragOver({ kind: 'cat', action })
  }
  const handleDragLeave = (e: React.DragEvent) => {
    // 拖拽中 dragleave 的 relatedTarget 经常为 null（Chrome 的 drag 事件怪癖），
    // 若当成"离开"会取消子分类浮层的打开 timer → 浮层弹不出/高频闪烁。
    // null 时只清插入线高亮，浮层关闭交给「确实离开到别的元素」或拖拽结束兜底。
    if (e.relatedTarget == null) {
      setDragOver(null)
      return
    }
    // 只在真正离开时移除，忽略子元素冒泡
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(null)
      onTargetDragLeave?.(category!)
    }
  }
  const handleDrop = (e: React.DragEvent) => {
    if (!isReal) return
    e.preventDefault()
    // 分类排序：按鼠标在 target 项内的中线决定 before/after，与 dragover 高亮同一逻辑，
    // 保证"看到的顶部线/底部线"就是实际落点（所见即所得）。书签拖入固定 after。
    const isBookmark = hasDragType(Array.from(e.dataTransfer.types), DRAG_TYPE_BOOKMARK)
    const action: CategoryDropAction = isBookmark ? { kind: 'reorder', position: 'after' } : getDropAction(e)
    setDragOver(null)
    onDrop?.(e, category!, action)
  }

  return (
    <div
      style={style}
      className={cn(
        'sidebar-item',
        active && 'active',
        isDragging && 'cat-dragging',
        dragOver?.kind === 'cat' && dragOver.action.kind === 'reorder' && dragOver.action.position === 'before' && 'cat-drag-over-before',
        dragOver?.kind === 'cat' && dragOver.action.kind === 'reorder' && dragOver.action.position === 'after' && 'cat-drag-over-after',
        dragOver?.kind === 'cat' && dragOver.action.kind === 'make-child' && 'cat-drag-over-inside',
        dragOver?.kind === 'bookmark' && 'cat-drag-over-bookmark',
        // 进出场动画
        // pop-in 在 animationend 后移除（showPopIn），避免 pointer-events: none 锁 1.5s
        showPopIn && 'pop-in',
        selected && 'selected',
        dragResult && 'drag-result',
      )}
      onClick={onSelect ? (e) => onSelect(e, category!.id) : onClick}
      onContextMenu={
        onContext
          ? (e) => {
              e.preventDefault()
              onContext(e)
            }
          : undefined
      }
      {...longPress}
      draggable={isReal}
      onDragStart={isReal ? handleDragStart : undefined}
      onDrag={isReal ? onDrag : undefined}
      onDragEnd={isReal ? handleDragEnd : undefined}
      onAnimationEnd={(e) => {
        // pop-in 结束：移除 class 恢复 pointer-events（.pop-in 有 pointer-events: none）
        if (showPopIn && e.animationName === 'popIn') {
          setShowPopIn(false)
        }
      }}
      onDragOver={isReal ? handleDragOver : undefined}
      onDragEnter={isReal ? handleDragEnter : undefined}
      onDragLeave={isReal ? handleDragLeave : undefined}
      onDrop={isReal ? handleDrop : undefined}
    >
      <div
        className={cn(
          'sidebar-icon',
          variant === 'default' && 'sidebar-icon-category',
          variant === 'pill' && 'sidebar-icon-pill',
          iconColor && 'sidebar-icon-coloured',
        )}
        style={
          variant === 'pill'
            ? { background: 'var(--top-pill-bg)' }
            : iconColor
              ? ({ '--sidebar-icon-color': iconColor } as CSSProperties)
              : undefined
        }
      >
        {icon}
      </div>
      <div className="sidebar-item-inner">
        <span className="sidebar-item-name">{label}</span>
        {childCount > 0 ? (
          <button
            type="button"
            className={cn('sidebar-item-expand', expanded && 'expanded')}
            aria-label={`${label}子分类`}
            aria-expanded={expanded}
            onClick={onExpand}
          >
            <ChevronRight size={15} />
          </button>
        ) : count !== undefined ? (
          <span className="sidebar-item-count">{count}</span>
        ) : null}
      </div>
    </div>
  )

  function getDropAction(e: React.DragEvent): CategoryDropAction {
    const rect = e.currentTarget.getBoundingClientRect()
    return getCategoryDropAction(e.clientY - rect.top, rect.height, canNestDrop)
  }

  function sameDropAction(a: CategoryDropAction, b: CategoryDropAction) {
    return a.kind === b.kind && (a.kind !== 'reorder' || b.kind !== 'reorder' || a.position === b.position)
  }
}
