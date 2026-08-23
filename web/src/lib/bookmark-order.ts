export type BookmarkOrderPosition = 'before' | 'after'

export function getBookmarkDropPosition(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
): BookmarkOrderPosition {
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

export function moveBookmarkInList<T extends { id: number }>(
  items: T[],
  fromId: number,
  toId: number,
  position: BookmarkOrderPosition,
): T[] {
  const fromIdx = items.findIndex((item) => item.id === fromId)
  const toIdx = items.findIndex((item) => item.id === toId)
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return items
  const next = [...items]
  const [moved] = next.splice(fromIdx, 1)
  const targetIdx = fromIdx < toIdx ? toIdx - 1 : toIdx
  next.splice(position === 'after' ? targetIdx + 1 : targetIdx, 0, moved)
  return next
}
