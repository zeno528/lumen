import { useCallback } from 'react'
import { useUIStore } from '@/stores/ui'

/**
 * 进出场动画 hook。
 *
 * 原实现是命令式 DOM：`ItemAnim.leave(el, onDone)` 加 `.pop-out` class，
 * `animationend` 回调里 `el.remove()` 真正移除 DOM。所以 pop-out 能播完。
 *
 * React 状态驱动下，删数据 → React 立即卸载 DOM → pop-out 没机会播。
 * 本 hook 解决这个矛盾：用 `exitingXxxIds` Set 标记"正在退出"的 id，
 * 卡片挂 `.pop-out` 但仍渲染（数据还没删）；`onAnimationEnd` 触发真正删除。
 *
 * 这是 react-transition-group / Framer Motion 退出动画的标准模式（ExitTimeout）。
 *
 * 用法（删除路径）：
 * 1. 点删除 → `markXxxExiting(id)` 标记（卡片挂 pop-out，数据不动）
 * 2. 卡片 `onAnimationEnd` → 调用方真正删数据（mutate）+ `unmarkXxxExiting(id)`
 * 3. 数据删除后 React 卸载 DOM；失败则 unmarkXxxExiting 让卡片留在原地
 *
 * **为什么 cat 和 bm 两组函数必须分开存在**：
 * 早期版本两者共用一份 `exitingIds: Set<number>`，期望"调用方各自只看自己类型"。
 * 但读侧 `isExiting = (id) => exitingIds.has(id)` 不区分类型，当书签 id 与分类 id
 * 数值撞车时（生产环境书签 id 增长后会撞上分类 id），侧栏分类 / 书签卡片会被对方动画
 * 误伤永久卡在 opacity:0。修复：cat / bm 两套函数物理隔离，命名上让"撞车"在调用方
 * 写代码时就显形（不要试图"瘦身"回单 Set）。
 *
 * 跨组件共享：sidebar 调 `markBookmarkExiting(bookmark.id)` 后，bookmarks.tsx 里
 * `isBookmarkExiting(b.id)` 同步可见 —— 这正是把 state 提到 useUIStore 的初衷。
 */
export function useAnimatedExit() {
  const exitingCategoryIds = useUIStore((s) => s.exitingCategoryIds)
  const exitingBookmarkIds = useUIStore((s) => s.exitingBookmarkIds)
  const markCategoryExitingGlobal = useUIStore((s) => s.markCategoryExitingGlobal)
  const unmarkCategoryExitingGlobal = useUIStore((s) => s.unmarkCategoryExitingGlobal)
  const markBookmarkExitingGlobal = useUIStore((s) => s.markBookmarkExitingGlobal)
  const unmarkBookmarkExitingGlobal = useUIStore((s) => s.unmarkBookmarkExitingGlobal)

  /** 判断某分类 id 是否正在退出（侧栏分类项据此挂 pop-out）*/
  const isCategoryExiting = useCallback(
    (id: number) => exitingCategoryIds.has(id),
    [exitingCategoryIds],
  )
  /** 判断某书签 id 是否正在退出（书签卡片据此挂 pop-out）*/
  const isBookmarkExiting = useCallback(
    (id: number) => exitingBookmarkIds.has(id),
    [exitingBookmarkIds],
  )

  return {
    markCategoryExiting: markCategoryExitingGlobal,
    unmarkCategoryExiting: unmarkCategoryExitingGlobal,
    isCategoryExiting,
    markBookmarkExiting: markBookmarkExitingGlobal,
    unmarkBookmarkExiting: unmarkBookmarkExitingGlobal,
    isBookmarkExiting,
  }
}