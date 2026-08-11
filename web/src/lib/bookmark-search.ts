type SearchableBookmark = {
  id: number
  title: string
  description?: string
  url: string
  tags?: string[]
  category_id?: number | null
}

/** 拆词：空格分隔 + 中英文/数字边界（git 下载、git下载、下载git 都得到 [git, 下载]）*/
function splitTerms(normalized: string): string[] {
  return normalized.match(/[a-z0-9.]+|[\u4e00-\u9fff]+/g) ?? []
}

/** 解析 ID 搜索目标：ID 模式纯数字或 #N；非 ID 查询返回 null（回车直达 / 匹配共用） */
export function getIdFromQuery(query: string, idSearchMode: boolean): number | null {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return null
  if (idSearchMode && /^\d+$/.test(normalized)) return Number(normalized)
  const idMatch = normalized.match(/^#(\d+)$/)
  if (idMatch) return Number(idMatch[1])
  return null
}

export function bookmarkMatchesSearch(
  bookmark: SearchableBookmark,
  categoryName: string | undefined,
  query: string,
  idSearchMode: boolean,
): boolean {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return true
  const targetId = getIdFromQuery(normalized, idSearchMode)
  if (targetId != null) return bookmark.id === targetId

  const fields = [bookmark.title, bookmark.description ?? '', bookmark.url, categoryName ?? '', ...(bookmark.tags ?? [])]
    .map((field) => field.toLowerCase())
  return splitTerms(normalized).every((term) => fields.some((field) => field.includes(term)))
}

export function filterBookmarksBySearch<T extends SearchableBookmark>(
  bookmarks: T[],
  categoryNames: Map<number, string>,
  query: string,
  idSearchMode: boolean,
): T[] {
  return bookmarks.filter((bookmark) =>
    bookmarkMatchesSearch(bookmark, bookmark.category_id != null ? categoryNames.get(bookmark.category_id) : undefined, query, idSearchMode),
  )
}
