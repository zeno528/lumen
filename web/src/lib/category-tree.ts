import type { Bookmark } from '@/types'

/** Category helpers kept under the old module path for callers; categories are flat. */
export function getCategoryCount(
  bookmarks: Pick<Bookmark, 'category_id'>[],
  categoryId: number,
): number {
  return bookmarks.filter((bookmark) => bookmark.category_id === categoryId).length
}
