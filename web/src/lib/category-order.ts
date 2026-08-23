export type CategoryDropAction = 'before' | 'after' | 'inside'

/** 用目标卡片的垂直分区决定分类是同级排序还是收入其下。 */
export function getCategoryDropAction(
  offset: number,
  height: number,
  canMakeChild: boolean,
): CategoryDropAction {
  if (canMakeChild && offset >= height * 0.33 && offset <= height * 0.67) return 'inside'
  return offset < height / 2 ? 'before' : 'after'
}
