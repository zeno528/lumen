type DragKind = 'bookmark' | 'category' | 'category-zone'
type DragItem = { kind: DragKind; id: number; name?: string }
export type BookmarkDragData = DragItem & {
  kind: 'bookmark'
  title: string
  categoryId: number | null
  categoryName: string
  favicon: string
}
export type CategoryDragData = DragItem & {
  kind: 'category'
  name: string
  color?: string
  icon?: string
  parentId: number | null
  canNest: boolean
}
export type CategoryZoneDragData = DragItem & {
  kind: 'category-zone'
  name: string
}
export type LumenDragData = BookmarkDragData | CategoryDragData | CategoryZoneDragData

export function makeDragId(kind: 'bookmark' | 'category', id: number): string {
  return `${kind}:${id}`
}

export function makeCategoryZoneId(id: number): string {
  return `category-zone:${id}`
}

export type CategoryDropAction =
  | { kind: 'reorder'; position: 'before' | 'after' }
  | { kind: 'make-child' }

/** 以纵向中线为界返回落点侧；分类卡片排序与子分类浮层共用。 */
function getDropSide(offset: number, height: number): 'before' | 'after' {
  return offset < height / 2 ? 'before' : 'after'
}

/** 分类卡片边缘用于排序；中部仅在源分类没有子分类时用于归入父级。 */
export function getCategoryDropAction(
  offset: number,
  height: number,
  canMakeChild: boolean,
): CategoryDropAction {
  // 嵌套区收窄到中间 1/3（原 0.25-0.75）：排序边缘带各 ~10px → ~13px，
  // 嵌套有整卡描边高亮 + hover 子分类浮层辅助，收窄后仍明确
  if (canMakeChild && offset >= height * 0.33 && offset <= height * 0.67) return { kind: 'make-child' }
  return { kind: 'reorder', position: getDropSide(offset, height) }
}
