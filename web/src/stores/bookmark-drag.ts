import { create } from 'zustand'

type DragTarget = { id: number; name: string } | null

type BookmarkDragState = {
  sourceId: number | null
  target: DragTarget
  start: (sourceId: number) => void
  setTarget: (target: DragTarget) => void
  clear: () => void
}

/** 高频拖拽反馈独立于持久 UI store，避免分类栏因指针移动重渲染。 */
export const useBookmarkDragStore = create<BookmarkDragState>()((set) => ({
  sourceId: null,
  target: null,
  start: (sourceId) => set({ sourceId, target: null }),
  setTarget: (target) => set((state) => state.target?.id === target?.id ? state : { target }),
  clear: () => set((state) =>
    state.sourceId == null && state.target == null
      ? state
      : { sourceId: null, target: null },
  ),
}))
