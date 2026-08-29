import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  batchDeleteCategories,
  reorderCategories,
} from '@/api/categories'
import { createOptimisticMutation } from '@/lib/optimistic-mutation'
import { moveCategoryToIndex } from '@/lib/category-order'
import type { Category, CategoryInput, Bookmark } from '@/types'
import type { CategoryDeleteMode } from '@/api/categories'

const CATEGORIES_KEY = ['categories'] as const
const BOOKMARKS_KEY = ['bookmarks'] as const

/** 分类列表（queryKey 与各处 invalidate 对齐） */
export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: getCategories,
  })
}

/**
 * 创建分类 —— onSuccess 用后端返回的真分类直接 append 到 categories 缓存，不再 invalidate+refetch。
 *
 * 为什么不做乐观占位卡：占位卡(负id)→真卡(正id) 的 DOM 替换会打断 .pop-in 入场动画（后端响应快时
 * pop-in 未播完就被替换 → 跳动），与 useCreateBookmark 同理。用后端真值 append 不存在 DOM 替换，动画干净。
 *
 * 为什么不再 onSettled invalidate：原实现 invalidate categories + bookmarks 触发两次 refetch，
 * 线上 RTT 累计数百 ms~1s 新分类才出现（bookmarks refetch 是大头）。改成 onSuccess 用后端真值 append，
 * 新分类在 create 响应到达时即入列（省掉两次 refetch 往返）。新建分类无书签，bookmarks 计数联动无必要，一并去掉。
 *
 * pop-in 时序：onCreated 设 recentlyAddedCatId（zustand 同步）先于 React Query 异步通知到达，
 * append 渲染时 isNew 已就位 → pop-in 干净无闪现。仍非瞬时（等 create 往返），但比 refetch 方案快一倍以上。
 */
export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CategoryInput) => createCategory(input),
    onSuccess: (cat: Category) => {
      qc.setQueryData<{ categories: Category[] }>(CATEGORIES_KEY, (old) =>
        old ? { ...old, categories: [...old.categories, cat] } : old,
      )
    },
  })
}

/** 更新分类 —— 乐观更新：立即改本地缓存让 UI 秒级响应，API 失败时还原。 */
export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<{ id: number; input: CategoryInput }>(qc, {
      mutationFn: ({ id, input }) => updateCategory(id, input),
      targets: [
        {
          queryKey: CATEGORIES_KEY,
          apply: (old: { categories: Category[] } | undefined, { id, input }) => {
            if (!old) return old
            return {
              ...old,
              categories: old.categories.map((c: Category) =>
                c.id === id ? { ...c, ...input } : c,
              ),
            }
          },
        },
      ],
    }),
  )
}

/**
 * 删除分类 —— 乐观更新：onMutate 立即从 categories 缓存 filter 掉 id，并模拟后端
 * ON DELETE SET NULL 把关联书签的 category_id 置 null（mode='keep' 语义）。
 * mode='all' 走 bookmarkMode='remove' 直接 filter 书签，避免置 null 闪现"未分类"项。
 *
 * 双 query 联动更新：categories + bookmarks 同时变。乐观删后侧栏其他分类立即 reflow 补位，
 * onError 回滚 + onSettled invalidate 对账。
 *
 * "一并删除书签"由调用方在删分类前用 useBatchDelete 处理（见 sidebar）。
 */
export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<{ id: number; mode?: CategoryDeleteMode }>(qc, {
      mutationFn: (args) => deleteCategory(args.id, args.mode),
      targets: [
        {
          queryKey: CATEGORIES_KEY,
          apply: (old: { categories: Category[] } | undefined, { id }) => {
            if (!old) return old
            return {
              ...old,
              // 子分类升级为顶级（对齐后端删除父分类前先解除 parent_id 引用）
              categories: old.categories
                .filter((c: Category) => c.id !== id)
                .map((c: Category) => (c.parent_id === id ? { ...c, parent_id: null } : c)),
            }
          },
        },
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old: { bookmarks: Bookmark[] } | undefined, { id, mode = 'keep' }) => {
            if (!old) return old
            return {
              ...old,
              bookmarks:
                mode === 'all'
                  ? old.bookmarks.filter((b: Bookmark) => b.category_id !== id)
                  : old.bookmarks.map((b: Bookmark) =>
                      b.category_id === id ? { ...b, category_id: null } : b,
                    ),
            }
          },
        },
      ],
    }),
  )
}

/**
 * 批量删除分类 —— 乐观更新：onMutate 立即 filter 掉 ids 的分类 + 把这些分类下的书签 category_id 置 null
 * （变未分类，模拟后端 ON DELETE SET NULL）。onError 回滚，onSettled invalidate 对账。
 */
export function useBatchDeleteCategories() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<number[]>(qc, {
      mutationFn: (ids) => batchDeleteCategories(ids),
      targets: [
        {
          queryKey: CATEGORIES_KEY,
          apply: (old: { categories: Category[] } | undefined, ids) => {
            if (!old) return old
            const idSet = new Set(ids)
            return {
              ...old,
              // 被删分类的子分类升级为顶级（对齐后端先解除 parent_id 引用再删）
              categories: old.categories
                .filter((c: Category) => !idSet.has(c.id))
                .map((c: Category) =>
                  c.parent_id != null && idSet.has(c.parent_id) ? { ...c, parent_id: null } : c,
                ),
            }
          },
        },
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old: { bookmarks: Bookmark[] } | undefined, ids) => {
            if (!old) return old
            const idSet = new Set(ids)
            // 这些分类下的书签变未分类（category_id 置 null）
            return {
              ...old,
              bookmarks: old.bookmarks.map((b: Bookmark) =>
                b.category_id != null && idSet.has(b.category_id)
                  ? { ...b, category_id: null }
                  : b,
              ),
            }
          },
        },
      ],
    }),
  )
}

/**
 * 分类顺序重排（同级兄弟内）。
 * 乐观更新：立即按新顺序重排 qc 缓存，再异步 PUT /api/categories/reorder。
 * 失败只 console.error 不回滚（排序错位非致命）。
 *
 * 两级层级语义：排序只在同一父分类的兄弟组内进行（parent_id=null 为顶层组）。
 * fromId / toId 必须同组（调用方 sidebar 的 drop 消费负责校验），本 hook 按 fromId 的
 * parent_id 圈定组。sortIndex 是组内目标下标（非全量扁平下标）。
 *
 * 位置语义：调用方传入 `position: 'before' | 'after'`，决定被拖项插到目标项的前面还是后面。
 * 关键点：先移除 from，再在移除后的数组里重新定位 to（from 在 to 前面时 to 前移一位）。
 */
export function useReorderCategories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      fromId,
      toId,
      position,
      sortIndex,
    }: {
      fromId: number
      toId: number
      position: 'before' | 'after'
      sortIndex?: number
    }) => {
      const data = qc.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY)
      const flat = data?.categories ?? []
      const group = siblingGroup(flat, fromId)
      const order = (sortIndex == null
        ? reorderCategory(group, fromId, toId, position)
        : moveCategoryToIndex(group, fromId, sortIndex)
      ).map((c) => c.id)
      const parentId = flat.find((c) => c.id === fromId)?.parent_id ?? null
      return reorderCategories(parentId, order)
    },
    onMutate: async ({ fromId, toId, position, sortIndex }) => {
      await qc.cancelQueries({ queryKey: CATEGORIES_KEY })
      const prev = qc.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY)
      qc.setQueryData<{ categories: Category[] }>(CATEGORIES_KEY, (old: { categories: Category[] } | undefined) => {
        if (!old) return old
        return {
          ...old,
          categories: reorderSiblingGroupFlat(old.categories, fromId, toId, position, sortIndex),
        }
      })
      return { prev }
    },
    onError: (e) => {
      console.error('分类排序同步失败:', e)
    },
    onSettled: () => {
      // 排序错位非致命（onError 故意不回滚），仍 invalidate 对账，让服务端是真相源。
      qc.invalidateQueries({ queryKey: CATEGORIES_KEY })
    },
  })
}

/** 取 fromId 所属的兄弟组（同 parent_id 的分类，按 flat 现有顺序）。 */
function siblingGroup(flat: Category[], fromId: number): Category[] {
  const from = flat.find((c) => c.id === fromId)
  if (!from) return []
  return flat.filter((c) =>
    from.parent_id == null ? c.parent_id == null : c.parent_id === from.parent_id,
  )
}

/**
 * 在扁平缓存里做兄弟组内重排：组外元素原位不动，组成员按组内新顺序填回原槽位。
 * 侧边栏渲染只依赖「兄弟间相对顺序」（树构建时按数组序取子），槽位保持即视觉正确。
 */
function reorderSiblingGroupFlat(
  flat: Category[],
  fromId: number,
  toId: number,
  position: 'before' | 'after',
  sortIndex?: number,
): Category[] {
  const group = siblingGroup(flat, fromId)
  if (group.length === 0) return flat
  const reordered =
    sortIndex == null
      ? reorderCategory(group, fromId, toId, position)
      : moveCategoryToIndex(group, fromId, sortIndex)
  let i = 0
  const groupIds = new Set(group.map((c) => c.id))
  return flat.map((c) => (groupIds.has(c.id) ? reordered[i++] : c))
}

/**
 * 把 fromId 分类移到 toId 分类的 before/after 位置，返回新顺序的分类数组（不改原数组）。
 *
 * 关键点：先移除 from，再用 findIndex 在移除后的数组里重新定位 to 并按 position 插入。
 * - position='before'：splice(insertIdx, 0, moved)，被拖项落到 to 前面
 * - position='after'：splice(insertIdx + 1, 0, moved)，被拖项落到 to 后面
 */
function reorderCategory(
  categories: Category[],
  fromId: number,
  toId: number,
  position: 'before' | 'after',
): Category[] {
  const next = [...categories]
  const fromIdx = next.findIndex((c) => c.id === fromId)
  const toIdx = next.findIndex((c) => c.id === toId)
  if (fromIdx === -1 || toIdx === -1 || fromId === toId) return next
  const [moved] = next.splice(fromIdx, 1)
  // 移除 from 后重新定位 to（from 在 to 前面时 to 会前移一位）
  const insertIdx = next.findIndex((c) => c.id === toId)
  if (position === 'before') {
    next.splice(insertIdx, 0, moved)
  } else {
    next.splice(insertIdx + 1, 0, moved)
  }
  return next
}
