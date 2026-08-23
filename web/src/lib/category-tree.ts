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

export type CategoryTreeRow = {
  category: Category
  depth: number
  childCount: number
  siblingIndex: number
  bookmarkCount: number
}

export function getCategoryTreeRows(
  categories: Category[],
  expandedIds: ReadonlySet<number>,
  bookmarks: Pick<Bookmark, 'category_id'>[],
): CategoryTreeRow[] {
  const childrenByParent = new Map<number | null, Category[]>()
  const directBookmarkCounts = new Map<number, number>()

  for (const category of categories) {
    const siblings = childrenByParent.get(category.parent_id) ?? []
    siblings.push(category)
    childrenByParent.set(category.parent_id, siblings)
    directBookmarkCounts.set(category.id, 0)
  }
  for (const bookmark of bookmarks) {
    if (bookmark.category_id == null || !directBookmarkCounts.has(bookmark.category_id)) continue
    directBookmarkCounts.set(bookmark.category_id, (directBookmarkCounts.get(bookmark.category_id) ?? 0) + 1)
  }

  const bookmarkCounts = new Map(directBookmarkCounts)
  for (const category of categories) {
    const childBookmarkCount = (childrenByParent.get(category.id) ?? []).reduce(
      (count, child) => count + (directBookmarkCounts.get(child.id) ?? 0),
      0,
    )
    bookmarkCounts.set(category.id, (directBookmarkCounts.get(category.id) ?? 0) + childBookmarkCount)
  }

  const rows: CategoryTreeRow[] = []

  const visit = (parentId: number | null, depth: number) => {
    const siblings = childrenByParent.get(parentId) ?? []
    for (const [siblingIndex, category] of siblings.entries()) {
      rows.push({
        category,
        depth,
        childCount: (childrenByParent.get(category.id) ?? []).length,
        siblingIndex,
        bookmarkCount: bookmarkCounts.get(category.id) ?? 0,
      })
      if (expandedIds.has(category.id)) visit(category.id, depth + 1)
    }
  }

  visit(null, 0)
  return rows
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
