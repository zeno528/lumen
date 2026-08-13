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

export function getCategoryLabel(category: Category): string {
  return category.parent_id == null ? category.name : `　${category.name}`
}
