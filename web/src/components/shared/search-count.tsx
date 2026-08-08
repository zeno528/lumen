/**
 * 搜索结果计数胶囊 —— 桌面顶栏搜索框 / 移动端搜索栏共用。
 * 视觉语言：复用 .bookmark-tag 胶囊样式（accent 橙底白字），保持项目"胶囊"标识一致。
 * 仅在 query 非空时显示。
 *
 * 过滤规则（与桌面端筛选同步）：
 * 1) idSearchMode 激活：q 为纯数字 → id 精确匹配；其他 → 子串模糊匹配
 *    （保留文本/标签搜索能力，不强锁）
 * 2) 始终兼容旧的 "#N" 写法：q 为 "#数字" → id 精确匹配
 * 3) 其余：title/description/url/tags 任一子串匹配
 * 搜索时分类筛选被忽略（bookmarks.tsx 的 q 分支），count 即"搜索匹配总数"。
 */
import { useBookmarks } from '@/hooks/useBookmarks'
import { useUIStore } from '@/stores/ui'

export function SearchCount() {
  const { data: bmData } = useBookmarks()
  const bookmarks = bmData?.bookmarks ?? []
  const query = useUIStore((s) => s.searchQuery)
  const idSearchMode = useUIStore((s) => s.idSearchMode)
  const q = query.toLowerCase().trim()
  if (!q) return null

  // idSearchMode：纯数字 → id 匹配；其他 → 走模糊
  if (idSearchMode) {
    const digits = q.match(/^\d+$/)
    if (digits) {
      const count = bookmarks.filter((b) => String(b.id) === q).length
      return <span className="bookmark-tag search-count">{count} 条</span>
    }
    // 非数字走模糊匹配（让 idSearchMode 不锁死，仍可搜文本）
  }
  // 兼容旧 "#数字" 精确匹配
  const hashMatch = q.match(/^#(\d+)$/)
  const count = hashMatch
    ? bookmarks.filter((b) => String(b.id) === hashMatch[1]).length
    : bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.description?.toLowerCase().includes(q) ?? false) ||
          b.url.toLowerCase().includes(q) ||
          (b.tags?.some((t) => t.toLowerCase().includes(q)) ?? false),
      ).length
  return <span className="bookmark-tag search-count">{count} 条</span>
}
