import type { CategoryFilter } from '@/stores/ui'

export type BookmarkRouteSearch = {
  category?: number
  view?: 'favorites' | 'uncategorized'
}

export function parseBookmarkSearch(search: Record<string, unknown>): BookmarkRouteSearch {
  const category = typeof search.category === 'string' ? Number(search.category) : search.category
  if (typeof category === 'number' && Number.isSafeInteger(category) && category > 0) return { category }
  if (search.view === 'favorites' || search.view === 'uncategorized') return { view: search.view }
  return {}
}

export function categoryFilterFromSearch(search: BookmarkRouteSearch): CategoryFilter {
  if (search.category != null) return search.category
  if (search.view === 'favorites') return '__favorites__'
  if (search.view === 'uncategorized') return '__uncategorized__'
  return 'all'
}

export function categoryFilterToSearch(category: CategoryFilter): BookmarkRouteSearch {
  if (typeof category === 'number') return { category }
  if (category === '__favorites__') return { view: 'favorites' }
  if (category === '__uncategorized__') return { view: 'uncategorized' }
  return {}
}
