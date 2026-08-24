import type { Bookmark, Category } from '@/types'

export function getCategoryDescendantIds(categories: Category[], parentId: number): number[] {
  const childrenByParent = new Map<number | null, Category[]>()
  for (const category of categories) {
    const children = childrenByParent.get(category.parent_id) ?? []
    children.push(category)
    childrenByParent.set(category.parent_id, children)
  }
  const descendants: number[] = []
  const seen = new Set([parentId])
  const visit = (id: number) => {
    for (const child of childrenByParent.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      descendants.push(child.id)
      visit(child.id)
    }
  }
  visit(parentId)
  return descendants
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

  const bookmarkCounts = new Map<number, number>()
  const countBookmarks = (categoryId: number, visiting = new Set<number>()): number => {
    const cached = bookmarkCounts.get(categoryId)
    if (cached !== undefined) return cached
    if (visiting.has(categoryId)) return directBookmarkCounts.get(categoryId) ?? 0
    visiting.add(categoryId)
    const count = (directBookmarkCounts.get(categoryId) ?? 0) + (childrenByParent.get(categoryId) ?? [])
      .reduce((total, child) => total + countBookmarks(child.id, visiting), 0)
    visiting.delete(categoryId)
    bookmarkCounts.set(categoryId, count)
    return count
  }
  for (const category of categories) countBookmarks(category.id)

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
