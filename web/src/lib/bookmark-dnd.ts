import type { Bookmark } from '@/types'

export type BookmarkDropPosition = 'before' | 'after'

/** 书签卡片以水平中线区分插入前后。 */
export function getBookmarkDropPosition(clientX: number, rect: Pick<DOMRect, 'left' | 'width'>): BookmarkDropPosition {
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

/** 多选拖拽保留当前列表顺序；未多选时只移动拖起的书签。 */
export function getDraggedBookmarkIds(bookmarks: Bookmark[], selectedIds: Set<number>, draggedId: number) {
  const isBatch = selectedIds.has(draggedId) && selectedIds.size > 1
  return {
    ids: isBatch ? bookmarks.filter((bookmark) => selectedIds.has(bookmark.id)).map((bookmark) => bookmark.id) : [draggedId],
    isBatch,
  }
}

/** 按 before/after 落点把 fromId 移到 toId 前/后；无操作时返回原数组引用。 */
export function moveBookmarkInList<T extends { id: number }>(
  items: T[],
  fromId: number,
  toId: number,
  position: BookmarkDropPosition,
): T[] {
  const fromIdx = items.findIndex((item) => item.id === fromId)
  const toIdx = items.findIndex((item) => item.id === toId)
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return items
  const next = [...items]
  const [moved] = next.splice(fromIdx, 1)
  // 移除 from 后 toId 的实际索引（from 在 to 前则前移一位），落点在此基准上计算
  const targetIdx = fromIdx < toIdx ? toIdx - 1 : toIdx
  next.splice(position === 'after' ? targetIdx + 1 : targetIdx, 0, moved)
  return next
}

/** 批量移动是否真的换了分类：ids 中任一书签不在目标分类即算跨分类移动（才需要成功通知）。
 *  契约：ids 恒来自 bookmarks 列表；找不到的 id 视为「未跨分类」被忽略，调用方不得传入脏 id。 */
export function isCrossCategoryMove(
  bookmarks: Bookmark[],
  ids: number[],
  targetCategoryId: number | null,
): boolean {
  return ids.some((id) => {
    const bookmark = bookmarks.find((item) => item.id === id)
    return bookmark != null && bookmark.category_id !== targetCategoryId
  })
}
