import { create } from 'zustand'
import {
  getBookmarkDropPosition,
  type BookmarkDropTarget,
  type BookmarkOrderPosition,
} from '@/lib/bookmark-order'
import { getCategoryDropAction } from '@/lib/category-order'

export type DragSource =
  | { kind: 'bookmark'; id: number; categoryId: number | null }
  | { kind: 'category'; id: number }

export type DragTarget =
  | { kind: 'bookmark'; id: number; categoryId: number | null; position: 'before' | 'after'; sortIndex?: number }
  | { kind: 'category'; id: number; action: 'before' | 'after'; sortIndex?: number }

export type DragTargetFallback = {
  sourceId: number
  target: DragTarget
}

export type DragDrop = { token: number; source: DragSource; target: DragTarget }

type DragState = {
  lastDrop: DragDrop | null
  lastTarget: DragTargetFallback | null
  rememberTarget: (fallback: DragTargetFallback) => void
  clearTarget: () => void
  finish: (source: DragSource, target: DragTarget | null) => void
}

let dropToken = 0

export const useDragStore = create<DragState>((set) => ({
  lastDrop: null,
  lastTarget: null,
  rememberTarget: (fallback) => set({ lastTarget: fallback }),
  clearTarget: () => set({ lastTarget: null }),
  finish: (source, target) => set({
    lastDrop: target ? { token: ++dropToken, source, target } : null,
    lastTarget: null,
  }),
}))

export function getDragSource(data: Record<string | symbol, unknown>): DragSource | null {
  if (data.kind === 'bookmark' && typeof data.id === 'number') {
    return {
      kind: 'bookmark',
      id: data.id,
      categoryId: typeof data.categoryId === 'number' ? data.categoryId : null,
    }
  }
  if (
    data.kind === 'category' &&
    typeof data.id === 'number'
  ) {
    return { kind: 'category', id: data.id }
  }
  return null
}

export function getDragTarget(
  source: DragSource,
  data: Record<string | symbol, unknown>,
  position: { x: number; y: number },
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  bookmarkPosition?: BookmarkOrderPosition,
): DragTarget | null {
  if (typeof data.id !== 'number') return null
  if (source.kind === 'bookmark') {
    if (data.kind === 'category-zone') {
      return { kind: 'category', id: data.id, action: 'after' }
    }
    if (data.kind !== 'bookmark') return null
    const target: BookmarkDropTarget | null = source.id === data.id ? null : {
      kind: 'bookmark',
      id: data.id,
      categoryId: typeof data.categoryId === 'number' ? data.categoryId : null,
      position: bookmarkPosition ?? getBookmarkDropPosition(position.x, rect),
    }
    return target
  }
  if (data.kind !== 'category' || source.id === data.id) return null
  return {
    kind: 'category',
    id: data.id,
    action: getCategoryDropAction(position.y - rect.top, rect.height),
  }
}
