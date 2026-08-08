import { api } from './client'
import { fetchFaviconDataUri } from '@/lib/favicon'
import type { Bookmark, BookmarksResponse, BookmarkInput, BatchResult } from '@/types'

/**
 * 书签 API —— 对齐后端 bookmarks.go。
 *
 * 列表策略：全量拉 limit=10000，
 * 搜索/分类/收藏/未分类筛选全部在前端 useMemo 做（后端不支持 favorite 筛选，
 * 且前端过滤才能统一支持搜索高亮、#ID 搜索、未分类虚拟项）。
 */

/** 全量拉书签（前端过滤用）*/
export function getBookmarks(): Promise<BookmarksResponse> {
  return api('/bookmarks?limit=10000')
}

export function createBookmark(input: BookmarkInput): Promise<{ bookmark: Bookmark }> {
  return api('/bookmarks', { method: 'POST', body: JSON.stringify(input) })
}

/** 部分更新（后端按请求体出现的字段覆盖，没传的保留原值，bookmarks.go:251）*/
export function updateBookmark(
  id: number,
  input: Partial<BookmarkInput>,
): Promise<{ ok: boolean; updated_at: string }> {
  return api(`/bookmarks/${id}`, { method: 'PUT', body: JSON.stringify(input) })
}

/**
 * 刷新书签图标。
 * 抓 favicon 转 data URI → PUT 更新 DB → 返回 dataUri 供调用方直接显示（立即可见、不依赖 favicon 端点重新拉取）。
 * @throws 空白/未找到/中断
 * @returns dataUri 抓取并保存成功的 data URI
 */
export async function refreshBookmarkFavicon(
  id: number,
  url: string,
  signal?: AbortSignal,
): Promise<{ dataUri: string; updatedAt: string }> {
  const dataUri = await fetchFaviconDataUri(url, signal)
  if (!dataUri) throw new Error('该网站图标为空白或未找到')
  const res = await api<{ ok: boolean; updated_at: string }>(`/bookmarks/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ favicon: dataUri }),
  })
  return { dataUri, updatedAt: res.updated_at }
}

export function deleteBookmark(id: number): Promise<{ ok: boolean }> {
  return api(`/bookmarks/${id}`, { method: 'DELETE' })
}

/** 切换收藏（后端原子取反，返回新状态，bookmarks.go:719）*/
export function toggleFavorite(id: number): Promise<{ is_favorite: boolean }> {
  return api(`/bookmarks/${id}/favorite`, { method: 'PATCH' })
}

/** favicon 公开端点（无需鉴权），用 updatedAt 作版本号避免缓存旧图标 */
export function faviconUrl(id: number, updatedAt?: string): string {
  const v = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ''
  return `/api/bookmarks/${id}/favicon${v}`
}

// ===== 批量操作（后端 bookmarks.go:452-798，单次上限 500）=====

export function batchDeleteBookmarks(ids: number[]): Promise<BatchResult> {
  return api('/bookmarks/batch', { method: 'DELETE', body: JSON.stringify({ ids }) })
}

/** 移动到目标分类；category_id 为 null 表示移除分类（不归类）*/
export function batchMoveBookmarks(
  ids: number[],
  categoryId: number | null,
): Promise<BatchResult> {
  return api('/bookmarks/batch-move', {
    method: 'PUT',
    body: JSON.stringify({ ids, category_id: categoryId }),
  })
}

export function batchAddTags(ids: number[], tags: string[]): Promise<BatchResult> {
  return api('/bookmarks/batch-tags', {
    method: 'PUT',
    body: JSON.stringify({ ids, tags }),
  })
}


/** 重排书签顺序（PUT /api/bookmarks/reorder，body {order:[ids]}，bookmarks.go:417）*/
export function reorderBookmarks(order: number[]): Promise<{ ok: boolean }> {
  return api('/bookmarks/reorder', { method: 'PUT', body: JSON.stringify({ order }) })
}
