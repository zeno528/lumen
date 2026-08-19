import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDragDropMonitor, useDroppable } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { ChevronRight } from 'lucide-react'
import { useLongPress } from '@/hooks/use-long-press'
import { getCategoryDropAction, makeCategoryZoneId, makeDragId, type CategoryDragData, type CategoryDropAction, type CategoryZoneDragData } from '@/lib/category-dnd'
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
  canNestDrop = false,
  onNestDragOver,
  onTargetDragLeave,
  isNew = false,
  style,
  variant = 'default',
  iconColor,
  selected = false,
  onSelect,
  childCount = 0,
  expanded = false,
  onExpand,
    index = 0,
  group = 'sidebar-categories',
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active: boolean
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onContext?: (e: React.MouseEvent) => void
  category?: Category
  canNestDrop?: boolean
  onNestDragOver?: (target: Category, rect: DOMRect) => void
  onTargetDragLeave?: (target: Category) => void
  isNew?: boolean
  style?: React.CSSProperties
  variant?: 'default' | 'pill'
  iconColor?: string
  selected?: boolean
  onSelect?: (e: React.MouseEvent, id: number) => void
  childCount?: number
  expanded?: boolean
  onExpand?: (e: React.MouseEvent) => void
    index?: number
  group?: string
}) {
  const isReal = !!category
  const sortableId = isReal ? makeDragId('category', category.id) : `virtual-category:${label}`
  const categoryZoneId = isReal ? makeCategoryZoneId(category?.id ?? 0) : `virtual-category-zone:${label}`
  const sortable = useSortable<CategoryDragData>({
    id: sortableId,
    index,
    group,
    type: 'category',
    accept: (source) => source.id !== sortableId && source.type === 'category',
    disabled: !isReal,
    data: {
      kind: 'category',
      id: category?.id ?? 0,
      name: category?.name ?? label,
      color: category?.color,
      icon: category?.icon,
      parentId: category?.parent_id ?? null,
      canNest: isReal && canNestDrop,
    },
  })
  const categoryZone = useDroppable<CategoryZoneDragData>({
    id: categoryZoneId,
    type: 'category-zone',
    accept: 'bookmark',
    disabled: !isReal,
    data: isReal
      ? { kind: 'category-zone', id: category.id, name: category.name }
      : undefined,
  })
  const [dragOver, setDragOver] = useState<
    { kind: 'cat'; action: CategoryDropAction } | { kind: 'bookmark' } | null
  >(null)
  const wasTarget = useRef(false)
  const [showPopIn, setShowPopIn] = useState(isNew)

  useEffect(() => {
    if (isNew) setShowPopIn(true)
  }, [isNew])

  useDragDropMonitor({
    onDragMove: ({ operation }) => {
      const sourceData = operation.source?.data as { kind?: string } | undefined
      const targetId = sourceData?.kind === 'bookmark' ? categoryZoneId : sortableId
      const isTarget = isReal && operation.target?.id === targetId && operation.source?.id !== sortableId
      if (!isTarget || !category || (sourceData?.kind !== 'bookmark' && sourceData?.kind !== 'category')) {
        if (wasTarget.current) {
          wasTarget.current = false
          onTargetDragLeave?.(category!)
        }
        setDragOver((current) => current == null ? current : null)
        return
      }

      wasTarget.current = true
      const rect = operation.target?.element?.getBoundingClientRect()
      if (!rect) return
      if (sourceData.kind === 'bookmark') {
        setDragOver((current) => current?.kind === 'bookmark' ? current : { kind: 'bookmark' })
        onNestDragOver?.(category, rect)
        return
      }

      const action = getCategoryDropAction(
        operation.position.current.y - rect.top,
        rect.height,
        canNestDrop,
      )
      setDragOver((current) =>
        current?.kind === 'cat' && sameDropAction(current.action, action)
          ? current
          : { kind: 'cat', action },
      )
      if (action.kind === 'make-child') onNestDragOver?.(category, rect)
    },
    onDragEnd: () => {
      wasTarget.current = false
      setDragOver(null)
    },
  })

  const isDragging = isReal && sortable.isDragging
  const longPress = useLongPress(
    (x, y) => {
      if (!onContext) return
      onContext({ clientX: x, clientY: y, preventDefault: () => {} } as React.MouseEvent)
    },
    { delay: 350, triggerOnRelease: true },
  )

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
        active && 'active',
        isDragging && 'cat-dragging',
        dragOver?.kind === 'cat' && dragOver.action.kind === 'reorder' && dragOver.action.position === 'before' && 'cat-drag-over-before',
        dragOver?.kind === 'cat' && dragOver.action.kind === 'reorder' && dragOver.action.position === 'after' && 'cat-drag-over-after',
        dragOver?.kind === 'cat' && dragOver.action.kind === 'make-child' && 'cat-drag-over-inside',
        dragOver?.kind === 'bookmark' && 'cat-drag-over-bookmark',
        showPopIn && 'pop-in',
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
}

function sameDropAction(a: CategoryDropAction, b: CategoryDropAction) {
  return a.kind === b.kind && (a.kind !== 'reorder' || b.kind !== 'reorder' || a.position === b.position)
}
