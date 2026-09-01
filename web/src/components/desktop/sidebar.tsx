import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Layers,
  Star,
  Folder,
  Download,
  Upload,
  Plus,
  Pencil,
  Trash2,
  CheckSquare,
  X,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import {
  useCategories,
  useDeleteCategory,
  useBatchDeleteCategories,
  useReorderCategories,
} from '@/hooks/useCategories'
import {
  useBookmarks,
  useBatchDelete,
  useClearAllFavorites,
} from '@/hooks/useBookmarks'
import { resolveCategoryIcon } from '@/lib/icon-map'
import { useUIStore } from '@/stores/ui'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { ContextMenu, type MenuItem } from '@/components/ui/dropdown-menu'
import { CategoryDialog } from '@/components/shared/category-dialog'
import { CategoryDeleteDialog } from '@/components/shared/category-delete-dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ImportDialog } from '@/components/shared/import-dialog'
import { ExportDialog } from '@/components/shared/export-dialog'
import { SidebarItem } from '@/components/desktop/sidebar-item'
import type { Category } from '@/types'
import type { CategoryDeleteMode } from '@/api/categories'
import { getAggregatedCount, buildCategoryTree } from '@/lib/category-tree'
import { useDragStore } from '@/stores/drag'

/**
 * 侧边栏 —— logo（顶部）+ 分类列表 + 底部操作（导入/导出）。
 * - 分类列表：全部 / 收藏 / 未分类 / 各分类，每项带计数
 * - 标题分裂按钮：新建分类 / 批量管理分类
 * - 分类项右键：编辑 / 删除
 * - 删除分类：无书签直接删；有书签弹确认（保留书签 / 一并删除）
 * - 底部：导入/导出图标按钮；设置/主题/帮助/登出入口已移到顶栏头像下拉
 */
export function Sidebar({ open, onCategoryClick }: { open?: boolean; onCategoryClick?: () => void } = {}) {
  const { data: catData, isLoading } = useCategories()
  const { data: bmData, isLoading: bmLoading } = useBookmarks()
  const deleteCat = useDeleteCategory()
  const batchDelete = useBatchDelete()
  const batchDeleteCats = useBatchDeleteCategories()
  const reorderCategories = useReorderCategories()
  const clearFav = useClearAllFavorites()
  const {
    currentCategory,
    setCurrentCategory,
    categoryDialog,
    openCreateCategory,
    openEditCategory,
    closeCategoryDialog,
    categoryBatchMode,
    selectedCategoryIds,
    categoryAnchorId,
    exitCategoryBatchMode,
    toggleCategoryBatchMode,
    toggleCategorySelection,
    setCategoryAnchor,
    selectCategoryRange,
    clearCategorySelection,
    collapsedCategoryIds,
    toggleCategoryCollapsed,
    setCollapsedCategoryIds,
  } = useUIStore()
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  // 新建分类触发 pop-in 入场动画（isNew）。不设定时清除：pop-in 由 sidebar-item 的
  // onAnimationEnd 在 0.2s 自己移除 showPopIn；recentlyAddedCatId 残留最后新建的 id 无害
  // （下次新建设新 id，旧分类 isNew 自动变 false）。原 1s 定时器是多余死代码，已删。
  const [recentlyAddedCatId, setRecentlyAddedCatId] = useState<number | null>(null)
  const categories = catData?.categories ?? []
  const bookmarks = bmData?.bookmarks ?? []
  // 两级分类树：roots + 每个分类的子分类（子分类顺序沿用后端 sort_order 序）
  const tree = useMemo(() => buildCategoryTree(categories), [categories])
  const collapsedSet = useMemo(() => new Set(collapsedCategoryIds), [collapsedCategoryIds])
  // 一键收起/展开的目标：有子分类的父分类
  const collapsibleParentIds = useMemo(
    () => tree.roots.filter((c) => tree.childIds(c.id).length > 0).map((c) => c.id),
    [tree],
  )
  const allCollapsed =
    collapsibleParentIds.length > 0 && collapsibleParentIds.every((id) => collapsedSet.has(id))
  // 展开状态下的可见扁平顺序（Shift 范围批量选择用）
  const visibleCategoryIds = useMemo(
    () =>
      tree.roots.flatMap((c) => [c.id, ...(collapsedSet.has(c.id) ? [] : tree.childIds(c.id))]),
    [tree, collapsedSet],
  )
  // 分类列表过渡动画只在首次加载（刷新页面）播放，之后增删分类等任何情况都不触发
  // 一次 render 把所有项（含虚拟分类）一起挂上
  // 新项目 categories / bookmarks 是两个独立 useQuery，加载时序不同步：
  // 虚拟分类（收藏/未分类）依赖 counts → 依赖 bookmarks 数据，会晚于真实分类挂载
  // 修复：等两个 query 都加载完再挂 animate-enter + 启动 timer，模拟"同一次 render"语义
  const [catAnimate, setCatAnimate] = useState(true)
  useEffect(() => {
    if (catAnimate && categories.length > 0 && !bmLoading && bookmarks.length > 0) {
      // 等所有分类项错开动画播完（最后一项 delay + 0.3s 动画 + 缓冲），
      // 避免中途移除 animate-enter 导致 animation 中断抖动
      const total = (categories.length + 2) * 0.04 + 0.5 // +2 虚拟分类（收藏/未分类）
      const t = window.setTimeout(() => setCatAnimate(false), total * 1000)
      return () => window.clearTimeout(t)
    }
  }, [catAnimate, categories.length, bmLoading, bookmarks.length])

  // 分类右键菜单 + 删除确认目标。
  // 单一状态天然互斥：真实分类 / 收藏 / 未分类共用一个 state，不可能同时弹两个菜单
  const [catMenu, setCatMenu] = useState<
    | { kind: 'cat'; id: number; x: number; y: number }
    | { kind: 'fav'; x: number; y: number }
    | { kind: 'uncat'; x: number; y: number }
    | null
  >(null)

  const [confirmClearFavorites, setConfirmClearFavorites] = useState(false)
  const [confirmClearUncategorized, setConfirmClearUncategorized] = useState(false)
  const [confirmDeleteEmptyCats, setConfirmDeleteEmptyCats] = useState(false)
  const [confirmBatchDeleteCat, setConfirmBatchDeleteCat] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const catIds = new Set(categories.map((c) => c.id))
  const counts = {
    all: bookmarks.length,
    favorites: bookmarks.filter((b) => b.is_favorite).length,
    uncategorized: bookmarks.filter(
      (b) => b.category_id == null || !catIds.has(b.category_id),
    ).length,
  }
  // 展示计数：父分类聚合（自身 + 子分类）；子分类/顶级无子时等于直接计数
  const displayCount = (id: number) => getAggregatedCount(bookmarks, id, tree.childIds(id))
  const emptyCategoryIds = categories
    .filter((category) => displayCount(category.id) === 0)
    .map((category) => category.id)
  const lastDrop = useDragStore((state) => state.lastDrop)
  const handledDropToken = useRef<number | null>(null)

  useEffect(() => {
    if (
      !lastDrop ||
      lastDrop.token === handledDropToken.current ||
      lastDrop.source.kind !== 'category' ||
      lastDrop.target.kind !== 'category'
    ) return
    handledDropToken.current = lastDrop.token
    const { source, target } = lastDrop
    // 排序只在同级兄弟内（两级层级契约；跨级改父级走编辑对话框）
    if (tree.parentOf(source.id) !== tree.parentOf(target.id)) {
      toast.warning('只能在同级分类间排序')
      return
    }
    const run = async () => {
      try {
        await reorderCategories.mutateAsync({
          fromId: source.id,
          toId: target.id,
          position: target.action,
          sortIndex: target.sortIndex,
        })
      } catch (error) {
        toast.error('分类拖拽失败: ' + (error as Error).message)
      }
    }
    void run()
  }, [lastDrop, reorderCategories, tree])

  // 收藏/未分类出现走 pop-in 入场动画（isNew）；消失随计数归零直接移除，无退场动画
  // 虚拟分类用负数 id（-1 收藏 / -2 未分类）
  const [favIsNew, setFavIsNew] = useState(false)
  const [uncatIsNew, setUncatIsNew] = useState(false)
  const prevFavCount = useRef(counts.favorites)
  const prevUncatCount = useRef(counts.uncategorized)
  useEffect(() => {
    if (prevFavCount.current === 0 && counts.favorites > 0) {
      // 首次加载（catAnimate）期间：收藏随 animate-enter 一起 fadeInUp，不单独 pop-in
      // 否则收藏播 pop-in（scale）而普通分类播 fadeInUp（translate）→ 动画不统一
      if (catAnimate) {
        prevFavCount.current = counts.favorites
        return
      }
      setFavIsNew(true)
      const t = window.setTimeout(() => setFavIsNew(false), 1000)
      prevFavCount.current = counts.favorites
      return () => window.clearTimeout(t)
    }
    prevFavCount.current = counts.favorites
  }, [counts.favorites, catAnimate])
  useEffect(() => {
    if (prevUncatCount.current === 0 && counts.uncategorized > 0) {
      // 首次加载（catAnimate）期间：未分类随 animate-enter 一起 fadeInUp，不单独 pop-in
      if (catAnimate) {
        prevUncatCount.current = counts.uncategorized
        return
      }
      setUncatIsNew(true)
      const t = window.setTimeout(() => setUncatIsNew(false), 1000)
      prevUncatCount.current = counts.uncategorized
      return () => window.clearTimeout(t)
    }
    prevUncatCount.current = counts.uncategorized
  }, [counts.uncategorized, catAnimate])

  // 导入成功回调（由 ImportDialog 触发）：数据刷新由 ImportDialog 的 useMutation onSettled 接管，
  // 这里只切到「全部」视图让用户看到新书签
  const handleImported = () => {
    setCurrentCategory('all')
  }

  const menuCat = catMenu?.kind === 'cat' ? categories.find((c) => c.id === catMenu.id) : null
  const catMenuItems: MenuItem[] = menuCat
    ? [
        ...(menuCat.parent_id == null
          ? [
              {
                label: '新建子分类',
                icon: <Plus size={14} />,
                variant: 'edit' as const,
                onClick: () => openCreateCategory(menuCat.id),
              },
            ]
          : []),
        {
          label: '编辑',
          icon: <Pencil size={14} />,
          variant: 'edit',
          onClick: () => openEditCategory(menuCat.id),
        },
        {
          label: '删除',
          icon: <Trash2 size={14} />,
          variant: 'delete',
          onClick: () => handleDeleteClick(menuCat),
        },
      ]
    : []

  const favMenuItems: MenuItem[] = [
    {
      label: '全部取消收藏',
      icon: <Star size={14} />,
      variant: 'edit',
      onClick: () => setConfirmClearFavorites(true),
    },
  ]

  const uncatMenuItems: MenuItem[] = [
    {
      label: '清空未分类',
      icon: <Trash2 size={14} />,
      variant: 'delete',
      onClick: () => setConfirmClearUncategorized(true),
    },
  ]

  const menuItems: MenuItem[] =
    catMenu?.kind === 'cat' ? catMenuItems : catMenu?.kind === 'fav' ? favMenuItems : uncatMenuItems

  const onClearFavorites = async () => {
    // 乐观：useClearAllFavorites 已在 mutationFn 内同步把缓存里所有 is_favorite 翻 false（UI 秒变）。
    // 立即关确认框 + 立即弹通知（计数从当前缓存算），后台并发 PATCH；失败 mutationFn 内回滚 + 这里补错误通知。
    const favCount = bookmarks.filter((b) => b.is_favorite).length
    setConfirmClearFavorites(false)
    if (favCount > 0) toast.success(`已取消 ${favCount} 个收藏`)
    try {
      await clearFav.mutateAsync()
    } catch (e) {
      toast.error('取消收藏失败: ' + (e as Error).message)
    }
  }

  const onClearUncategorized = async () => {
    // 乐观：batchDelete.onMutate 立即 filter 掉这些书签（UI 秒变，未分类项随计数归零消失）。
    // 立即关确认框 + 立即弹通知，后台并发 DELETE；失败 batchDelete.onError 回滚 + 这里补错误通知。
    const ids = bookmarks
      .filter((b) => b.category_id == null || !catIds.has(b.category_id))
      .map((b) => b.id)
    setConfirmClearUncategorized(false)
    if (ids.length === 0) return
    toast.success(`已删除 ${ids.length} 个未分类书签`)
    try {
      await batchDelete.mutateAsync(ids)
    } catch (e) {
      toast.error('清空失败: ' + (e as Error).message)
    }
  }

  // 分类批量模式选择（对齐书签 handleCardSelect：Shift+点击 = 锚点到当前项的范围选择，对齐 Windows 资源管理器）
  const handleCategorySelect = (e: React.MouseEvent, id: number) => {
    if (e.shiftKey && categoryAnchorId != null) {
      if (visibleCategoryIds.includes(categoryAnchorId)) {
        selectCategoryRange(categoryAnchorId, id, visibleCategoryIds)
        return
      }
    }
    toggleCategorySelection(id)
    setCategoryAnchor(id)
  }

  // 批量删除分类（书签变未分类，乐观 + toast 同步弹）
  const onConfirmBatchDeleteCat = async () => {
    const ids = Array.from(selectedCategoryIds)
    setConfirmBatchDeleteCat(false)
    if (ids.length === 0) return
    toast.success(`已删除 ${ids.length} 个分类，书签已转为未分类`)
    try {
      await batchDeleteCats.mutateAsync(ids)
      exitCategoryBatchMode()
    } catch (e) {
      toast.error('批量删除失败: ' + (e as Error).message)
    }
  }

  const onConfirmDeleteEmptyCats = async () => {
    const ids = emptyCategoryIds
    setConfirmDeleteEmptyCats(false)
    if (ids.length === 0) return
    if (typeof currentCategory === 'number' && ids.includes(currentCategory)) {
      setCurrentCategory('all')
    }
    toast.success(`已删除 ${ids.length} 个空分类`)
    try {
      await batchDeleteCats.mutateAsync(ids)
    } catch (e) {
      toast.error('删除空分类失败: ' + (e as Error).message)
    }
  }

  // 删除入口：无书签直接删，有书签弹确认（父分类按聚合计数——子分类里也没书签才算空）
  const handleDeleteClick = (cat: Category) => {
    if (displayCount(cat.id) === 0) {
      // 无书签直接删：乐观删除（无退场动画）
      performDelete(cat, 'empty')
    } else {
      setDeleteTarget(cat)
    }
  }

  /** 删除分类（乐观，无退场动画）。 */
  const performDelete = async (
    cat: Category,
    mode: 'empty' | CategoryDeleteMode,
  ) => {
    toast.success(
      mode === 'keep' ? `分类"${cat.name}"已删除，书签已保留`
        : mode === 'all' ? `分类"${cat.name}"及相关书签已删除`
        : `分类"${cat.name}"已删除`,
    )
    if (currentCategory === cat.id) setCurrentCategory('all')
    try {
      await deleteCat.mutateAsync({ id: cat.id, mode: mode === 'empty' ? 'keep' : mode })
    } catch (e) {
      toast.error('删除失败: ' + (e as Error).message)
      return
    }
  }

  const onConfirmDelete = async (mode: CategoryDeleteMode) => {
    const cat = deleteTarget
    if (!cat) return
    setDeleteTarget(null)
    await performDelete(cat, mode)
  }

  const editingCategory =
    categoryDialog && categoryDialog !== 'create'
      ? (categories.find((c) => c.id === categoryDialog) ?? null)
      : null

  /** 选中分类。 */
  const selectCategory = (cat: typeof currentCategory) => {
    setCurrentCategory(cat)
    setCatMenu(null)
    onCategoryClick?.()
  }

  // 分类项入场动画错开
  // 仅 catAnimate（刷新首次加载）时生成 delay；之后传 undefined，animate-enter 已移除也不触发
  let staggerIdx = 0
  const staggerStyle = (): CSSProperties | undefined =>
    catAnimate ? { animationDelay: `${staggerIdx++ * 0.04}s` } : undefined

  const renderCategory = (c: Category, index: number, parentId: number | null): React.ReactNode => {
    const Icon = resolveCategoryIcon(c.icon)
    const children = tree.childrenOf(c.id)
    const expanded = !collapsedSet.has(c.id)
    return (
      <Fragment key={c.id}>
        <SidebarItem
          style={staggerStyle()}
          category={c}
          parentId={parentId}
          dragEnabled={!categoryBatchMode}
          index={index}
          group={parentId == null ? 'categories:root' : `categories:child:${parentId}`}
          iconColor={c.color || 'var(--default-category-color)'}
          icon={<Icon size={14} style={{ color: c.color || 'var(--default-category-color)' }} />}
          label={c.name}
          count={displayCount(c.id)}
          active={currentCategory === c.id}
          onClick={() => {
            selectCategory(c.id)
          }}
          onContext={(e) => setCatMenu({ kind: 'cat', id: c.id, x: e.clientX, y: e.clientY })}
          isNew={c.id === recentlyAddedCatId}
          selected={categoryBatchMode && selectedCategoryIds.has(c.id)}
          onSelect={categoryBatchMode ? handleCategorySelect : undefined}
          nested={parentId != null}
          hasChildren={children.length > 0}
          expanded={expanded}
          onToggleExpand={() => toggleCategoryCollapsed(c.id)}
        />
        {children.length > 0 && expanded && (
          children.map((child, i) => renderCategory(child, i, c.id))
        )}
      </Fragment>
    )
  }

  return (
    /* liquid-glass 已去掉：backdrop-filter saturate(180%) 会把 panel 暖色拉到冷青调，
       跟 body panel 暖米色不一致，main 圆角塌角透出来形成"小三角"色差 */
    <aside
      className={cn('sidebar', open && 'open')}
    >
      {/* Logo —— 侧栏顶部 */}
      <button
        type="button"
        className="logo"
        onClick={() => document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="返回顶部"
        title="返回顶部"
      >
        <img src="/logo_color.svg" alt="Lumen" />
        <h3>Lumen</h3>
      </button>
      <div className="sidebar-title">
        <span>分类（{categories.length}）</span>
        <div className="sidebar-category-actions">
          <button
            type="button"
            className="sidebar-add-btn"
            onClick={() => openCreateCategory()}
            aria-label="新建分类"
            title="新建分类（Ctrl+Shift+I）"
          >
            <Plus size={12} strokeWidth={3} />
            <span>新建</span>
          </button>
          <button
            type="button"
            className={cn('sidebar-category-batch-btn', categoryBatchMode && 'active')}
            onClick={toggleCategoryBatchMode}
            aria-label={categoryBatchMode ? '退出批量选择分类' : '批量选择分类'}
            aria-pressed={categoryBatchMode}
            title={categoryBatchMode ? '退出批量选择' : '批量选择分类'}
          >
            <CheckSquare size={13} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="sidebar-category-batch-btn"
            disabled={collapsibleParentIds.length === 0}
            onClick={() => setCollapsedCategoryIds(allCollapsed ? [] : collapsibleParentIds)}
            aria-label={allCollapsed ? '一键展开分类' : '一键收起分类'}
            title={allCollapsed ? '一键展开分类' : '一键收起分类'}
          >
            {allCollapsed ? (
              <ChevronsUpDown size={13} strokeWidth={2.4} />
            ) : (
              <ChevronsDownUp size={13} strokeWidth={2.4} />
            )}
          </button>
          <button
            type="button"
            className="sidebar-category-batch-btn"
            disabled={emptyCategoryIds.length === 0 || categoryBatchMode}
            onClick={() => setConfirmDeleteEmptyCats(true)}
            aria-label="删除空分类"
            title={
              emptyCategoryIds.length > 0
                ? `删除 ${emptyCategoryIds.length} 个空分类`
                : '没有空分类'
            }
          >
            <Trash2 size={13} strokeWidth={2.4} />
          </button>
        </div>
      </div>
      {bmLoading && (
        <div className="flex items-center justify-center py-10">
          <div className="size-6 animate-spin rounded-full border-[2.5px] border-[var(--text-muted)] border-t-transparent opacity-40" />
        </div>
      )}
      <div
        className={cn(
          'sidebar-categories',
          catAnimate && !bmLoading && bookmarks.length > 0 && 'animate-enter',
        )}
        style={bmLoading || bookmarks.length === 0 ? { opacity: 0 } : undefined}
      >
        <SidebarItem
          style={staggerStyle()}
          iconColor="var(--icon-all)"
          icon={<Layers size={14} style={{ color: 'var(--icon-all)' }} />}
          label="全部"
          count={counts.all}
          active={currentCategory === 'all'}
          onClick={() => selectCategory('all')}
        />
        {counts.favorites > 0 && (
          <SidebarItem
            style={staggerStyle()}
            isNew={favIsNew}
            iconColor="var(--favorite-star)"
            icon={<Star size={14} style={{ color: 'var(--favorite-star)', fill: 'var(--favorite-star)' }} />}
            label="收藏"
            count={counts.favorites}
            active={currentCategory === '__favorites__'}
            onClick={() => selectCategory('__favorites__')}
            onContext={(e) => setCatMenu({ kind: 'fav', x: e.clientX, y: e.clientY })}
          />
        )}
        {counts.uncategorized > 0 && (
          <SidebarItem
            style={staggerStyle()}
            isNew={uncatIsNew}
            iconColor="var(--icon-uncategorized)"
            icon={<Folder size={14} style={{ color: 'var(--icon-uncategorized)', fill: 'var(--icon-uncategorized)' }} />}
            label="未分类"
            count={counts.uncategorized}
            active={currentCategory === '__uncategorized__'}
            onClick={() => selectCategory('__uncategorized__')}
            onContext={(e) => setCatMenu({ kind: 'uncat', x: e.clientX, y: e.clientY })}
          />
        )}
        {!isLoading && tree.roots.map((c, i) => renderCategory(c, i, null))}
      </div>

      {/* 分类批量操作栏（批量模式时显示）*/}
      {categoryBatchMode && (
        <div className="category-batch-bar">
          <span className="batch-count">
            <CheckSquare size={14} /> {selectedCategoryIds.size}
          </span>
          <button
            className="batch-btn"
            disabled={selectedCategoryIds.size === 0}
            onClick={() => clearCategorySelection()}
            title="取消选中"
          >
            取消选中
          </button>
          <button
            className="batch-btn btn-batch-delete"
            disabled={selectedCategoryIds.size === 0}
            onClick={() => setConfirmBatchDeleteCat(true)}
            title="删除选中分类"
          >
            <Trash2 size={14} /> 删除
          </button>
          <button className="batch-btn" onClick={exitCategoryBatchMode} title="退出批量">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 底部：导入/导出（设置入口已移到顶栏头像下拉）*/}
      <div className="sidebar-bottom">
        <div className="sidebar-bottom-actions">
          <button className="sidebar-bottom-icon" onClick={() => setImportDialogOpen(true)}>
            <Download size={14} strokeWidth={2.5} />
            <span>导入</span>
          </button>
          <button className="sidebar-bottom-icon" onClick={() => setExportDialogOpen(true)}>
            <Upload size={14} strokeWidth={2.5} />
            <span>导出</span>
          </button>
        </div>
      </div>
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImported={handleImported}
      />
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
      />

      {/* 分类右键菜单（真实分类 / 收藏 / 未分类）*/}
      <ContextMenu
        open={!!catMenu}
        onClose={() => setCatMenu(null)}
        x={catMenu?.x ?? 0}
        y={catMenu?.y ?? 0}
        items={menuItems}
      />

      {/* 全部取消收藏确认 */}
      <ConfirmDialog
        open={confirmClearFavorites}
        onClose={() => setConfirmClearFavorites(false)}
        onConfirm={onClearFavorites}
        title="全部取消收藏"
        message={`确定取消全部 ${counts.favorites} 个收藏吗？`}
        confirmText="确认取消"
        danger={false}
      />

      {/* 批量删除分类确认 */}
      <ConfirmDialog
        open={confirmBatchDeleteCat}
        onClose={() => setConfirmBatchDeleteCat(false)}
        onConfirm={onConfirmBatchDeleteCat}
        title="批量删除分类"
        message={`确定删除选中的 ${selectedCategoryIds.size} 个分类吗？其下书签将变为未分类。`}
        confirmText="确认删除"
        danger
      />

      {/* 删除空分类确认 */}
      <ConfirmDialog
        open={confirmDeleteEmptyCats}
        onClose={() => setConfirmDeleteEmptyCats(false)}
        onConfirm={onConfirmDeleteEmptyCats}
        title="删除空分类"
        message={
          <>
            确定删除全部 <strong className="font-semibold text-(--accent)">{emptyCategoryIds.length}</strong> 个空分类吗？
            <span className="text-(--text-muted)">这些分类没有书签，不会影响任何书签。</span>
          </>
        }
        confirmText="确认删除"
        danger
      />

      {/* 清空未分类确认 */}
      <ConfirmDialog
        open={confirmClearUncategorized}
        onClose={() => setConfirmClearUncategorized(false)}
        onConfirm={onClearUncategorized}
        title="清空未分类"
        message={
          <>
            确定删除全部 <strong className="font-semibold text-(--accent)">{counts.uncategorized}</strong> 个未分类书签吗？
            <span className="text-(--destructive)">此操作不可恢复。</span>
          </>
        }
        confirmText="确认删除"
        danger
      />

      {/* 分类新增/编辑 */}
      <CategoryDialog
        open={categoryDialog !== null}
        onClose={() => {
          closeCategoryDialog()
        }}
        editingCategory={editingCategory}
        onCreated={(id) => setRecentlyAddedCatId(id)}
      />

      {/* 分类删除确认（仅有书签时显示）*/}
      <CategoryDeleteDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        category={deleteTarget}
        count={deleteTarget ? displayCount(deleteTarget.id) : 0}
        onConfirm={onConfirmDelete}
      />
    </aside>
  )
}
