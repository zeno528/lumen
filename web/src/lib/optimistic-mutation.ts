import type { QueryClient, UseMutationOptions } from '@tanstack/react-query'

/**
 * 乐观更新 mutation 工厂 —— 抽离 "cancel + get prev + apply + onError 回滚 + onSettled invalidate"
 * 的重复样板，支持：
 *   1. 单 query 缓存更新（如改书签）
 *   2. 多 query 联动更新（如删分类：categories + bookmarks 同时变）
 *   3. onOptimistic 副作用（如乐观删后立即清 localStorage favicon 缓存）
 *
 * 不覆盖的场景（保留各 hook 原写法）：
 *   - onSuccess 模式：useCreateBookmark / useCreateCategory 用后端真值 append，不走 onMutate
 *   - 业务例外不回滚：useReorderBookmarks / useReorderCategories（排序错位非致命）
 *   - 自定义 mutationFn 内联修改：useClearAllFavorites（并发 PATCH + 内联 setQueryData）
 */
type OptimisticTarget<TVars> = {
  queryKey: readonly unknown[]
  apply: (old: any, vars: TVars) => any
  /** onMutate 末尾的乐观阶段副作用（不等服务端响应）。如乐观删书签后清 localStorage favicon 缓存。 */
  onOptimistic?: (vars: TVars) => void
}

export function createOptimisticMutation<TVars>(
  qc: QueryClient,
  opts: {
    mutationFn: (vars: TVars) => Promise<unknown>
    targets: OptimisticTarget<TVars>[]
  },
): UseMutationOptions<unknown, Error, TVars, { prev: unknown[] }> {
  return {
    mutationFn: opts.mutationFn,
    onMutate: async (vars: TVars) => {
      // 1. 取消所有 target 进行中的 refetch，防止旧数据覆盖乐观更新（官方 onMutate 第一步）
      await Promise.all(
        opts.targets.map(({ queryKey }) => qc.cancelQueries({ queryKey })),
      )
      // 2. 抓所有 targets 的 prev（用于失败回滚）
      const prev = opts.targets.map(({ queryKey }) => qc.getQueryData(queryKey))
      // 3. 应用乐观更新
      opts.targets.forEach(({ queryKey, apply }, i) => {
        const next = apply(prev[i], vars)
        if (next !== undefined) qc.setQueryData(queryKey, next)
      })
      // 4. 跑乐观阶段副作用（不等服务端）
      opts.targets.forEach(({ onOptimistic }) => onOptimistic?.(vars))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      // 失败回滚：把 prev 写回
      if (!ctx) return
      opts.targets.forEach(({ queryKey }, i) => {
        if (ctx.prev[i] !== undefined) qc.setQueryData(queryKey, ctx.prev[i])
      })
    },
    onSettled: () => {
      // 无论成败都 invalidate 对账（让服务端是真相之源）
      opts.targets.forEach(({ queryKey }) => qc.invalidateQueries({ queryKey }))
    },
  }
}