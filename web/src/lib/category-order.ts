export type CategoryDropAction = 'before' | 'after'

/** 用目标卡片的垂直中线决定顶级分类顺序。 */
export function getCategoryDropAction(offset: number, height: number): CategoryDropAction {
  return offset < height / 2 ? 'before' : 'after'
}

export function moveCategoryToIndex<T extends { id: number }>(
  items: T[],
  fromId: number,
  toIndex: number,
): T[] {
  const fromIndex = items.findIndex((item) => item.id === fromId)
  if (fromIndex === -1) return items
  const boundedIndex = Math.max(0, Math.min(toIndex, items.length - 1))
  if (fromIndex === boundedIndex) return items

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(boundedIndex, 0, moved)
  return next
}
