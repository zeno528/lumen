export const DRAG_TYPE_BOOKMARK = 'application/x-bookmark-id'
export const DRAG_TYPE_CATEGORY = 'application/x-category-id'

export type CategoryDropAction =
  | { kind: 'reorder'; position: 'before' | 'after' }
  | { kind: 'make-child' }

/** 以纵向中线为界返回落点侧；分类卡片排序与子分类浮层共用。 */
export function getDropSide(offset: number, height: number): 'before' | 'after' {
  return offset < height / 2 ? 'before' : 'after'
}

/** 分类卡片边缘用于排序；中部仅在源分类没有子分类时用于归入父级。 */
export function getCategoryDropAction(
  offset: number,
  height: number,
  canMakeChild: boolean,
): CategoryDropAction {
  if (canMakeChild && offset >= height * 0.25 && offset <= height * 0.75) return { kind: 'make-child' }
  return { kind: 'reorder', position: getDropSide(offset, height) }
}

export function setDragId(dataTransfer: DataTransfer, type: typeof DRAG_TYPE_BOOKMARK | typeof DRAG_TYPE_CATEGORY, id: number) {
  const value = String(id)
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(type, value)
  dataTransfer.setData('text/plain', value)
}

export function getDragId(dataTransfer: DataTransfer, type: typeof DRAG_TYPE_BOOKMARK | typeof DRAG_TYPE_CATEGORY) {
  const id = Number(dataTransfer.getData(type) || dataTransfer.getData('text/plain'))
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
