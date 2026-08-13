import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCategories,
  createCategory,
  updateCategory,
  moveCategory,
  releaseCategoryChildren,
  deleteCategory,
  batchDeleteCategories,
  reorderCategories,
} from '@/api/categories'
import { createOptimisticMutation } from '@/lib/optimistic-mutation'
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

/** 拖拽归类 —— 只改 parent_id，保留分类本身及其书签。 */
export function useMoveCategory() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<{ id: number; parentId: number | null }>(qc, {
      mutationFn: ({ id, parentId }) => moveCategory(id, parentId),
      targets: [
        {
          queryKey: CATEGORIES_KEY,
          apply: (old: { categories: Category[] } | undefined, { id, parentId }) =>
            old
              ? { ...old, categories: old.categories.map((c) => (c.id === id ? { ...c, parent_id: parentId } : c)) }
              : old,
        },
      ],
    }),
  )
}

/** 释放父分类下的全部直接子分类。 */
export function useReleaseCategoryChildren() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<number>(qc, {
      mutationFn: releaseCategoryChildren,
      targets: [{
        queryKey: CATEGORIES_KEY,
        apply: (old: { categories: Category[] } | undefined, id) =>
          old ? { ...old, categories: old.categories.map((category) => category.parent_id === id ? { ...category, parent_id: null } : category) } : old,
      }],
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
    createOptimisticMutation<{ id: number; mode?: CategoryDeleteMode; childIds?: number[] }>(qc, {
      mutationFn: (args) => deleteCategory(args.id, args.mode),
      targets: [
        {
          queryKey: CATEGORIES_KEY,
          apply: (old: { categories: Category[] } | undefined, { id, mode = 'keep' }) => {
            if (!old) return old
            return {
              ...old,
              categories: old.categories
                .filter((c: Category) => c.id !== id)
                .map((c: Category) => (mode === 'promote' && c.parent_id === id ? { ...c, parent_id: null } : c)),
            }
          },
        },
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old: { bookmarks: Bookmark[] } | undefined, { id, mode = 'keep', childIds = [] }) => {
            if (!old) return old
            const deletedIds = new Set(mode === 'promote' ? [id] : [id, ...childIds])
            return {
              ...old,
              bookmarks:
                mode === 'all'
                  ? old.bookmarks.filter((b: Bookmark) => !deletedIds.has(b.category_id ?? -1))
                  : old.bookmarks.map((b: Bookmark) =>
                      b.category_id != null && deletedIds.has(b.category_id) ? { ...b, category_id: null } : b,
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
              categories: old.categories.filter((c: Category) => !idSet.has(c.id)),
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
 * 分类拖拽重排。
 * 乐观更新：立即按新顺序重排 qc 缓存，再异步 PUT /api/categories/reorder。
 * 失败只 console.error 不回滚（排序错位非致命）。
 *
 * 排序语义：由调用方传入 `position: 'before' | 'after'`，决定被拖项插到目标项的前面还是后面。
 * 原实现固定 `before`，配合 HTML5 DnD "drop target = 鼠标光标下的元素" 时，往下拖视觉位移
 * 极小（落点命中 from 已经在它前面的目标 → "插到前面" = 现状）用户感觉"往下拖没反应"。
 * 修复：drop 时按鼠标在 target 内的 offsetY 决定 before/after（中线为界）。
 *
 * 关键点：先移除 from，再用 findIndex 在移除后的数组里重新定位 to 并按 position 插入。
 * 不能直接用原 toIdx —— 若 from 原本在 to 前面，移除 from 后 to 实际索引 = toIdx - 1，
 * 此时 splice(toIdx, ...) 会落到错误位置，造成"排到选中分类下面"的 bug。
 */
export function useReorderCategories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      fromId,
      toId,
      position,
    }: {
      fromId: number
      toId: number
      position: 'before' | 'after'
    }) => {
      const data = qc.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY)
      const order = reorderCategory(data?.categories ?? [], fromId, toId, position).map(
        (c) => c.id,
      )
      return reorderCategories(order)
    },
    onMutate: async ({ fromId, toId, position }) => {
      await qc.cancelQueries({ queryKey: CATEGORIES_KEY })
      const prev = qc.getQueryData<{ categories: Category[] }>(CATEGORIES_KEY)
      qc.setQueryData<{ categories: Category[] }>(CATEGORIES_KEY, (old: { categories: Category[] } | undefined) => {
        if (!old) return old
        return {
          ...old,
          categories: reorderCategory(old.categories, fromId, toId, position),
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
