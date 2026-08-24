import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useShallow } from 'zustand/react/shallow'
import { useQueryClient } from '@tanstack/react-query'
import {
  Star,
  Pencil,
  Trash2,
  X,
  FolderInput,
  Tags,
  Sparkles,
  WandSparkles,
  Upload,
  Bookmark as BookmarkIcon,
  SearchX,
  Plus,
  Layers,
  Folder,
} from 'lucide-react'
import {
  useBookmarks,
  useToggleFavorite,
  useDeleteBookmark,
  useBatchDelete,
  useBatchMove,
  useReorderBookmarks,
  useUpdateBookmark,
} from '@/hooks/useBookmarks'
import { refreshBookmarkFavicon, faviconUrl, updateBookmark } from '@/api/bookmarks'
import { blobToDataUri } from '@/lib/favicon'
import { setFavicon, getFavicon, deleteFavicon, markNoFavicon, unmarkNoFavicon } from '@/lib/favicon-cache'
import type { Bookmark } from '@/types'
import { useCategories } from '@/hooks/useCategories'
import { BookmarkCard } from '@/components/shared/bookmark-card'
import { BookmarkDialog } from '@/components/shared/bookmark-dialog'
import { BatchDialog } from '@/components/shared/batch-dialog'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ExportDialog } from '@/components/shared/export-dialog'
import { ContextMenu, type MenuItem } from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import type { ToastAction } from '@/components/ui/toast'
import { useUIStore } from '@/stores/ui'
import { useAnimatedExit } from '@/lib/use-animated-exit'
import { cn } from '@/lib/utils'
import { filterBookmarksBySearch } from '@/lib/bookmark-search'
import { filterBookmarksByCategory, getCategoryDescendantIds } from '@/lib/category-tree'
import { parseTags } from '@/lib/bookmark-utils'
import { resolveCategoryIcon } from '@/lib/icon-map'
import { AI_PRESETS } from '@/lib/ai-providers'
import type { Category } from '@/types'
import { fetchAIMeta } from '@/api/utils'
import type { AISettings } from '@/api/settings'
import { useDragStore } from '@/stores/drag'

/**
 * 书签页 —— 渲染在 AppShell 的 main 区。
 * 视图结构：
 * - 顶部操作栏（搜索计数 / 批量入口 / 添加按钮）
 * - 批量操作栏（.batch-action-bar）
 * - 卡片菜单（.context-menu）
 * - 编辑/删除 Dialog（.modal / .modal-overlay）
 * - 操作反馈 Toast（.toast-container）
 * - 删除用 ConfirmDialog 替代浏览器 confirm
 */
export const Route = createFileRoute('/_authed/bookmarks')({
  head: () => ({ meta: [{ title: 'Lumen · 书签' }] }),
  component: BookmarksPage,
})

function BookmarksPage() {
  const { data: bmData, isLoading, error } = useBookmarks()
  const { data: catData } = useCategories()
  const toggleFav = useToggleFavorite()
  const deleteMut = useDeleteBookmark()
  const batchDeleteMut = useBatchDelete()
  const batchMoveMut = useBatchMove()
  const reorderBookmarksMut = useReorderBookmarks()
  const updateMut = useUpdateBookmark()
  const qc = useQueryClient()
  // 退场动画标记：删除先标记后 mutate，卡片挂 pop-out 动画结束才真正删
  // 只取书签相关函数：bookmarks.tsx 不消费分类退场，避免 id 撞车误读
  const { markBookmarkExiting, unmarkBookmarkExiting, isBookmarkExiting } = useAnimatedExit()
  // 新书签高亮标记：1.5s 后自动清除（橙色 ring 强调）
  const [recentlyAddedId, setRecentlyAddedId] = useState<number | null>(null)
  // favicon 预加载：让"切分类时 <img> 重建从缓存秒显"，避免改图标后切过去"空白->新图"闪烁。
  // - 首屏（prev=null）：预热全部书签。首屏可能停在持久化的子分类（stores/ui.ts persist），
  //   其他分类的 favicon 还没请求过，切过去会因缓存未命中而闪；提前把全部 favicon 下进
  //   1 年强缓存。当前分类卡片挂载时 <img> 也会请求同 URL，浏览器自动合并，不重复下载。
  // - 后续 refetch（WS 推送/刷新）：只预热 updated_at 变化的，数据没变零网络。
  // - 执行时机放 requestIdleCallback 空闲期，不与首屏 LCP 关键渲染争带宽/主线程；
  //   timeout 兜底最迟 2s 触发，不支持时降级 setTimeout。
  const prevBookmarksRef = useRef<Bookmark[] | null>(null)
  useEffect(() => {
    const prev = prevBookmarksRef.current
    const next = bmData?.bookmarks ?? null
    prevBookmarksRef.current = next
    if (!next) return

    // 预热 favicon：fetch 端点拿 dataURI 写 localStorage 缓存（渲染时 getFavicon 秒显不走网络），
    // 同时预热 HTTP 缓存（缓存未命中时端点秒显）。跳过已缓存命中的，减少不必要 fetch。
    const toWarm: { id: number; updatedAt: string; url: string }[] = []
    const pushIfMiss = (b: Bookmark) => {
      if (getFavicon(b.id, b.updated_at)) return // 已缓存命中，跳过
      toWarm.push({ id: b.id, updatedAt: b.updated_at, url: faviconUrl(b.id, b.updated_at) })
    }
    if (!prev) {
      for (const b of next) pushIfMiss(b)
    } else {
      const prevMap = new Map<number, string>()
      for (const b of prev) prevMap.set(b.id, b.updated_at)
      for (const b of next) {
        if (prevMap.get(b.id) !== b.updated_at) pushIfMiss(b) // updated_at 变化（图标更新）才预热
      }
    }
    if (toWarm.length === 0) return

    const warm = () => {
      for (const item of toWarm) {
        fetch(item.url)
          .then((r) => (r.ok ? r.blob() : null))
          .then((blob) => (blob ? blobToDataUri(blob) : null))
          .then((dataUri) => {
            if (dataUri) setFavicon(item.id, item.updatedAt, dataUri)
          })
          .catch(() => {})
      }
    }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm, { timeout: 2000 })
      return () => window.cancelIdleCallback(handle)
    }
    const t = window.setTimeout(warm, 0)
    return () => window.clearTimeout(t)
  }, [bmData])

  const {
    searchQuery,
    idSearchMode,
    currentCategory,
    setCurrentCategory,
    batchMode,
    selectedIds,
    anchorId,
    setAnchor,
    selectRange,
    toggleSelection,
    selectAll,
    clearSelection,
    exitBatchMode,
    bookmarkDialog,
    openEditBookmark,
    openCreateBookmark,
    closeBookmarkDialog,
  } = useUIStore(
    // useShallow：对象 selector 浅比较，仅引用变化的字段才 re-render（防任一 set 触发 BookmarksPage 全量重渲染）
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      idSearchMode: s.idSearchMode,
      currentCategory: s.currentCategory,
      setCurrentCategory: s.setCurrentCategory,
      batchMode: s.batchMode,
      selectedIds: s.selectedIds,
      anchorId: s.anchorId,
      setAnchor: s.setAnchor,
      selectRange: s.selectRange,
      toggleSelection: s.toggleSelection,
      selectAll: s.selectAll,
      clearSelection: s.clearSelection,
      exitBatchMode: s.exitBatchMode,
      bookmarkDialog: s.bookmarkDialog,
      openEditBookmark: s.openEditBookmark,
      openCreateBookmark: s.openCreateBookmark,
      closeBookmarkDialog: s.closeBookmarkDialog,
    })),
  )

  // 容器入场动画门控：只在「首载 / 切分类」时挂 animate-enter，
  // 让整批卡片同步 fadeInUp 一次，300ms（fadeInUp 时长）后移除；之后后台 refetch 增量进来的
  // 跨设备新书签挂载时容器已无 animate-enter → 静默渲染，和旧书签一起出现，不"跳出来"。
  const [enterAnimate, setEnterAnimate] = useState(true)
  useLayoutEffect(() => {
    setEnterAnimate(true)
    const t = window.setTimeout(() => setEnterAnimate(false), 300)
    return () => window.clearTimeout(t)
  }, [currentCategory])

  const allBookmarks = bmData?.bookmarks ?? []
  const categories = catData?.categories ?? []
  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const q = searchQuery.toLowerCase().trim()
  const activeCategory = typeof currentCategory === 'number'
    ? categories.find((category) => category.id === currentCategory)
    : undefined
  const ActiveCategoryIcon = activeCategory ? resolveCategoryIcon(activeCategory.icon) : null
  const viewTitle =
    currentCategory === 'all'
      ? '全部书签'
      : currentCategory === '__favorites__'
        ? '收藏'
        : currentCategory === '__uncategorized__'
          ? '未分类'
          : activeCategory?.name ?? '全部书签'

  const filtered = useMemo(() => {
    let bookmarks = allBookmarks
    if (q) {
      bookmarks = filterBookmarksBySearch(bookmarks, catMap, q, idSearchMode)
      // 搜索结果按分类分组：按侧栏分类顺序（categories 已按 sort_order），
      // 未分类/已删分类的书签放最后；组内保持原有顺序（稳定排序）。
      const categoryOrder = new Map(categories.map((c, i) => [c.id, i]))
      bookmarks = [...bookmarks].sort((a, b) => {
        const ai =
          a.category_id != null ? categoryOrder.get(a.category_id) ?? categories.length : categories.length
        const bi =
          b.category_id != null ? categoryOrder.get(b.category_id) ?? categories.length : categories.length
        return ai - bi
      })
    } else if (currentCategory === '__favorites__') {
      bookmarks = bookmarks.filter((b) => b.is_favorite)
    } else if (currentCategory === '__uncategorized__') {
      const catIds = new Set(categories.map((c) => c.id))
      bookmarks = bookmarks.filter(
        (b) => b.category_id == null || !catIds.has(b.category_id),
      )
    } else if (currentCategory !== 'all') {
      bookmarks = filterBookmarksByCategory(bookmarks, categories, currentCategory)
    }
    // 全部 / 收藏视图（非搜索）按 id DESC（创建顺序，最新在前），不按 sort_order：移动书签到新分类时
    // 后端会改 sort_order（目标分类末尾），若这两个视图也按 sort_order 排会导致书签在当前视图换位。
    // 按 id 排让移动只改分类归属，不影响全部/收藏视图的创建顺序。
    if (!q && (currentCategory === 'all' || currentCategory === '__favorites__')) {
      bookmarks = [...bookmarks].sort((a, b) => b.id - a.id)
    }
    return bookmarks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBookmarks, categories, catMap, q, currentCategory, idSearchMode])

  // 搜索结果按分类分组：filtered 已按分类排好（同分类必相邻），只需切连续段；未分类最后
  const searchGroups = useMemo(() => {
    if (!q) return [] as { category?: Category; bookmarks: Bookmark[]; showTitle: boolean }[]
    const catById = new Map(categories.map((c) => [c.id, c]))
    const groups: { category?: Category; bookmarks: Bookmark[]; showTitle: boolean }[] = []
    for (const bookmark of filtered) {
      const category = bookmark.category_id != null ? catById.get(bookmark.category_id) : undefined
      const last = groups[groups.length - 1]
      if (!last || last.category !== category) {
        groups.push({ category, bookmarks: [bookmark], showTitle: true })
      } else {
        last.bookmarks.push(bookmark)
      }
    }
    return groups
  }, [filtered, categories, q])

  // 分类视图沿用搜索结果的分组网格：当前分类直属书签与每个后代分类的书签分别成组，
  // 仍在同一个网格中平铺，而不是把子分类做成入口卡片。
  const categoryGroups = useMemo<{ category: Category; bookmarks: Bookmark[]; showTitle: boolean }[]>(() => {
    if (q || typeof currentCategory !== 'number') return []
    const parent = categories.find((category) => category.id === currentCategory)
    const children = getCategoryDescendantIds(categories, currentCategory)
      .map((id) => categories.find((category) => category.id === id))
      .filter((category): category is Category => category != null)
    if (!parent || children.length === 0) return []
    return [parent, ...children]
      .map((category) => ({
        category,
        bookmarks: filtered.filter((bookmark) => bookmark.category_id === category.id),
        showTitle: category.id !== parent.id,
      }))
  }, [filtered, categories, q, currentCategory])
  const cardGroups = q ? searchGroups : categoryGroups.length > 0 ? categoryGroups : null
  const aggregateParent = !q && categoryGroups.length > 0 ? activeCategory : undefined
  const canReorderBookmarks = !q && !batchMode && typeof currentCategory === 'number' && !aggregateParent
  const lastDrop = useDragStore((state) => state.lastDrop)
  const handledDropToken = useRef<number | null>(null)

  useEffect(() => {
    if (
      !lastDrop ||
      lastDrop.token === handledDropToken.current ||
      lastDrop.source.kind !== 'bookmark'
    ) return
    handledDropToken.current = lastDrop.token
    const { source, target } = lastDrop
    const run = async () => {
      try {
        if (target.kind === 'category') {
          if (source.categoryId === target.id) return
          await batchMoveMut.mutateAsync({ ids: [source.id], categoryId: target.id })
          toast.success(`书签已移动到「${catMap.get(target.id) ?? '分类'}」`, undefined, {
            label: '查看',
            onClick: () => setCurrentCategory(target.id),
          })
          return
        }
        if (aggregateParent) {
          await batchMoveMut.mutateAsync({
            ids: [source.id],
            categoryId: target.categoryId,
            targetBookmarkId: target.id,
            position: target.position,
          })
          return
        }
        if (canReorderBookmarks && source.categoryId === target.categoryId) {
          if (target.sortIndex == null) return
          await reorderBookmarksMut.mutateAsync({
            fromId: source.id,
            categoryId: target.categoryId,
            toIndex: target.sortIndex,
          })
          return
        }
        if (source.id === target.id) return
        if (source.categoryId === target.categoryId) return
        await batchMoveMut.mutateAsync({
          ids: [source.id],
          categoryId: target.categoryId,
          targetBookmarkId: target.id,
          position: target.position,
        })
        toast.success('书签已移动')
      } catch (error) {
        toast.error('书签拖拽失败: ' + (error as Error).message)
      }
    }
    void run()
  }, [aggregateParent, batchMoveMut, canReorderBookmarks, catMap, lastDrop, reorderBookmarksMut])
  // 分类失效时自动切回全部
  // - 虚拟分类（收藏/未分类）为空 → 全部
  // - 数字分类已被删除（不在 categories 列表）→ 全部，避免登录后停在已删分类显示空白
  useEffect(() => {
    if (q) return
    if (currentCategory === '__favorites__' || currentCategory === '__uncategorized__') {
      if (allBookmarks.length > 0 && filtered.length === 0) {
        setCurrentCategory('all')
      }
      return
    }
    if (
      typeof currentCategory === 'number' &&
      categories.length > 0 &&
      !categories.some((c) => c.id === currentCategory)
    ) {
      setCurrentCategory('all')
    }
  }, [q, currentCategory, filtered.length, allBookmarks.length, categories, setCurrentCategory])

  // 滚动位置记忆：刷新/登录后恢复上次滚动位置（书签首次加载完成后恢复）
  const scrollRestored = useRef(false)
  useEffect(() => {
    if (scrollRestored.current || allBookmarks.length === 0) return
    scrollRestored.current = true
    const saved = Number(localStorage.getItem('bookmarks-scroll') ?? 0)
    if (saved > 0) {
      requestAnimationFrame(() => {
        document.querySelector('.main')?.scrollTo({ top: saved })
      })
    }
  }, [allBookmarks.length])

  // 搜索/分类切换后滚回顶部（mount 跳过，避免覆盖恢复的滚动位置）
  // 开始搜索时记下当前位置，关闭搜索时恢复该位置，而不是回顶
  const isFirstRender = useRef(true)
  const wasSearching = useRef(false)
  const preSearchScroll = useRef(0)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const main = document.querySelector('.main')
    const searching = !!q
    if (searching && !wasSearching.current) {
      // 搜索开始：记录当前位置，供关闭搜索时恢复
      preSearchScroll.current = main?.scrollTop ?? 0
    }
    wasSearching.current = searching
    if (!searching && preSearchScroll.current > 0) {
      // 搜索关闭：恢复搜索前的位置
      main?.scrollTo({ top: preSearchScroll.current, behavior: 'instant' as ScrollBehavior })
      preSearchScroll.current = 0
      return
    }
    // 切换分类/搜索：瞬间滚回顶部（不要 smooth —— smooth 会和 grid 重挂载的 fadeInUp
    // 叠加成"快速滚动"视觉，过渡动画应只有 fadeInUp 一个）
    main?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, currentCategory])

  // 持久化滚动位置（debounce 200ms，刷新后恢复用）
  useEffect(() => {
    const main = document.querySelector('.main')
    if (!main) return
    let t: number
    const onScroll = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        localStorage.setItem('bookmarks-scroll', String(main.scrollTop))
      }, 200)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(t)
      main.removeEventListener('scroll', onScroll)
    }
  }, [])

  // 新书签高亮 1.5s 后清除 + 滚动定位
  useEffect(() => {
    if (recentlyAddedId == null) return
    const t = window.setTimeout(() => setRecentlyAddedId(null), 1000)
    return () => window.clearTimeout(t)
  }, [recentlyAddedId])

  // 新书签保存后滚动到卡片
  useEffect(() => {
    if (recentlyAddedId == null) return
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `.bookmark-card[data-bookmark-id="${recentlyAddedId}"]`,
      )
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [recentlyAddedId])

  // 卡片菜单
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const menuBookmark = menu ? allBookmarks.find((b) => b.id === menu.id) : null

  // 刷新图标：AbortController 存 ref，Esc / X 按钮触发 abort
  // capture 阶段 + stopImmediatePropagation，避免连带触发 use-hotkeys 的清空搜索
  const faviconAbortRef = useRef<AbortController | null>(null)
  const [refreshingFavId, setRefreshingFavId] = useState<number | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && faviconAbortRef.current) {
        e.stopImmediatePropagation()
        e.preventDefault()
        faviconAbortRef.current.abort()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  const handleRefreshFavicon = async (id: number, url: string) => {
    const ac = new AbortController()
    faviconAbortRef.current = ac
    setRefreshingFavId(id)
    const tid = toast.loading('正在获取图标…', undefined, { onDismiss: () => ac.abort() })
    try {
      const { dataUri, updatedAt } = await refreshBookmarkFavicon(id, url, ac.signal)
      // 直接用 dataUri 写入 cache 显示（立即可见、不依赖 /api/bookmarks/{id}/favicon 端点重新拉取，成功率高）。
      // 同时写 localStorage（setFavicon）用后端返回的 updated_at：WS invalidate refetch 会把 favicon 覆盖成 ''，
      // 但 updated_at 一致 -> getFavicon(id, updatedAt) 命中 localStorage 同步返回 dataUri，不走端点，无 0.5s 延迟。
      qc.setQueryData<{ bookmarks: Bookmark[] }>(['bookmarks'], (old) => {
        if (!old) return old
        return {
          ...old,
          bookmarks: old.bookmarks.map((b) =>
            b.id === id ? { ...b, favicon: dataUri, updated_at: updatedAt } : b,
          ),
        }
      })
      setFavicon(id, updatedAt, dataUri)
      toast.resolve(tid, '图标刷新成功', 'success')
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') toast.resolve(tid, err.message.includes('15') ? '获取超时，请稍后重试' : '已取消', 'warning')
      else toast.resolve(tid, '图标刷新失败: ' + err.message, 'error')
    } finally {
      faviconAbortRef.current = null
      setRefreshingFavId(null)
    }
  }

  // 仅清除 favicon 图标 -- 仿 handleRefreshFavicon 手动控制，不走 useUpdateBookmark（它无法在
  // 乐观阶段同步标记无图标 + 删缓存）。关键：markNoFavicon 让卡片直接显示 Globe 不走端点，
  // 否则乐观期间端点还没 404（PUT 未完成）会返回旧图标，走端点就闪旧图标 + 和 toast 不同步。
  const handleClearFavicon = async (id: number) => {
    const bm = allBookmarks.find((b) => b.id === id)
    if (!bm) return
    // 乐观：图标立即变 Globe，和 toast 同步弹，不等 PUT 往返。
    // - optimisticUpdatedAt 让 faviconUrl 生成新 URL，绕开 HTTP 缓存里的旧图标；
    // - markNoFavicon(id, optimisticUpdatedAt) 让 BookmarkCard 的 faviconError=true 直接 Globe 不走端点；
    // - deleteFavicon 清 localStorage 缓存，避免 getFavicon 命中旧 dataURI。
    const optimisticUpdatedAt = new Date().toISOString()
    const prev = qc.getQueryData<{ bookmarks: Bookmark[] }>(['bookmarks'])
    markNoFavicon(id, optimisticUpdatedAt)
    deleteFavicon(id)
    qc.setQueryData<{ bookmarks: Bookmark[] }>(['bookmarks'], (old) => {
      if (!old) return old
      return {
        ...old,
        bookmarks: old.bookmarks.map((b) =>
          b.id === id ? { ...b, favicon: '', updated_at: optimisticUpdatedAt } : b,
        ),
      }
    })
    toast.success('图标已清除')
    try {
      // 后端只更新传入字段，{ favicon: '' } 不动 url/title（bookmarks.go handleUpdateBookmark）
      const res = await updateBookmark(id, { favicon: '' })
      // 用后端真值对账：updated_at 换后端值，noFavicon 标记同步（WS 推送的 refetch 会把
      // updated_at 覆盖成后端值，hasNoFavicon 仍要命中保持 Globe，不闪）。
      markNoFavicon(id, res.updated_at)
      qc.setQueryData<{ bookmarks: Bookmark[] }>(['bookmarks'], (old) => {
        if (!old) return old
        return {
          ...old,
          bookmarks: old.bookmarks.map((b) =>
            b.id === id ? { ...b, favicon: '', updated_at: res.updated_at } : b,
          ),
        }
      })
    } catch (e) {
      toast.error('清除图标失败: ' + (e as Error).message)
      // 回滚：恢复 prev + 清无图标标记，让 img 重新走端点拿后端旧图标（HTTP 缓存命中，秒恢复）
      unmarkNoFavicon(id)
      if (prev) qc.setQueryData(['bookmarks'], prev)
    }
  }

  // 右键智能填充是后台更新：已有分类不动，未分类仅在建议命中已有分类时归类。
  const handleAIFillOutside = async (bookmark: NonNullable<typeof menuBookmark>) => {
    const ac = new AbortController()
    const activeProvider = qc.getQueryData<AISettings>(['ai-settings'])?.activeProvider
    const activeProviderLogo = AI_PRESETS[activeProvider ?? '']?.logo
    const tid = toast.loading(
      '正在智能填充…',
      activeProviderLogo ? (
        <img
          src={activeProviderLogo}
          alt=""
          className="w-4 h-4 animate-spin"
          style={{ animationDuration: '1.5s' }}
        />
      ) : undefined,
      { onDismiss: () => ac.abort() },
    )
    try {
      const meta = await fetchAIMeta(
        bookmark.url,
        categories.map((c) => c.name),
        ac.signal,
        {
          title: bookmark.title,
          description: bookmark.description ?? '',
          tags: bookmark.tags.join(', '),
        },
      )
      const suggestedCategory = bookmark.category_id == null && meta.category
        ? categories.find((c) => c.name.trim().toLowerCase() === meta.category?.trim().toLowerCase())
        : undefined
      const categoryNames = new Set(categories.map((c) => c.name.trim().toLowerCase()))
      await updateMut.mutateAsync({
        id: bookmark.id,
        input: {
          title: meta.title_cn || meta.title || bookmark.title,
          description: meta.description_cn || meta.description || bookmark.description,
          tags: meta.tags
            ? parseTags(meta.tags).filter((tag) => !categoryNames.has(tag.toLowerCase()))
            : bookmark.tags,
          ...(suggestedCategory ? { category_id: suggestedCategory.id } : {}),
        },
      })
      if (!suggestedCategory) {
        toast.resolve(tid, '智能填充成功', 'success')
        return
      }
      const currentViewCategory = useUIStore.getState().currentCategory
      const visible =
        currentViewCategory === 'all' ||
        (currentViewCategory === '__favorites__' && bookmark.is_favorite) ||
        currentViewCategory === suggestedCategory.id
      const action: ToastAction | undefined = visible
        ? undefined
        : {
            label: '查看',
            onClick: () => useUIStore.getState().setCurrentCategory(suggestedCategory.id),
          }
      toast.resolve(tid, `已保存到「${suggestedCategory.name}」`, 'success', action)
    } catch (e) {
      const err = e as Error
      toast.resolve(tid, err.name === 'AbortError' ? '智能填充已取消' : err.message || '智能填充失败', err.name === 'AbortError' ? 'warning' : 'error')
    }
  }

  // 导出选中 → 打开 ExportDialog 带 ids 参数
  const exportSelected = () => {
    if (selectedArr.length === 0) return
    setExportDialogIds([...selectedArr])
  }

  // 批量 dialog（存 uiStore 供全局快捷键 Ctrl+Enter 判断）
  const batchDialog = useUIStore((s) => s.batchDialog)
  const setBatchDialog = useUIStore((s) => s.setBatchDialog)

  // 删除确认 dialog
  const [confirmDel, setConfirmDel] = useState<{ type: 'single' | 'batch'; id?: number } | null>(null)
  // 导出 dialog
  const [exportDialogIds, setExportDialogIds] = useState<number[] | null>(null)

  const editingBookmark =
    bookmarkDialog && bookmarkDialog !== 'create'
      ? allBookmarks.find((b) => b.id === bookmarkDialog) ?? null
      : null

  const selectedArr = Array.from(selectedIds)
  const allSelected = filtered.length > 0 && selectedArr.length === filtered.length

  // 批量模式下书签卡片点击：Shift+点击 = 重设为「锚点到当前项」的范围（范围内选中、范围外取消，对齐 Windows 资源管理器，锚点不变）；否则 toggle 单项并更新锚点。
  // 移动端无 Shift，恒走 toggle 分支（仍能逐个累积选中）。非批量模式由卡片自行 window.open，不走这里。
  const handleCardSelect = (e: React.MouseEvent, id: number) => {
    if (e.shiftKey && anchorId != null) {
      const orderedIds = filtered.map((b) => b.id)
      if (orderedIds.includes(anchorId)) {
        selectRange(anchorId, id, orderedIds)
        return
      }
      // 锚点已不在当前可见列表（切了分类/搜索）-> 降级为 toggle + 重设锚点
    }
    toggleSelection(id)
    setAnchor(id)
  }

  const menuItems: MenuItem[] = menuBookmark
    ? [
        // 卡片菜单顺序：编辑 / 收藏(或取消收藏) / 智能填充 / 刷新图标 / 删除
        {
          label: '编辑',
          icon: <Pencil size={14} />,
          variant: 'edit',
          onClick: () => openEditBookmark(menuBookmark.id),
        },
        {
          label: menuBookmark.is_favorite ? '取消收藏' : '收藏',
          icon: (
            <Star
              size={16}
              style={{ fill: menuBookmark.is_favorite ? 'var(--favorite-star)' : 'currentColor' }}
              stroke="none"
            />
          ),
          onClick: () => {
            toggleFav.mutate(menuBookmark.id)
            toast.success(
              menuBookmark.is_favorite ? '已取消收藏' : '已收藏',
              menuBookmark.is_favorite ? (
                <Star size={16} style={{ color: 'var(--favorite-star)' }} fill="none" />
              ) : (
                <Star size={16} style={{ fill: 'var(--favorite-star)' }} stroke="none" />
              ),
            )
          },
        },
        {
          label: '智能填充',
          icon: <Sparkles size={14} />,
          onClick: () => handleAIFillOutside(menuBookmark),
        },
        {
          label: '刷新图标',
          icon: <WandSparkles size={14} />,
          onClick: () => handleRefreshFavicon(menuBookmark.id, menuBookmark.url),
        },
        {
          label: '删除',
          icon: <Trash2 size={14} />,
          variant: 'delete',
          onClick: () => setConfirmDel({ type: 'single', id: menuBookmark.id }),
        },
      ]
    : []

  // 首屏 gate：只在「本机完全无缓存」（首次登录）时显 spinner。
  // 刷新场景 persist 已同步恢复旧缓存 → isLoading=false → 直接用缓存秒开，不显 spinner；
  // refetchOnMount:'always' 的后台 refetch 静默进行，新数据到达后由 React Query 自动替换。
  // 注：跨设备删掉的书签会先按旧缓存显示、refetch 完成后消失——这是 stale-while-revalidate
  // 的固有行为，是「秒开」的取舍；sidebar 计数等订阅同 query 的组件会一并更新。
  const showFirstLoadSpinner = isLoading
  if (showFirstLoadSpinner) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="size-8 animate-spin rounded-full border-[3px] border-[var(--text-muted)] border-t-transparent opacity-40" />
      </div>
    )
  }
  if (error) return <div className="p-10 text-center text-[var(--destructive)]">加载失败：{error.message}</div>

  let aggregateDragIndex = 0

  return (
    <>
      {!q && (
        <div className="bookmarks-grid bookmarks-view-header">
          <h1 className="bookmarks-view-title">
            {currentCategory === 'all' ? (
              <Layers size={18} style={{ color: 'var(--icon-all)' }} aria-hidden="true" />
            ) : currentCategory === '__favorites__' ? (
              <Star size={18} style={{ color: 'var(--favorite-star)', fill: 'var(--favorite-star)' }} aria-hidden="true" />
            ) : currentCategory === '__uncategorized__' ? (
              <Folder size={18} style={{ color: 'var(--icon-uncategorized)', fill: 'var(--icon-uncategorized)' }} aria-hidden="true" />
            ) : ActiveCategoryIcon ? (
              <ActiveCategoryIcon size={18} style={{ color: activeCategory?.color || 'var(--text-muted)' }} aria-hidden="true" />
            ) : null}
            <span>{viewTitle}</span>
            <span className="bookmarks-view-count">{filtered.length}</span>
          </h1>
        </div>
      )}

      {filtered.length === 0 && !aggregateParent ? (
        <div
          key={`empty-${currentCategory}-${q ? 'search' : 'cat'}`}
          className={cn('empty-state animate-enter', q && 'searching')}
        >
          <div className="empty-state-icon" aria-hidden="true">
            {q ? <SearchX size={28} strokeWidth={1.6} /> : <BookmarkIcon size={28} strokeWidth={1.6} />}
          </div>
          {q ? (
            <>
              <h3 className="empty-state-title">没有匹配「{q}」的书签</h3>
              <p className="empty-state-desc">换个关键词试试，或清空搜索查看全部</p>
            </>
          ) : (
            <>
              <h3 className="empty-state-title">这个分类还没有书签</h3>
              <p className="empty-state-desc">把第一个收藏加进来，让它不再空空荡荡</p>
              <button
                type="button"
                className="empty-state-action"
                onClick={openCreateBookmark}
              >
                <Plus size={14} strokeWidth={2.2} />
                添加书签
              </button>
            </>
          )}
        </div>
      ) : (
        <div key={currentCategory} className={cn('bookmarks-grid', enterAnimate && 'animate-enter', q && 'searching', batchMode && 'select-none')}>
          {aggregateParent
            ? categoryGroups.flatMap((group) => {
                const Icon = resolveCategoryIcon(group.category?.icon)
                const name = group.category?.name ?? '未分类'
                const groupKey = group.category?.id ?? '__uncategorized__'
                return [
                  ...(group.showTitle ? [
                    <h2 key={`group-${groupKey}`} className="search-group-title">
                      <Icon size={14} style={{ color: group.category?.color || 'var(--text-muted)' }} aria-hidden="true" />
                      <span>{name}</span>
                      <span className="search-group-count">{group.bookmarks.length}</span>
                    </h2>,
                  ] : []),
                  <div
                    key={`group-content-${groupKey}`}
                    className={cn(
                      'bookmark-category-group',
                      group.bookmarks.length === 0 && 'empty',
                    )}
                  >
                    {group.bookmarks.map((b) => (
                      <BookmarkCard
                        key={b.id}
                        bookmark={b}
                        categoryName={b.category_id != null ? catMap.get(b.category_id) : undefined}
                        searchQuery={q}
                        onMenuClick={(id, x, y) => setMenu({ id, x, y })}
                        onSelect={handleCardSelect}
                        isNew={b.id === recentlyAddedId}
                        refreshing={refreshingFavId === b.id}
                        exiting={isBookmarkExiting(b.id)}
                        dragEnabled={!q && !batchMode}
                        index={aggregateDragIndex++}
                        group={`bookmarks:aggregate:${currentCategory}`}
                      />
                    ))}
                  </div>,
                ]
              })
            : cardGroups
              ? cardGroups.flatMap((group) => {
                const Icon = resolveCategoryIcon(group.category?.icon)
                const name = group.category?.name ?? '未分类'
                const groupKey = group.category?.id ?? '__uncategorized__'
                return [
                  ...(group.showTitle ? [
                    <h2
                      key={`group-${groupKey}`}
                      className="search-group-title"
                    >
                      <Icon
                        size={14}
                        style={{ color: group.category?.color || 'var(--text-muted)' }}
                        aria-hidden="true"
                      />
                      <span>{name}</span>
                      <span className="search-group-count">{group.bookmarks.length}</span>
                    </h2>,
                  ] : []),
                  ...group.bookmarks.map((b, index) => (
                    <BookmarkCard
                      key={b.id}
                      bookmark={b}
                      categoryName={b.category_id != null ? catMap.get(b.category_id) : undefined}
                      searchQuery={q}
                      onMenuClick={(id, x, y) => setMenu({ id, x, y })}
                      onSelect={handleCardSelect}
                      isNew={b.id === recentlyAddedId}
                      refreshing={refreshingFavId === b.id}
                      exiting={isBookmarkExiting(b.id)}
                      dragEnabled={!q && !batchMode}
                      index={index}
                      group={`bookmarks:category:${groupKey}`}
                    />
                  )),
                ]
              })
              : filtered.map((b, index) => (
                <BookmarkCard
                  key={b.id}
                  bookmark={b}
                  categoryName={b.category_id != null ? catMap.get(b.category_id) : undefined}
                  searchQuery={q}
                  onMenuClick={(id, x, y) => setMenu({ id, x, y })}
                  onSelect={handleCardSelect}
                  isNew={b.id === recentlyAddedId}
                  refreshing={refreshingFavId === b.id}
                  exiting={isBookmarkExiting(b.id)}
                  dragEnabled={!q && !batchMode}
                  index={index}
                  group={`bookmarks:category:${currentCategory}`}
                />
              ))}
        </div>
      )}

      {/* 批量操作栏（.batch-action-bar）*/}
      <div className={cn('batch-action-bar', batchMode && 'visible')}>
        {/* Row 1：状态信息 + 选择控制 + 移动 */}
        <div className="batch-row batch-row-top">
          <button
            type="button"
            className="batch-count"
            disabled={selectedArr.length === 0}
            onClick={clearSelection}
            title="点击取消选中"
          >
            <X size={12} strokeWidth={2.5} />
            已选 {selectedArr.length} 项
          </button>
          <div className="batch-divider" />
          <label className="batch-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => selectAll(allSelected ? [] : filtered.map((b) => b.id))}
            />
            全选
          </label>
          <button
            className="batch-btn"
            disabled={selectedArr.length === 0}
            onClick={() => setBatchDialog('move')}
          >
            <FolderInput size={12} /> 移动
          </button>
          <button className="batch-close" onClick={exitBatchMode} aria-label="退出批量">
            <X size={14} />
          </button>
        </div>
        {/* Row 2：批量操作（除移动外） */}
        <div className="batch-row batch-row-bottom">
          <button
            className="batch-btn"
            disabled={selectedArr.length === 0}
            onClick={() => setBatchDialog('tags')}
          >
            <Tags size={12} /> 加标签
          </button>
          <button
            className="batch-btn"
            disabled={selectedArr.length === 0}
            onClick={exportSelected}
            title="导出选中书签为 JSON 文件"
          >
            <Upload size={12} /> 导出选中
          </button>
          <button
            className="batch-btn btn-batch-delete"
            disabled={selectedArr.length === 0}
            onClick={() => setConfirmDel({ type: 'batch' })}
          >
            <Trash2 size={12} /> 删除
          </button>
        </div>
      </div>

      {/* 卡片菜单（.context-menu）*/}
      <ContextMenu
        open={!!menu}
        onClose={() => setMenu(null)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
      />

      {/* CRUD dialog */}
      <BookmarkDialog
        open={bookmarkDialog !== null}
        onClose={() => {
          closeBookmarkDialog()
        }}
        editingBookmark={editingBookmark}
        onCreated={(id) => setRecentlyAddedId(id)}
      />

      {/* 批量操作 dialog */}
      <BatchDialog
        open={batchDialog !== null}
        mode={batchDialog ?? 'move'}
        ids={selectedArr}
        onClose={() => setBatchDialog(null)}
        onToast={(m) => toast.success(m)}
      />

      {/* Toast 容器已移到 __root.tsx 全局挂载 */}

      {/* 删除确认（替代浏览器 confirm）*/}
      <ConfirmDialog
        open={confirmDel !== null}
        onClose={() => setConfirmDel(null)}
        title="确认删除"
        message={
          confirmDel?.type === 'batch'
            ? (
              <>
                确定要删除选中的 {selectedArr.length} 个书签吗？
                <br />
                <span className="text-[var(--destructive)]">此操作不可撤销！</span>
              </>
            )
            : (
              <>
                确定要删除{' '}
                <strong className="text-(--text-primary)">
                  "{allBookmarks.find((b) => b.id === confirmDel?.id)?.title ?? '该书签'}"
                </strong>{' '}
                吗？
                <br />
                <span className="text-[var(--destructive)]">此操作不可撤销！</span>
              </>
            )
        }
        confirmText="删除"
        secondaryAction={
          confirmDel?.type === 'single' && confirmDel.id != null
            ? {
                label: '仅清除图标',
                onClick: () => handleClearFavicon(confirmDel.id!),
              }
            : undefined
        }
        onConfirm={async () => {
          // 删除链路：markExiting（卡片 pop-out 动画 0.2s）→ 动画结束 toast 立即弹
          // （和卡片消失同步，跟手）→ API 后台同步（乐观，失败 unmarkExiting 回退卡片）
          const idsToExit: number[] =
            confirmDel?.type === 'batch' ? selectedArr : confirmDel?.id != null ? [confirmDel.id] : []
          if (idsToExit.length === 0) return
          idsToExit.forEach(markBookmarkExiting)
          window.setTimeout(async () => {
            // 动画结束（200ms）：toast 立即弹 + API 后台
            toast.success(idsToExit.length === 1 ? '书签已删除' : `已删除 ${idsToExit.length} 个书签`)
            if (confirmDel?.type === 'batch') clearSelection()
            try {
              if (idsToExit.length === 1) await deleteMut.mutateAsync(idsToExit[0])
              else await batchDeleteMut.mutateAsync(idsToExit)
            } catch (e) {
              toast.error('删除失败: ' + (e as Error).message)
              // 失败回退：清 exiting 标记让卡片恢复显示
              idsToExit.forEach(unmarkBookmarkExiting)
            }
          }, 200)
        }}
      />
      <ExportDialog
        open={exportDialogIds !== null}
        onClose={() => setExportDialogIds(null)}
        ids={exportDialogIds ?? undefined}
      />

      {/* Toast 队列（全局单例，调用 toast.success/error/warning 触发）*/}
    </>
  )
}
