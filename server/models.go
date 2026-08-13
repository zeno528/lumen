package main

// Category 分类
type Category struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Color     string `json:"color"`
	SortOrder int    `json:"sort_order"`
	ParentID  *int64 `json:"parent_id"`
}

// CategoryInput 分类输入
type CategoryInput struct {
	Name     string `json:"name"`
	Icon     string `json:"icon,omitempty"`
	Color    string `json:"color,omitempty"`
	ParentID *int64 `json:"parent_id,omitempty"`
}

// Bookmark 书签
type Bookmark struct {
	ID          int64    `json:"id"`
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	CategoryID  *int64   `json:"category_id"`
	Tags        []string `json:"tags"`
	Favicon     string   `json:"favicon"`
	HasFavicon  bool     `json:"has_favicon"` // 列表 API 不返回 dataURI（防膨胀），用此布尔值表明图标是否存在
	SortOrder   int      `json:"sort_order"`
	IsFavorite  bool     `json:"is_favorite"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

// BookmarkInput 书签输入
type BookmarkInput struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	CategoryID  *int64   `json:"category_id,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Favicon     string   `json:"favicon,omitempty"`
}

// ReorderInput 排序输入
type ReorderInput struct {
	Order []int64 `json:"order"`
}

// BatchDeleteInput 批量删除输入
type BatchDeleteInput struct {
	IDs []int64 `json:"ids"`
}

// BatchMoveInput 批量移动分类输入
type BatchMoveInput struct {
	IDs        []int64 `json:"ids"`
	CategoryID *int64  `json:"category_id"` // null = 移除分类
}

// BatchTagsInput 批量添加标签输入
type BatchTagsInput struct {
	IDs  []int64  `json:"ids"`
	Tags []string `json:"tags"`
}

// MergeCategoriesInput 合并分类输入
type MergeCategoriesInput struct {
	SourceIDs []int64 `json:"source_ids"`
	TargetID  int64   `json:"target_id"`
}

// BookmarkUpdate 单个书签的部分更新字段
type BookmarkUpdate struct {
	ID          int64   `json:"id"`
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Favicon     *string `json:"favicon,omitempty"`
}

// BatchUpdateInput 批量更新书签输入
type BatchUpdateInput struct {
	Updates []BookmarkUpdate `json:"updates"`
}
