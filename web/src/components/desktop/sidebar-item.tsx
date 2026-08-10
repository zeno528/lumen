import { useState, useEffect, type CSSProperties } from 'react'
import { useLongPress } from '@/hooks/use-long-press'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

/**
 * 拖拽 MIME 类型。
 * 与 bookmark-card.tsx 的 DRAG_TYPE_BOOKMARK 保持一致（书签拖到分类靠它识别）。
 */
const DRAG_TYPE_BOOKMARK = 'application/x-bookmark-id'
const DRAG_TYPE_CATEGORY = 'application/x-category-id'

/**
 * 侧边栏分类项。
 *
 * 拖拽：
 * - 仅真实分类（传 category）可拖可放；虚拟分类（all/favorites/uncategorized）不传 → 不可拖不可放
 * - 分类图标作为 drag handle
 * - dragover/dragenter 按 dataTransfer.types 派发高亮：分类排序 cat-drag-over + before/after(按中线切顶/底线)，书签拖入 cat-drag-over-bookmark
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
  onDragEnd,
  onDrop,
  isNew = false,
  exiting = false,
  onExitDone,
  style,
  variant = 'default',
  iconColor,
  selected = false,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: () => void
  onContext?: (e: React.MouseEvent) => void
  /** 真实分类对象；虚拟分类不传 → 不可拖不可放 */
  category?: Category
  /** 当前被拖的分类 id（父组件持有，用于排除自身高亮）*/
  draggedCatId?: number | null
  onDragStart?: (catId: number) => void
  onDragEnd?: () => void
  /** drop 派发：第三个参数 position 由 drop 瞬间鼠标在 target 项内位置决定（中线为界），
   * 用于分类排序的"插到 target 前面 vs 后面"语义。书签拖入场景固定传 'after'（移动到分类）。*/
  onDrop?: (e: React.DragEvent, targetCat: Category, position: 'before' | 'after') => void
  /** 新建分类：挂 pop-in*/
  isNew?: boolean
  /** 正在退出（删除）：挂 pop-out，动画结束触发 onExitDone*/
  exiting?: boolean
  /** pop-out 动画结束回调（清 exiting 标记；真实分类 + 虚拟分类共用）*/
  onExitDone?: () => void
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
}) {
  // dragOver：null=未悬停 / 'cat'=分类排序悬停(带 before|after 落点) / 'bookmark'=书签拖入悬停
  // cat.pos 决定顶部线(before)还是底部线(after)高亮，所见即所得，
  // 修复"高亮永远顶部但落点按中线判定"导致的放不准错位
  const [dragOver, setDragOver] = useState<
    { kind: 'cat'; pos: 'before' | 'after' } | { kind: 'bookmark' } | null
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

  // 触摸设备长按触发右键菜单（500ms）
  const longPress = useLongPress(
    (x, y) => {
      if (!onContext) return
      onContext({ clientX: x, clientY: y, preventDefault: () => {} } as React.MouseEvent)
    },
    { delay: 500 },
  )

  // 分类图标 dragstart
  // 额外写一份 text/plain fallback：部分浏览器/环境下自定义 MIME 类型在 drop 时读不到，
  // 导致 fromId 为空、排序请求发不出去。
  const handleDragStart = (e: React.DragEvent) => {
    if (!isReal) return
    onDragStart?.(category!.id)
    e.dataTransfer.effectAllowed = 'move'
    const id = String(category!.id)
    e.dataTransfer.setData(DRAG_TYPE_CATEGORY, id)
    e.dataTransfer.setData('text/plain', id)
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
    // 书签拖入固定 after，enter 已设高亮，over 不更新
    if (e.dataTransfer.types.includes(DRAG_TYPE_BOOKMARK)) return
    // 分类排序：按鼠标在 target 内纵向中线实时切 before/after 高亮
    // 只在 pos 变化时 setState，避免 dragover 每像素移动触发重渲染
    const rect = e.currentTarget.getBoundingClientRect()
    const pos: 'before' | 'after' = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setDragOver((cur) => (cur?.kind === 'cat' && cur.pos === pos ? cur : { kind: 'cat', pos }))
  }
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (!isReal) return
    // 拖到自己不高亮
    if (category!.id === draggedCatId) return
    // 按 types 派发高亮：书签拖入用绿色，分类排序用 accent
    const isBookmark = e.dataTransfer.types.includes(DRAG_TYPE_BOOKMARK)
    if (isBookmark) {
      setDragOver({ kind: 'bookmark' })
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const pos: 'before' | 'after' = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    setDragOver({ kind: 'cat', pos })
  }
  const handleDragLeave = (e: React.DragEvent) => {
    // 只在真正离开时移除，忽略子元素冒泡
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(null)
    }
  }
  const handleDrop = (e: React.DragEvent) => {
    if (!isReal) return
    e.preventDefault()
    // 分类排序：按鼠标在 target 项内的中线决定 before/after，与 dragover 高亮同一逻辑，
    // 保证"看到的顶部线/底部线"就是实际落点（所见即所得）。书签拖入固定 after。
    const isBookmark = e.dataTransfer.types.includes(DRAG_TYPE_BOOKMARK)
    let position: 'before' | 'after' = 'after'
    if (!isBookmark) {
      const rect = e.currentTarget.getBoundingClientRect()
      position = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
    }
    setDragOver(null)
    onDrop?.(e, category!, position)
  }

  return (
    <div
      style={style}
      className={cn(
        'sidebar-item',
        active && 'active',
        isDragging && 'cat-dragging',
        dragOver?.kind === 'cat' && 'cat-drag-over',
        dragOver?.kind === 'cat' && dragOver.pos === 'before' && 'cat-drag-over-before',
        dragOver?.kind === 'cat' && dragOver.pos === 'after' && 'cat-drag-over-after',
        dragOver?.kind === 'bookmark' && 'cat-drag-over-bookmark',
        // 进出场动画
        // pop-in 在 animationend 后移除（showPopIn），避免 pointer-events: none 锁 1.5s
        showPopIn && 'pop-in',
        exiting && 'pop-out',
        selected && 'selected',
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
      onAnimationEnd={(e) => {
        // pop-in 结束：移除 class 恢复 pointer-events（.pop-in 有 pointer-events: none）
        if (showPopIn && e.animationName === 'popIn') {
          setShowPopIn(false)
        }
        // 只在 pop-out 动画结束时触发（真实分类 + 虚拟分类通用）
        if (exiting && e.animationName === 'popOut') {
          // pop-out 结束：清 animation 防 forwards 失效后 opacity 回 1 闪一下，
          // 同时锁 inline opacity:0 直到 React 卸载（onExitDone → unmark → 条件 false → 卸载）
          const el = e.currentTarget as HTMLElement
          el.style.animation = 'none'
          el.style.opacity = '0'
          onExitDone?.()
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
        draggable={isReal}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {icon}
      </div>
      <div className="sidebar-item-inner">
        <span className="sidebar-item-name">{label}</span>
        {count !== undefined && <span className="sidebar-item-count">{count}</span>}
      </div>
    </div>
  )
}
