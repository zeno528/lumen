type SearchableBookmark = {
  id: number
  title: string
  description?: string
  url: string
  tags?: string[]
  category_id?: number | null
}

export function bookmarkMatchesSearch(
  bookmark: SearchableBookmark,
  categoryName: string | undefined,
  query: string,
  idSearchMode: boolean,
): boolean {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return true
  if (idSearchMode && /^\d+$/.test(normalized)) return String(bookmark.id) === normalized

  const idMatch = normalized.match(/^#(\d+)$/)
  if (idMatch) return String(bookmark.id) === idMatch[1]

  const fields = [bookmark.title, bookmark.description ?? '', bookmark.url, categoryName ?? '', ...(bookmark.tags ?? [])]
    .map((field) => field.toLowerCase())
  return normalized.split(/\s+/).every((term) => fields.some((field) => field.includes(term)))
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
