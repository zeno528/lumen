/**
 * WebSocket 实时同步 —— 类型与资源映射表。
 *
 * 后端广播 `{type:'invalidate', resources:[...]}`，前端按 resource 名查表得到
 * TanStack Query 的 queryKey 前缀，调用 `qc.invalidateQueries({queryKey})` 触发 refetch。
 *
 * resource 名必须与后端 `broadcastInvalidated(...)` 实参**精确对齐**——typo 会静默失效。
 */
export interface WSInvalidateMessage {
  type: 'invalidate'
  resources: string[]
  ts?: number
}

/**
 * 后端广播 resource → 前端 query key 前缀。
 *
 * 对齐来源：
 * - `bookmarks`     → useBookmarks.ts:19
 * - `categories`    → useCategories.ts:14
 * - `auth-nickname` → account-section.tsx:36
 * - `auth-avatar`   → use-avatar.ts:4 (AVATAR_KEY)
 * - `ai-settings`   → ai-section.tsx:39
 */
export const RESOURCE_TO_QUERY_KEY: Record<string, readonly unknown[]> = {
  bookmarks: ['bookmarks'],
  categories: ['categories'],
  'auth-nickname': ['auth-nickname'],
  'auth-avatar': ['auth-avatar'],
  'ai-settings': ['ai-settings'],
}

/** onopen 时全量 invalidate（离线补齐）。 */
export const ALL_SYNCED_RESOURCES = Object.keys(RESOURCE_TO_QUERY_KEY)
