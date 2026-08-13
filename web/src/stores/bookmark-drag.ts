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
  clear: () => set((state) => state.sourceId == null && state.target == null ? state : { sourceId: null, target: null }),
}))

// 拖拽期间临时关闭毛玻璃（配合 effects.css 的 html.is-dragging 规则）：
// backdrop-filter 模糊层在拖拽预览反复扫过时会逐帧重算、持续分配 GPU 纹理，
// 长时间来回拖动会耗尽 GPU 内存导致整个浏览器崩溃。dragend 在拖拽结束时必然触发
// （含 Esc 取消与落点），不会残留类名。
if (typeof document !== 'undefined') {
  document.addEventListener('dragstart', () => document.documentElement.classList.add('is-dragging'))
  document.addEventListener('dragend', () => document.documentElement.classList.remove('is-dragging'))
}
