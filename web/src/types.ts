/** 后端数据类型（对齐 server/models.go，JSON 字段 snake_case）*/

export interface Bookmark {
  id: number
  url: string
  title: string
  description: string
  category_id: number | null
  tags: string[]
  favicon: string // list 接口返回空串，实际走 /api/bookmarks/{id}/favicon img
  favicon_version?: string // 只随图标内容变化；没有该字段时回退 updated_at（兼容旧接口）
  sort_order: number
  is_favorite: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: number
  name: string
  icon: string // FA 类名 fa-xxx，运行时映射到 Lucide（lib/icon-map）
  color: string
  sort_order: number
}

export interface BookmarksResponse {
  bookmarks: Bookmark[]
  total: number
}

export interface CategoriesResponse {
  categories: Category[]
}

/** 书签输入（创建/编辑）*/
export interface BookmarkInput {
  url: string
  title: string
  description?: string
  category_id?: number | null
  tags?: string[]
  favicon?: string
}

/** 分类输入（创建/编辑，对齐 server/models.go CategoryInput）*/
export interface CategoryInput {
  name: string
  icon?: string
  color?: string
}

/** API Token 列表项（脱敏，无明文，对齐 tokens.go handleListTokens）*/
export interface ApiToken {
  id: number
  name: string
  prefix: string
  suffix: string
  created_at: string
  last_used_at?: string
}

/** 创建 Token 响应（含明文，仅此一次返回）*/
export interface ApiTokenCreated {
  id: number
  name: string
  token: string
  prefix: string
  suffix: string
}

/** 批量操作结果（后端 bookmarks.go:496/551/634/706）*/
export interface BatchResult {
  ok: boolean
  deleted?: number
  moved?: number
  updated?: number
}
