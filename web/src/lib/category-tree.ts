import type { Bookmark, Category } from '@/types'

/** 按分类 id 直接计数（不含子分类）。父分类的展示计数用 getAggregatedCount。 */
export function getCategoryCount(
  bookmarks: Pick<Bookmark, 'category_id'>[],
  categoryId: number,
): number {
  return bookmarks.filter((bookmark) => bookmark.category_id === categoryId).length
}

/**
 * 固定两级的分类树：roots（顶级）+ childrenOf（某父分类的子分类）。
 * 子分类顺序沿用传入数组的相对顺序（后端 ORDER BY sort_order, id）。
 * 两级封顶是全项目的结构契约：聚合、过滤、拖拽都只看一层，禁止递归。
 */
export interface CategoryTree {
  roots: Category[]
  childrenOf(parentId: number): Category[]
  /** 某分类的全部子分类 id（两级封顶，一次映射） */
  childIds(parentId: number): number[]
  /** 分类 id → 子分类 id 集合（含自身 id 的完整过滤集合见 filterIdsFor） */
  parentOf(id: number): number | null
  /** 数字分类 id 的完整书签过滤集合：自身 + 全部子分类 id */
  filterIdsFor(categoryId: number): number[]
}

export function buildCategoryTree(categories: Category[]): CategoryTree {
  const childrenMap = new Map<number, Category[]>()
  const roots: Category[] = []
  for (const c of categories) {
    if (c.parent_id == null) {
      roots.push(c)
    } else {
      const list = childrenMap.get(c.parent_id)
      if (list) list.push(c)
      else childrenMap.set(c.parent_id, [c])
    }
  }
  return {
    roots,
    childrenOf: (parentId) => childrenMap.get(parentId) ?? [],
    childIds: (parentId) => (childrenMap.get(parentId) ?? []).map((c) => c.id),
    parentOf: (id) => categories.find((c) => c.id === id)?.parent_id ?? null,
    filterIdsFor: (categoryId) => [categoryId, ...(childrenMap.get(categoryId) ?? []).map((c) => c.id)],
  }
}

/** 聚合计数：分类自身 + 其子分类的书签总数（两级封顶，一次求和）。 */
export function getAggregatedCount(
  bookmarks: Pick<Bookmark, 'category_id'>[],
  categoryId: number,
  childIds: number[],
): number {
  const ids = new Set([categoryId, ...childIds])
  return bookmarks.reduce((n, b) => (b.category_id != null && ids.has(b.category_id) ? n + 1 : n), 0)
}

/** 分类的显示路径名：子分类返回「父/子」，顶级返回原名。AI 候选列表与回显解析共用。 */
export function categoryPathName(category: Category, categories: Category[]): string {
  if (category.parent_id == null) return category.name
  const parent = categories.find((c) => c.id === category.parent_id)
  return parent ? `${parent.name}/${category.name}` : category.name
}

/** 按路径名（或裸名）找分类：先按「父/子」路径精确匹配，顶级分类再按裸名匹配。 */
export function findCategoryByPath(
  path: string,
  categories: Category[],
): Category | undefined {
  const target = path.trim()
  if (!target) return undefined
  const lower = target.toLowerCase()
  const slash = target.indexOf('/')
  if (slash !== -1) {
    const parentName = target.slice(0, slash).trim().toLowerCase()
    const childName = target.slice(slash + 1).trim().toLowerCase()
    const hit = categories.find((c) => {
      if (c.parent_id == null || c.name.trim().toLowerCase() !== childName) return false
      const parent = categories.find((p) => p.id === c.parent_id)
      return parent?.name.trim().toLowerCase() === parentName
    })
    if (hit) return hit
  }
  return categories.find(
    (c) => c.parent_id == null && c.name.trim().toLowerCase() === lower,
  )
}
