export type BookmarkOrderPosition = 'before' | 'after'

export type BookmarkDropTarget = {
  kind: 'bookmark'
  id: number
  categoryId: number | null
  position: BookmarkOrderPosition
  sortIndex?: number
}

export type BookmarkDropFallback = {
  sourceId: number
  target: BookmarkDropTarget
}

export function getBookmarkDropPosition(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
): BookmarkOrderPosition {
  return clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

export function moveBookmarkToIndex<T extends { id: number; category_id: number | null }>(
  items: T[],
  categoryId: number | null,
  fromId: number,
  toIndex: number,
): T[] {
  const categoryItems = items.filter((item) => item.category_id === categoryId)
  const fromIndex = categoryItems.findIndex((item) => item.id === fromId)
  if (fromIndex === -1) return items
  const boundedIndex = Math.max(0, Math.min(toIndex, categoryItems.length - 1))
  if (fromIndex === boundedIndex) return items

  const nextCategoryItems = [...categoryItems]
  const [moved] = nextCategoryItems.splice(fromIndex, 1)
  nextCategoryItems.splice(boundedIndex, 0, moved)

  let categoryIndex = 0
  return items.map((item) => (
    item.category_id === categoryId ? nextCategoryItems[categoryIndex++] : item
  ))
}
