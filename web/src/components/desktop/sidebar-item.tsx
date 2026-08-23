import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { useDroppable } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { useLongPress } from '@/hooks/use-long-press'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

export function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  onContext,
  category,
  isNew = false,
  style,
  variant = 'default',
  iconColor,
  selected = false,
  onSelect,
  depth = 0,
  dragEnabled = false,
  hasChildren = false,
  expanded = false,
  index = 0,
  group = 'categories:root',
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onContext?: (e: React.MouseEvent) => void
  category?: Category
  isNew?: boolean
  style?: React.CSSProperties
  variant?: 'default' | 'pill'
  iconColor?: string
  selected?: boolean
  onSelect?: (e: React.MouseEvent, id: number) => void
  depth?: number
  /** 分类拖拽开关；批量选择时关闭。 */
  dragEnabled?: boolean
  hasChildren?: boolean
  expanded?: boolean
  index?: number
  group?: string
}) {
  const [showPopIn, setShowPopIn] = useState(isNew)

  useEffect(() => {
    if (isNew) setShowPopIn(true)
  }, [isNew])

  const longPress = useLongPress(
    (x, y) => {
      if (!onContext) return
      onContext({ clientX: x, clientY: y, preventDefault: () => {} } as React.MouseEvent)
    },
    { delay: 350, triggerOnRelease: true },
  )
  const sortable = useSortable({
    id: category ? `category:${category.id}` : `virtual-category:${label}`,
    index,
    group,
    type: 'category',
    accept: (source) => {
      if (!category || source.data.kind !== 'category' || source.data.id === category.id) return false
      return category.parent_id == null || source.data.hasChildren !== true
    },
    disabled: !category || !dragEnabled,
    transition: { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    data: {
      kind: 'category',
      id: category?.id ?? 0,
      parentId: category?.parent_id ?? null,
      hasChildren,
    },
  })
  const categoryZone = useDroppable({
    id: category ? `category-zone:${category.id}` : `virtual-category-zone:${label}`,
    type: 'category-zone',
    accept: 'bookmark',
    disabled: !category || !dragEnabled,
    data: category
      ? { kind: 'category-zone', id: category.id, parentId: category.parent_id }
      : undefined,
  })
  const setRefs = (element: HTMLDivElement | null) => {
    sortable.ref(element)
    categoryZone.ref(element)
  }

  return (
    <div
      ref={setRefs}
      style={style}
      className={cn(
        'sidebar-item',
        depth > 0 && 'sidebar-item-child',
        active && 'active',
        showPopIn && 'pop-in',
        selected && 'selected',
        sortable.isDropTarget && 'dnd-drop-target',
        categoryZone.isDropTarget && 'bookmark-drop-target',
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
        if (showPopIn && e.animationName === 'popIn') setShowPopIn(false)
      }}
    >
      {category ? (
        <span
          className={cn('sidebar-item-expand', expanded && 'expanded')}
          aria-hidden="true"
        >
          {hasChildren ? <ChevronRight size={15} /> : null}
        </span>
      ) : null}
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
        {count !== undefined ? (
          <span className="sidebar-item-count">{count}</span>
        ) : null}
      </div>
    </div>
  )
}
