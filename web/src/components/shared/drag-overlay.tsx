import { useState } from 'react'
import { DragOverlay } from '@dnd-kit/react'
import { resolveCategoryIcon } from '@/lib/icon-map'
import type { LumenDragData } from '@/lib/category-dnd'

export function AppDragOverlay() {
  return (
    <DragOverlay className="app-drag-overlay" dropAnimation={null}>
      {(source) => {
        const data = source.data as LumenDragData
        if (data.kind === 'bookmark') {
          return <BookmarkDragPreview data={data} />
        }
        if (data.kind === 'category') return <CategoryDragPreview data={data} />
        return null
      }}
    </DragOverlay>
  )
}

function BookmarkDragPreview({ data }: {
  data: Extract<LumenDragData, { kind: 'bookmark' }>
}) {
  const [faviconError, setFaviconError] = useState(false)
  const src = data.favicon

  return (
    <div className="bookmark-drag-preview app-drag-overlay-preview" aria-hidden="true">
      <div className="bookmark-icon-bg bookmark-drag-preview-icon-bg">
        {!faviconError ? (
          <img
            className="bookmark-drag-preview-icon"
            src={src}
            alt=""
            onError={() => setFaviconError(true)}
          />
        ) : (
          <span className="bookmark-drag-preview-icon bookmark-drag-preview-fallback">◎</span>
        )}
      </div>
      <div className="bookmark-drag-preview-content">
        <span className="bookmark-drag-preview-title">{data.title}</span>
        <div className="bookmark-drag-preview-category-row">
          <span className="bookmark-tag category-tag bookmark-drag-preview-category">{data.categoryName}</span>
        </div>
      </div>
    </div>
  )
}

function CategoryDragPreview({ data }: { data: Extract<LumenDragData, { kind: 'category' }> }) {
  const Icon = resolveCategoryIcon(data.icon)
  return (
    <div className="category-drag-preview app-drag-overlay-preview" aria-hidden="true">
      <Icon size={16} style={{ color: data.color || 'var(--default-category-color)' }} />
      <span>{data.name}</span>
    </div>
  )
}
