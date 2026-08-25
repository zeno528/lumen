import { useEffect, useState, type CSSProperties } from 'react'
import { useDroppable } from '@dnd-kit/react'
import { useSortable, type UseSortableInput } from '@dnd-kit/react/sortable'
import { useLongPress } from '@/hooks/use-long-press'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

type CollisionDetector = NonNullable<UseSortableInput['collisionDetector']>

const detectAdjacentCategoryCollision: CollisionDetector = ({ dragOperation, droppable }) => {
  const source = dragOperation.source as { index?: unknown; group?: unknown } | null
  const target = droppable as { index?: unknown; group?: unknown }
  const rectangle = droppable.shape?.boundingRectangle
  const pointer = dragOperation.position.current

  if (
    source?.group !== 'categories' ||
    target.group !== 'categories' ||
    typeof source.index !== 'number' ||
    typeof target.index !== 'number' ||
    !rectangle ||
    pointer.x < rectangle.left - 8 ||
    pointer.x > rectangle.right + 8
  ) {
    return null
  }

  const midpoint = rectangle.top + rectangle.height / 2
  const direction = pointer.y > midpoint ? 1 : pointer.y < midpoint ? -1 : 0

  return direction !== 0 && target.index === source.index + direction
    ? { id: droppable.id, priority: 1, type: 2, value: 1 }
    : null
}

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
  dragEnabled = false,
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
  /** 顶级分类排序开关；批量选择时关闭。 */
  dragEnabled?: boolean
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
    accept: (source) => Boolean(category && source.data.kind === 'category' && source.data.id !== category.id),
    disabled: !category || !dragEnabled,
    transition: { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    collisionDetector: group === 'categories' ? detectAdjacentCategoryCollision : undefined,
    data: category ? { kind: 'category', id: category.id } : undefined,
  })
  const categoryZone = useDroppable({
    id: category ? `category-zone:${category.id}` : `virtual-category-zone:${label}`,
    type: 'category-zone',
    accept: 'bookmark',
    disabled: !category || !dragEnabled,
    data: category ? { kind: 'category-zone', id: category.id } : undefined,
  })

  return (
    <div
      ref={(element) => {
        sortable.ref(element)
        categoryZone.ref(element)
      }}
      data-category-id={category?.id}
      style={style}
      className={cn(
        'sidebar-item',
        active && 'active',
        showPopIn && 'pop-in',
        selected && 'selected',
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
        {count !== undefined ? <span className="sidebar-item-count">{count}</span> : null}
      </div>
    </div>
  )
}
