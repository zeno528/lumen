import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getBookmarks,
  createBookmark,
  updateBookmark,
  deleteBookmark,
  toggleFavorite,
  batchDeleteBookmarks,
  batchMoveBookmarks,
  batchAddTags,
  reorderBookmarks,
} from '@/api/bookmarks'
import { toast } from '@/components/ui/toast'
import { moveBookmarkInList, type BookmarkDropPosition } from '@/lib/bookmark-dnd'
import { deleteFavicon } from '@/lib/favicon-cache'
import { createOptimisticMutation } from '@/lib/optimistic-mutation'
import type { BookmarkInput, Bookmark } from '@/types'

/** 书签列表全量拉取（前端过滤） */
export function useBookmarks() {
  return useQuery({
    queryKey: ['bookmarks'],
    queryFn: getBookmarks,
  })
}

const BOOKMARKS_KEY = ['bookmarks'] as const

/** 收藏切换 —— 乐观更新 + 失败回滚 */
export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<number>(qc, {
      mutationFn: (id) => toggleFavorite(id),
      targets: [
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old, id) => {
            if (!old) return old
            return {
              ...old,
              bookmarks: old.bookmarks.map((b: Bookmark) =>
                b.id === id ? { ...b, is_favorite: !b.is_favorite } : b,
              ),
            }
          },
        },
      ],
    }),
  )
}

/**
 * 创建书签 —— onSuccess 用后端返回的真书签直接 append 到 bookmarks 缓存，不再 invalidate+refetch。
 *
 * 为什么不做乐观占位卡：占位卡(负id)先于 recentlyAddedId 显示 → 无动画；后端返回真卡(正id)替换，
 * key 变化致 DOM 卸载重建并重播 pop-in → 入场跳动（详见 memory）。用后端真值 append 无 DOM 替换，动画干净。
 *
 * 为什么不再 onSettled invalidate：原实现 invalidate bookmarks 触发全量 refetch（万条数据，线上慢），
 * 新书签要等 create + refetch 两次往返才出现（用户反馈"延迟"）。改成 onSuccess 用后端真值 append，
 * 新书签在 create 响应到达时即入列（省掉 refetch）。onCreated 设 recentlyAddedId（zustand 同步）
 * 先于 React Query 异步通知到达，append 渲染时 isNew 已就位 → pop-in 干净无闪现。
 *
 * 仍非瞬时（等 create 往返），但比 refetch 方案快一倍以上；pop-in 动画掩护 create 时间。与 useCreateCategory 同模式。
 */
export function useCreateBookmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookmarkInput) => createBookmark(input),
    onSuccess: (res) => {
      qc.setQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY, (old) =>
        old ? { ...old, bookmarks: [...old.bookmarks, res.bookmark] } : old,
      )
    },
  })
}

/** 更新书签 —— 乐观更新：立即用 input 覆盖缓存里对应 id 的书签，失败回滚。 */
export function useUpdateBookmark() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<{ id: number; input: Partial<BookmarkInput> }>(qc, {
      mutationFn: ({ id, input }) => updateBookmark(id, input),
      targets: [
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old, { id, input }) => {
            if (!old) return old
            return {
              ...old,
              bookmarks: old.bookmarks.map((b: Bookmark) =>
                b.id === id ? { ...b, ...input, updated_at: new Date().toISOString() } : b,
              ),
            }
          },
        },
      ],
    }),
  )
}

/**
 * 删除书签 —— 乐观更新：onMutate 立即从 cache filter 掉 id，删除瞬间后面卡片 reflow 补位。
 *
 * 关键背景：原方案仅 onSuccess → invalidate → 全量 GET /bookmarks?limit=10000 refetch → React 重渲染，
 * 加上 bookmarks.tsx 里的 setTimeout(200) 等 pop-out 动画，线上环境总延迟 ≈ 200ms + 2×RTT + 1万条 diff，
 * 用户感受"删卡后近 1 秒才补位"。
 * 乐观删后，cache 立即少 1 条 → 后面卡片立即 reflow（不等 API 不等 refetch），
 * onError 回滚 + onSettled invalidate 对账，WS 推送也仍能正常 invalidate 触发刷新区分类。
 */
export function useDeleteBookmark() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<number>(qc, {
      mutationFn: (id) => deleteBookmark(id),
      targets: [
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old, id) => {
            if (!old) return old
            return {
              ...old,
              bookmarks: old.bookmarks.filter((b: Bookmark) => b.id !== id),
            }
          },
          // 乐观删后立即清 localStorage favicon 缓存（不等服务端响应）
          onOptimistic: (id) => deleteFavicon(id),
        },
      ],
    }),
  )
}

/** 批量删除 —— 乐观更新：一次性 filter 掉所有 ids，乐观清 favicon 缓存，失败回滚。 */
export function useBatchDelete() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<number[]>(qc, {
      mutationFn: (ids) => batchDeleteBookmarks(ids),
      targets: [
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old, ids) => {
            if (!old) return old
            const idSet = new Set(ids)
            return {
              ...old,
              bookmarks: old.bookmarks.filter((b: Bookmark) => !idSet.has(b.id)),
            }
          },
          onOptimistic: (ids) => ids.forEach(deleteFavicon),
        },
      ],
    }),
  )
}

/** 全部取消收藏 —— 乐观更新 + 并发 PATCH（不走标准模板：mutationFn 内联修改 cache + 并发请求，错误回滚） */
export function useClearAllFavorites() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // 取消进行中的 refetch，防止旧数据覆盖乐观更新（本 hook 在 mutationFn 内联做乐观更新，不走 onMutate）
      await qc.cancelQueries({ queryKey: BOOKMARKS_KEY })
      const data = qc.getQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY)
      const favIds =
        data?.bookmarks.filter((b: Bookmark) => b.is_favorite).map((b: Bookmark) => b.id) ?? []
      if (favIds.length === 0) return { cleared: 0 }
      const prev = data
      qc.setQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY, (old) => {
        if (!old) return old
        return {
          ...old,
          bookmarks: old.bookmarks.map((b: Bookmark) =>
            b.is_favorite ? { ...b, is_favorite: false } : b,
          ),
        }
      })
      try {
        await Promise.all(favIds.map((id) => toggleFavorite(id)))
        return { cleared: favIds.length }
      } catch (e) {
        if (prev) qc.setQueryData(BOOKMARKS_KEY, prev)
        throw e
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: BOOKMARKS_KEY }),
  })
}

/**
 * 批量移动分类 —— 乐观更新 + 失败回滚。
 * onMutate 立即把 ids 的 category_id 改成目标值，原列表卡片瞬间被过滤移除（无闪烁）；
 * 失败 onError 回滚；onSettled invalidate 对账。
 * 必须乐观更新：拖拽移动时 sidebar 会 markBookmarkExiting 让卡片挂 pop-out，若只 invalidate 等refetch，
 * 卡片 category_id 迟迟不变 + exitingBookmarkIds 残留 → 点开新分类时卡片 pop-out 不可见（bug）。
 */
export function useBatchMove() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<{
      ids: number[]
      categoryId: number | null
      targetBookmarkId?: number
      position?: 'before' | 'after'
    }>(qc, {
      mutationFn: ({ ids, categoryId, targetBookmarkId, position }) =>
        batchMoveBookmarks(ids, categoryId, targetBookmarkId, position),
      targets: [
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old, { ids, categoryId, targetBookmarkId, position }) => {
            if (!old) return old
            const idSet = new Set(ids)
            const byId = new Map(old.bookmarks.map((bookmark: Bookmark) => [bookmark.id, bookmark]))
            const moving = ids.map((id) => byId.get(id)).filter((bookmark): bookmark is Bookmark => !!bookmark)
            const remaining = old.bookmarks.filter((bookmark: Bookmark) => bookmark.category_id === categoryId && !idSet.has(bookmark.id))
            let insertAt = remaining.length
            if (targetBookmarkId != null) {
              const targetIndex = remaining.findIndex((bookmark: Bookmark) => bookmark.id === targetBookmarkId)
              if (targetIndex >= 0) insertAt = targetIndex + (position === 'after' ? 1 : 0)
            }
            const targetOrder = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
            const sortOrderById = new Map(targetOrder.map((bookmark, index) => [bookmark.id, index]))
            return {
              ...old,
              bookmarks: old.bookmarks
                .map((bookmark: Bookmark) =>
                  idSet.has(bookmark.id)
                    ? { ...bookmark, category_id: categoryId, sort_order: sortOrderById.get(bookmark.id) ?? bookmark.sort_order }
                    : sortOrderById.has(bookmark.id)
                      ? { ...bookmark, sort_order: sortOrderById.get(bookmark.id)! }
                      : bookmark,
                )
                .sort((a: Bookmark, b: Bookmark) => a.sort_order - b.sort_order || b.id - a.id),
            }
          },
        },
      ],
    }),
  )
}

/** 批量加标签 —— 乐观更新：立即给 ids 的 tags 并集加入新标签，失败回滚。 */
export function useBatchAddTags() {
  const qc = useQueryClient()
  return useMutation(
    createOptimisticMutation<{ ids: number[]; tags: string[] }>(qc, {
      mutationFn: ({ ids, tags }) => batchAddTags(ids, tags),
      targets: [
        {
          queryKey: BOOKMARKS_KEY,
          apply: (old, { ids, tags }) => {
            if (!old) return old
            const idSet = new Set(ids)
            return {
              ...old,
              bookmarks: old.bookmarks.map((b: Bookmark) =>
                idSet.has(b.id)
                  ? { ...b, tags: Array.from(new Set([...b.tags, ...tags])) }
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
 * 卡片拖拽重排。
 * 乐观更新：立即按新顺序重排 qc 缓存（UI 秒级响应），再异步 PUT /api/bookmarks/reorder。
 * 失败只 console.error 不回滚（排序错位非致命，下次拉取自愈）。
 *
 * @param fromId  被拖卡片 id
 * @param toId    放下目标卡片 id
 */
export function useReorderBookmarks() {
  const qc = useQueryClient()
  return useMutation({
    // onMutate 已 await + 重排 cache（React Query 源码：await onMutate 完成后才跑 mutationFn）。
    // 直接用 cache 的 id 序列发 API —— 不能再 computeReorderedIds：那会基于重排后的 cache 再重排一次，
    // 得到错误 order → 后端存错 sort_order → 刷新后顺序与拖动不一致（排序失效）。
    mutationFn: (_vars: { fromId: number; toId: number; position: BookmarkDropPosition }) => {
      const data = qc.getQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY)
      return reorderBookmarks((data?.bookmarks ?? []).map((b: Bookmark) => b.id))
    },
    onMutate: async ({ fromId, toId, position }) => {
      await qc.cancelQueries({ queryKey: BOOKMARKS_KEY })
      const prev = qc.getQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY)
      qc.setQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY, (old) => {
        if (!old) return old
        const next = moveBookmarkInList(old.bookmarks, fromId, toId, position)
        if (next === old.bookmarks) return old
        return { ...old, bookmarks: next }
      })
      return { prev }
    },
    onError: (e) => {
      console.error('排序同步失败:', e)
    },
    onSettled: () => {
      // 排序错位非致命（onError 故意不回滚），但仍 invalidate 对账：服务端 sort_order 算法若与
      // 客户端重排不一致，refetch 拿真值纠正；正常情况乐观序=服务端序，无跳变。
      qc.invalidateQueries({ queryKey: BOOKMARKS_KEY })
    },
  })
}

/**
 * 把 ids 的 category_id 乐观更新到目标值（onMutate 与拖动调用方共用）。
 * 拖动场景调用方需先于 unmarkExiting 手动调用：onMutate async（await cancelQueries 后才 setQueryData），
 * 若同步 unmarkExiting 会先于 setQueryData，卡片从 pop-out（opacity:0）闪回正常再卸载 → 闪一下。
 */
export function applyBatchMoveToCache(
  qc: QueryClient,
  ids: number[],
  categoryId: number | null,
) {
  const idSet = new Set(ids)
  qc.setQueryData<{ bookmarks: Bookmark[] }>(BOOKMARKS_KEY, (old) => {
    if (!old) return old
    return {
      ...old,
      bookmarks: old.bookmarks.map((b: Bookmark) =>
        idSet.has(b.id) ? { ...b, category_id: categoryId } : b,
      ),
    }
  })
}

/**
 * 批量移动后的统一反馈尾巴：成功 toast + 批量清选中，失败 toast。
 * 书签网格卡片落点、聚合分组落点、侧栏分类落点三处共用。
 */
export function notifyBatchMove(
  promise: Promise<unknown>,
  count: number,
  categoryName: string,
  isBatch: boolean,
  clearSelection: () => void,
  options?: { quiet?: boolean },
) {
  void promise
    .then(() => {
      // 同分类内排序不是跨分类移动：静默成功，只有真的换了分类才通知
      if (!options?.quiet) toast.success(`已移动 ${count} 个书签到「${categoryName}」`)
      if (isBatch) clearSelection()
    })
    .catch((error: Error) => toast.error('移动失败: ' + error.message))
}
