import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Layers,
  Star,
  Folder,
  Download,
  Upload,
  Plus,
  Pencil,
  Trash2,
  Copy,
  CheckSquare,
  X,
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
  useBatchMove,
  useClearAllFavorites,
  applyBatchMoveToCache,
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

/**
 * 拖拽 MIME 类型。
 * 用专属 MIME 类型区分"书签拖到分类"和"分类之间排序"，避免共用 text/plain 派发模糊。
 * 拖拽视觉与"被拖分类 id"在 SidebarItem 内 / Sidebar state 管理，见 sidebar-item.tsx。
 */
const DRAG_TYPE_BOOKMARK = 'application/x-bookmark-id'
const DRAG_TYPE_CATEGORY = 'application/x-category-id'

/**
 * 侧边栏 —— logo（顶部）+ 分类列表 + 底部操作（导入/导出）。
 * - 分类列表：全部 / 收藏 / 未分类 / 各分类，每项带计数
 * - 标题"+"按钮新建分类
 * - 分类项右键：编辑 / 删除 / 复制 ID
 * - 删除分类：无书签直接删；有书签弹确认（保留书签 / 一并删除）
 * - 底部：导入/导出图标按钮；设置/主题/帮助/登出入口已移到顶栏头像下拉
 */
export function Sidebar({ open, onCategoryClick }: { open?: boolean; onCategoryClick?: () => void } = {}) {
  const qc = useQueryClient()
  const { data: catData, isLoading } = useCategories()
  const { data: bmData, isLoading: bmLoading } = useBookmarks()
  const deleteCat = useDeleteCategory()
  const batchDelete = useBatchDelete()
  const batchDeleteCats = useBatchDeleteCategories()
  const reorderCats = useReorderCategories()
  const batchMove = useBatchMove()
  const clearFav = useClearAllFavorites()
  const {
    currentCategory,
    setCurrentCategory,
    categoryDialog,
    openCreateCategory,
    openEditCategory,
    closeCategoryDialog,
    selectedIds,
    clearSelection,
    categoryBatchMode,
    selectedCategoryIds,
    categoryAnchorId,
    enterCategoryBatchMode,
    exitCategoryBatchMode,
    toggleCategorySelection,
    setCategoryAnchor,
    selectCategoryRange,
    clearCategorySelection,
  } = useUIStore()
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  // 新建分类触发 pop-in 入场动画（isNew）。不设定时清除：pop-in 由 sidebar-item 的
  // onAnimationEnd 在 0.2s 自己移除 showPopIn；recentlyAddedCatId 残留最后新建的 id 无害
  // （下次新建设新 id，旧分类 isNew 自动变 false）。原 1s 定时器是多余死代码，已删。
  const [recentlyAddedCatId, setRecentlyAddedCatId] = useState<number | null>(null)
  const categories = catData?.categories ?? []
  const bookmarks = bmData?.bookmarks ?? []
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
  const countByCat = (id: number) => bookmarks.filter((b) => b.category_id === id).length

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
        {
          label: '编辑',
          icon: <Pencil size={14} />,
          variant: 'edit',
          onClick: () => openEditCategory(menuCat.id),
        },
        {
          label: '复制ID',
          icon: <Copy size={14} />,
          onClick: () => {
            navigator.clipboard.writeText(`分类ID: ${menuCat.id}`)
            toast.success('已复制')
          },
        },
        {
          label: '批量删除',
          icon: <Trash2 size={14} />,
          onClick: () => enterCategoryBatchMode(menuCat.id),
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
      const orderedIds = categories.map((c) => c.id)
      if (orderedIds.includes(categoryAnchorId)) {
        selectCategoryRange(categoryAnchorId, id, orderedIds)
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

  // 删除入口：无书签直接删，有书签弹确认
  const handleDeleteClick = (cat: Category) => {
    if (countByCat(cat.id) === 0) {
      // 无书签直接删：乐观删除（无退场动画）
      performDelete(cat, 'empty')
    } else {
      setDeleteTarget(cat)
    }
  }

  /**
   * 删除分类（乐观，无退场动画）：
   * - deleteCat.onMutate 立即从 categories 缓存移除 -> 后续分类瞬间补位
   * - 书签按 bookmarkMode 处理：'keep' 降级未分类 / 'remove' 连书签删（mode='all'）
   * - 失败由 deleteCat.onError 回滚 categories + bookmarks 缓存
   *
   * mode:
   * - 'empty'：无书签直接删（handleDeleteClick，countByCat(cat.id)===0）
   * - 'keep'：删除分类但保留书签变未分类（CategoryDeleteDialog 确认）
   * - 'all'：一并删除该分类下书签再删分类（CategoryDeleteDialog 一并删除）
   */
  const performDelete = async (
    cat: Category,
    mode: 'empty' | 'keep' | 'all',
  ) => {
    // mode='all' 要删的书签 id 必须在 deleteCat 之前算好：deleteCat.onMutate（bookmarkMode='remove'）
    // 会 filter 掉该分类书签，之后 filter(b => b.category_id === cat.id) 会得空数组。
    const bookmarkIds =
      mode === 'all' ? bookmarks.filter((b) => b.category_id === cat.id).map((b) => b.id) : []
    toast.success(
      mode === 'keep' ? `分类"${cat.name}"已删除，书签已保留`
        : mode === 'all' ? `分类"${cat.name}"及相关书签已删除`
        : `分类"${cat.name}"已删除`,
    )
    if (currentCategory === cat.id) setCurrentCategory('all')
    try {
      // 分类先乐观删除：deleteCat.onMutate 立即从 categories 缓存移除 -> 后续分类瞬间补位。
      // ⚠️ 不能 await batchDelete 之后再删分类--那会让补位等书签删除的网络往返。
      // 书签删除改为后台并行，不阻塞补位。
      await deleteCat.mutateAsync({ id: cat.id, bookmarkMode: mode === 'all' ? 'remove' : 'keep' })
    } catch (e) {
      toast.error('删除失败: ' + (e as Error).message)
      return
    }
    // 书签后台删除（不阻塞分类补位）。分类已删无法回退；若失败，书签因后端 ON DELETE SET NULL
    // 已降级为未分类，batchDelete.onError 会把它们恢复显示到未分类列表，用户可再试，数据不丢。
    if (bookmarkIds.length) {
      batchDelete.mutateAsync(bookmarkIds).catch((e) => {
        toast.error(`${bookmarkIds.length} 个书签删除失败，已转为未分类: ` + (e as Error).message)
      })
    }
  }

  // 确认删除：保留书签(变未分类) / 一并删除(连书签删)
  const onConfirmDelete = async (keepBookmarks: boolean) => {
    const cat = deleteTarget
    if (!cat) return
    setDeleteTarget(null)
    await performDelete(cat, keepBookmarks ? 'keep' : 'all')
  }

  const editingCategory =
    categoryDialog && categoryDialog !== 'create'
      ? (categories.find((c) => c.id === categoryDialog) ?? null)
      : null

  // ===== 分类拖拽 =====
  // draggedCatId 提升 到 Sidebar state，通过 props 传给 SidebarItem；
  // SidebarItem 本地管 dragOver。拖拽期间 Sidebar 不重渲染（drop 才 setState），
  // SidebarItem 挂载稳定，HTML5 DnD 不会被打断。
  const [draggedCatId, setDraggedCatId] = useState<number | null>(null)

  /**
   * 分类 drop 派发。
   * 书签拖入 → 移动分类；分类之间拖动 → 排序。
   * position 由 SidebarItem 按 drop 瞬间鼠标位置计算（中线为界，'before' | 'after'），
   * 解决"只能往上拖"问题：纯 HTML5 DnD 的 drop 命中点是光标下元素，固定 before 会让往下拖时
   * 落点命中下方目标但被拖项仍要插到它前面（视觉位移极小），用户感觉"没反应"。
   */
  const onCategoryDrop = async (
    e: React.DragEvent,
    targetCat: Category,
    position: 'before' | 'after',
  ) => {
    e.stopPropagation()
    // 书签拖到分类 → 移动分类
    if (Array.from(e.dataTransfer.types).includes(DRAG_TYPE_BOOKMARK)) {
      await handleBookmarkDropToCategory(e, targetCat, position)
      return
    }
    // 分类之间拖动 → 排序
    // fallback text/plain：自定义 MIME 在某些环境下 drop 时读不到
    const raw = e.dataTransfer.getData(DRAG_TYPE_CATEGORY) || e.dataTransfer.getData('text/plain')
    const fromId = Number(raw)
    if (!fromId || fromId === targetCat.id) return
    reorderCats.mutate({ fromId, toId: targetCat.id, position })
  }

  /**
   * 书签拖到分类。
   * 批量模式下若拖的卡片在已选集合且 size>1，整批移动；否则只移这一张。
   * 过滤掉已在目标分类的书签，直接乐观更新 category_id + mutate，当前分类 filter 瞬间移除卡片
   * （无退场动画）。移动是轻操作（书签没删，切到目标分类还在），果断干净，与取消收藏一致。   * position 参数（来自 SidebarItem）当前未使用：书签拖入场景固定是"移到该分类"，无需 before/after。
   */
  const handleBookmarkDropToCategory = async (
    e: React.DragEvent,
    targetCat: Category,
    _position: 'before' | 'after',
  ) => {
    // fallback text/plain：自定义 MIME 在某些环境下 drop 时读不到
    const raw = e.dataTransfer.getData(DRAG_TYPE_BOOKMARK) || e.dataTransfer.getData('text/plain')
    const draggedId = Number(raw)
    if (!draggedId) return
    // 批量模式下整批移动
    // 整批拖拽（拖的卡片在已选集合且选了多个）→ 移动后清掉这批选中；单个拖拽不动选中
    const isBatchDrag = selectedIds.has(draggedId) && selectedIds.size > 1
    const requestedIds = isBatchDrag ? Array.from(selectedIds) : [draggedId]
    // 过滤掉已在目标分类的（无需移动）
    const toMoveIds = bookmarks
      .filter((b) => requestedIds.includes(b.id) && b.category_id !== targetCat.id)
      .map((b) => b.id)
    if (toMoveIds.length === 0) return
    // 拖拽移动分类：直接乐观更新 + mutate（轻操作，书签没删，切到目标分类还在）。
    // applyBatchMoveToCache 立即把 category_id 改成目标值，当前分类 filter 瞬间移除卡片（无退场动画）。
    // 故意与删除的 pop-out 不一致：移动是轻操作，果断干净（与取消收藏一致）。
    applyBatchMoveToCache(qc, toMoveIds, targetCat.id)
    try {
      await batchMove.mutateAsync({ ids: toMoveIds, categoryId: targetCat.id })
      toast.success(`已移动 ${toMoveIds.length} 个书签到「${targetCat.name}」`)
      if (isBatchDrag) clearSelection()
    } catch (err) {
      toast.error('移动失败: ' + (err as Error).message)
    }
  }

  /** 选中分类：切 currentCategory + 通知宿主。移动端抽屉据此关闭——旧实现靠"对比 prev/curr 分类变化"
   *  effect 推断，点已选分类时值不变 effect 不触发导致抽屉不收缩；改由点击动作直接通知，所见即所得。
   *  桌面端不传 onCategoryClick，no-op。 */
  const selectCategory = (cat: typeof currentCategory) => {
    setCurrentCategory(cat)
    onCategoryClick?.()
  }

  // 分类项入场动画错开
  // 仅 catAnimate（刷新首次加载）时生成 delay；之后传 undefined，animate-enter 已移除也不触发
  let staggerIdx = 0
  const staggerStyle = (): CSSProperties | undefined =>
    catAnimate ? { animationDelay: `${staggerIdx++ * 0.04}s` } : undefined

  return (
    /* liquid-glass 已去掉：backdrop-filter saturate(180%) 会把 panel 暖色拉到冷青调，
       跟 body panel 暖米色不一致，main 圆角塌角透出来形成"小三角"色差 */
    <aside className={cn('sidebar', open && 'open')}>
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
        <button
          className="sidebar-add-btn"
          onClick={openCreateCategory}
          aria-label="新建分类"
          title="新建分类（Ctrl+Shift+I）"
        >
          <Plus size={12} strokeWidth={3} />
          <span>新建</span>
        </button>
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
          accent
          icon={<Layers size={14} style={{ color: 'var(--icon-all)' }} />}
          label="全部"
          count={counts.all}
          active={currentCategory === 'all'}
          onClick={() => selectCategory('all')}
        />
        {counts.favorites > 0 && (
          <SidebarItem
            style={staggerStyle()}
            accent
            isNew={favIsNew}
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
            accent
            isNew={uncatIsNew}
            icon={<Folder size={14} style={{ color: 'var(--icon-uncategorized)', fill: 'var(--icon-uncategorized)' }} />}
            label="未分类"
            count={counts.uncategorized}
            active={currentCategory === '__uncategorized__'}
            onClick={() => selectCategory('__uncategorized__')}
            onContext={(e) => setCatMenu({ kind: 'uncat', x: e.clientX, y: e.clientY })}
          />
        )}
        {!isLoading &&
          categories.map((c) => {
            const Icon = resolveCategoryIcon(c.icon)
            return (
              <SidebarItem
                key={c.id}
                style={staggerStyle()}
                category={c}
                draggedCatId={draggedCatId}
                icon={<Icon size={14} style={{ color: c.color || 'var(--default-category-color)' }} />}
                label={c.name}
                count={countByCat(c.id)}
                active={currentCategory === c.id}
                onClick={() => selectCategory(c.id)}
                onContext={(e) => setCatMenu({ kind: 'cat', id: c.id, x: e.clientX, y: e.clientY })}
                onDragStart={(catId) => setDraggedCatId(catId)}
                onDragEnd={() => setDraggedCatId(null)}
                onDrop={onCategoryDrop}
                isNew={c.id === recentlyAddedCatId}
                selected={categoryBatchMode && selectedCategoryIds.has(c.id)}
                onSelect={categoryBatchMode ? handleCategorySelect : undefined}
              />
            )
          })}
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
        onClose={closeCategoryDialog}
        editingCategory={editingCategory}
        onCreated={(id) => setRecentlyAddedCatId(id)}
      />

      {/* 分类删除确认（仅有书签时显示）*/}
      <CategoryDeleteDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        category={deleteTarget}
        count={deleteTarget ? countByCat(deleteTarget.id) : 0}
        onConfirm={onConfirmDelete}
      />
    </aside>
  )
}
