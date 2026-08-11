/**
 * 搜索结果计数胶囊 —— 桌面顶栏搜索框 / 移动端搜索栏共用。
 * 视觉语言：复用 .bookmark-tag 胶囊样式（accent 橙底白字），保持项目"胶囊"标识一致。
 * 仅在 query 非空时显示。
 *
 * 过滤规则（与桌面端筛选同步）：
 * 1) idSearchMode 激活：q 为纯数字 → id 精确匹配；其他继续走文本搜索。
 * 2) 始终兼容旧的 "#N" 写法：q 为 "#数字" → id 精确匹配。
 * 3) 其余按空白或中英文边界分词（git下载 与 git 下载 等价）；每个词都必须命中
 *    title、description、url、tags 或分类名之一，词可分布在不同字段。
 * 搜索时分类筛选被忽略（bookmarks.tsx 的 q 分支），count 即"搜索匹配总数"。
 */
import { useBookmarks } from '@/hooks/useBookmarks'
import { useCategories } from '@/hooks/useCategories'
import { filterBookmarksBySearch } from '@/lib/bookmark-search'
import { useUIStore } from '@/stores/ui'

export function SearchCount() {
  const { data: bmData } = useBookmarks()
  const { data: catData } = useCategories()
  const bookmarks = bmData?.bookmarks ?? []
  const categoryNames = new Map((catData?.categories ?? []).map((category) => [category.id, category.name]))
  const query = useUIStore((s) => s.searchQuery)
  const idSearchMode = useUIStore((s) => s.idSearchMode)
  const q = query.toLowerCase().trim()
  if (!q) return null

  const count = filterBookmarksBySearch(bookmarks, categoryNames, q, idSearchMode).length
  return <span className="bookmark-tag search-count">{count} 条</span>
}
