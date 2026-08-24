import { create } from 'zustand'
import {
  getBookmarkDropPosition,
  type BookmarkDropFallback,
  type BookmarkDropTarget,
  type BookmarkOrderPosition,
} from '@/lib/bookmark-order'
import { getCategoryDropAction } from '@/lib/category-order'

export type DragSource =
  | { kind: 'bookmark'; id: number; categoryId: number | null }
  | { kind: 'category'; id: number; parentId: number | null; hasChildren: boolean; descendantIds: number[] }

export type DragTarget =
  | { kind: 'bookmark'; id: number; categoryId: number | null; position: 'before' | 'after'; sortIndex?: number }
  | { kind: 'category'; id: number; parentId: number | null; action: 'before' | 'after' | 'inside' }

export type DragDrop = { token: number; source: DragSource; target: DragTarget }

type DragState = {
  lastDrop: DragDrop | null
  lastBookmarkTarget: BookmarkDropFallback | null
  rememberBookmarkTarget: (fallback: BookmarkDropFallback) => void
  clearBookmarkTarget: () => void
  finish: (source: DragSource, target: DragTarget | null) => void
}

let dropToken = 0

export const useDragStore = create<DragState>((set) => ({
  lastDrop: null,
  lastBookmarkTarget: null,
  rememberBookmarkTarget: (fallback) => set({ lastBookmarkTarget: fallback }),
  clearBookmarkTarget: () => set({ lastBookmarkTarget: null }),
  finish: (source, target) => set({
    lastDrop: target ? { token: ++dropToken, source, target } : null,
    lastBookmarkTarget: null,
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
    typeof data.id === 'number' &&
    (typeof data.parentId === 'number' || data.parentId == null)
  ) {
    return {
      kind: 'category',
      id: data.id,
      parentId: typeof data.parentId === 'number' ? data.parentId : null,
      hasChildren: data.hasChildren === true,
      descendantIds: Array.isArray(data.descendantIds)
        ? data.descendantIds.filter((id): id is number => typeof id === 'number')
        : [],
    }
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
      return { kind: 'category', id: data.id, parentId: null, action: 'inside' }
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
  if (source.descendantIds.includes(data.id)) return null
  const parentId = typeof data.parentId === 'number' ? data.parentId : null
  return {
    kind: 'category',
    id: data.id,
    parentId,
    action: getCategoryDropAction(
      position.y - rect.top,
      rect.height,
      true,
    ),
  }
}
