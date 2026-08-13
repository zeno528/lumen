import type { Bookmark, Category } from '@/types'

export function getCategoryDescendantIds(categories: Category[], parentId: number): number[] {
  return categories.filter((category) => category.parent_id === parentId).map((category) => category.id)
}

export function getCategoryCount(bookmarks: Pick<Bookmark, 'category_id'>[], categories: Category[], categoryId: number): number {
  const ids = new Set([categoryId, ...getCategoryDescendantIds(categories, categoryId)])
  return bookmarks.filter((bookmark) => bookmark.category_id != null && ids.has(bookmark.category_id)).length
}

export function filterBookmarksByCategory<T extends Pick<Bookmark, 'category_id'>>(
  bookmarks: T[],
  categories: Category[],
  categoryId: number,
): T[] {
  const ids = new Set([categoryId, ...getCategoryDescendantIds(categories, categoryId)])
  return bookmarks.filter((bookmark) => bookmark.category_id != null && ids.has(bookmark.category_id))
}

export function getTopLevelCategories(categories: Category[]): Category[] {
  return categories.filter((category) => category.parent_id == null)
}

export function getChildCategories(categories: Category[], parentId: number): Category[] {
  return categories.filter((category) => category.parent_id === parentId)
}

/** 子分类所属的父分类；顶级分类或不存在时返回 null。 */
export function getParentCategory(categories: Category[], childId: number): Category | null {
  const child = categories.find((category) => category.id === childId)
  if (!child || child.parent_id == null) return null
  return categories.find((category) => category.id === child.parent_id) ?? null
}

/** 是否有子分类。 */
export function hasChildCategories(categories: Category[], categoryId: number): boolean {
  return categories.some((category) => category.parent_id === categoryId)
}

export function getCategoryLabel(category: Category): string {
  return category.parent_id == null ? category.name : `　${category.name}`
}
