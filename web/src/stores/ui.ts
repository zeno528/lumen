import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setIdSearchMode as apiSetIdSearchMode } from '@/api/settings'

/**
 * 分类筛选标识 -- 虚拟分类约定。
 * - 'all' 全部 / '__favorites__' 收藏 / '__uncategorized__' 未分类
 * - number 为真实分类 ID
 */
export type CategoryFilter = 'all' | '__favorites__' | '__uncategorized__' | number

/** AI 预填数据（右键智能填充返回，传给 BookmarkDialog 预填字段）*/
export interface AIPrefill {
  id: number
  title: string
  description: string
  tags: string
  /** 右键智能填充打开编辑框后，自动开始同一套弹窗内填充流程。 */
  autoFill?: boolean
}

interface UIState {
  /** 搜索词（顶栏输入，不持久化）*/
  searchQuery: string
  setSearchQuery: (q: string) => void

  /** ID 搜索模式开关：激活时输入数字直接匹配书签 id，免输 # 号前缀 */
  idSearchMode: boolean
  toggleIdSearchMode: () => void
  /** 强制设为 false：搜索栏关闭时由调用方 effect 触发，保证"默认打开是普通模式" */
  setIdSearchMode: (v: boolean) => void

  /** 批量弹窗（'move' | 'tags' | null），供全局快捷键判断 */
  batchDialog: 'move' | 'tags' | null
  setBatchDialog: (m: 'move' | 'tags' | null) => void

  /** 当前分类筛选（持久化）*/
  currentCategory: CategoryFilter
  setCurrentCategory: (c: CategoryFilter) => void

  /** 批量模式 */
  batchMode: boolean
  selectedIds: Set<number>
  /** Shift 范围选择锚点：上次点击的书签 id，null 表示尚未点击过 */
  anchorId: number | null
  toggleBatchMode: () => void
  exitBatchMode: () => void
  toggleSelection: (id: number) => void
  /** 记录锚点（普通点击后调用，供后续 Shift 范围选择定位起点）*/
  setAnchor: (id: number) => void
  /** Shift 范围选择：在 orderedIds（当前可见顺序）里取 fromId..toId 区间，范围内全选、范围外取消（对齐 Windows 资源管理器）*/
  selectRange: (fromId: number, toId: number, orderedIds: number[]) => void
  selectAll: (ids: number[]) => void
  clearSelection: () => void

  /** 分类批量模式（独立于书签批量，避免 id 空间撞车，同 exitingCategoryIds 的分离思路）*/
  categoryBatchMode: boolean
  selectedCategoryIds: Set<number>
  /** Shift 范围选择锚点：上次点击的分类 id */
  categoryAnchorId: number | null
  /** 进入批量模式（选中当前 id 并设为锚点，由右键菜单「批量删除」触发）*/
  enterCategoryBatchMode: (id: number) => void
  exitCategoryBatchMode: () => void
  toggleCategoryBatchMode: () => void
  toggleCategorySelection: (id: number) => void
  setCategoryAnchor: (id: number) => void
  /** Shift 范围选择（同 selectRange，作用在 selectedCategoryIds）*/
  selectCategoryRange: (fromId: number, toId: number, orderedIds: number[]) => void
  clearCategorySelection: () => void

  /** 书签 CRUD dialog：null 关闭 / 'create' 新增 / number 编辑 */
  bookmarkDialog: number | 'create' | null
  openCreateBookmark: () => void
  openEditBookmark: (id: number) => void
  /** 右键「智能填充」：打开编辑模态框，并可携带预填或自动填充请求。 */
  openEditBookmarkWithPrefill: (id: number, prefill: AIPrefill) => void
  closeBookmarkDialog: () => void

  /** AI 预填数据（右键智能填充返回的结果，dialog 消费后清空）*/
  aiPrefill: AIPrefill | null

  /** 设置模态框当前标签（设置页改为模态框后，由 SettingsDialog 标签栏共享）*/
  settingsTab: 'account' | 'token' | 'ai' | 'appearance'
  setSettingsTab: (tab: 'account' | 'token' | 'ai' | 'appearance') => void

  /** 设置模态框开关（由顶栏头像菜单触发，React.lazy 懒加载，不进首屏）*/
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void

  /** WebSocket 连接状态（瞬态，不 persist；useWebSocketSync 写，TopbarAvatar 角标读）*/
  wsStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  setWsStatus: (s: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void

  /** 帮助页目录抽屉开关（供 MobileShell Dock 与 help.tsx 共享）*/
  helpTocOpen: boolean
  toggleHelpToc: () => void
  closeHelpToc: () => void

  /** 分类 CRUD dialog：null 关闭 / 'create' 新增 / number 编辑 */
  categoryDialog: number | 'create' | null
  openCreateCategory: () => void
  openEditCategory: (id: number) => void
  closeCategoryDialog: () => void

  /** 快捷键 Ctrl+Enter 触发 dialog 保存的信号（token 自增，消费端 effect 监听）*/
  bookmarkDialogSubmitToken: number
  submitBookmarkDialog: () => void
  categoryDialogSubmitToken: number
  submitCategoryDialog: () => void
  batchDialogSubmitToken: number
  submitBatchDialog: () => void

  /**
   * 退场动画标记 —— 分类与书签使用各自独立的 Set，避免 id 空间撞车。
   *
   * 历史背景：早期版本两者共用一份 `exitingIds: Set<number>`，期望"调用方各自只看自己类型"，
   * 但读侧 `isExiting = (id) => exitingIds.has(id)` 不区分类型 → 当书签 id 与分类 id 数值撞车时
   * （生产环境书签 id 增长后会撞上分类 id），侧栏分类 / 书签卡片会被对方动画误伤，永久卡在
   * `opacity:0`。修复：物理隔离到两份 Set + 两组函数，命名上让"撞车"在调用方就显形。
   */
  exitingCategoryIds: Set<number>
  markCategoryExitingGlobal: (id: number) => void
  unmarkCategoryExitingGlobal: (id: number) => void
  exitingBookmarkIds: Set<number>
  markBookmarkExitingGlobal: (id: number) => void
  unmarkBookmarkExitingGlobal: (id: number) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      idSearchMode: false,
      // 乐观切换 + 写数据库（跨设备同步）；写库失败回滚
      toggleIdSearchMode: () => {
        const next = !useUIStore.getState().idSearchMode
        set({ idSearchMode: next })
        apiSetIdSearchMode(next).catch(() => set({ idSearchMode: !next }))
      },
      setIdSearchMode: (idSearchMode) => set({ idSearchMode }),

      batchDialog: null as 'move' | 'tags' | null,
      setBatchDialog: (batchDialog) => set({ batchDialog }),

      currentCategory: 'all',
      setCurrentCategory: (currentCategory) => set({ currentCategory }),

      batchMode: false,
      selectedIds: new Set<number>(),
      anchorId: null,
      toggleBatchMode: () =>
        set((s) => ({ batchMode: !s.batchMode, selectedIds: new Set(), anchorId: null })),
      exitBatchMode: () => set({ batchMode: false, selectedIds: new Set(), anchorId: null }),
      toggleSelection: (id) =>
        set((s) => {
          const next = new Set(s.selectedIds)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { selectedIds: next }
        }),
      setAnchor: (id) => set({ anchorId: id }),
      selectRange: (fromId, toId, orderedIds) =>
        set((s) => {
          const fromIdx = orderedIds.indexOf(fromId)
          const toIdx = orderedIds.indexOf(toId)
          // 锚点或目标不在当前可见列表（切了分类/搜索）-> 不操作，调用方 fallback 为普通 toggle
          if (fromIdx === -1 || toIdx === -1) return s
          const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
          // Windows 资源管理器行为：重设为锚点到目标的连续范围，范围内选中、范围外取消（锚点不变，连续 Shift 可不断收窄/平移范围）
          const next = new Set<number>()
          for (let i = start; i <= end; i++) next.add(orderedIds[i])
          return { selectedIds: next }
        }),
      selectAll: (ids) => set({ selectedIds: new Set(ids) }),
      clearSelection: () => set({ selectedIds: new Set() }),

      // 分类批量模式（独立状态，不与书签 selectedIds 共用，避免 id 撞车）
      categoryBatchMode: false,
      selectedCategoryIds: new Set<number>(),
      categoryAnchorId: null,
      enterCategoryBatchMode: (id) =>
        set({ categoryBatchMode: true, selectedCategoryIds: new Set([id]), categoryAnchorId: id }),
      exitCategoryBatchMode: () =>
        set({ categoryBatchMode: false, selectedCategoryIds: new Set(), categoryAnchorId: null }),
      toggleCategoryBatchMode: () =>
        set((s) =>
          s.categoryBatchMode
            ? { categoryBatchMode: false, selectedCategoryIds: new Set(), categoryAnchorId: null }
            : { categoryBatchMode: true, selectedCategoryIds: new Set(), categoryAnchorId: null },
        ),
      toggleCategorySelection: (id) =>
        set((s) => {
          const next = new Set(s.selectedCategoryIds)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return { selectedCategoryIds: next }
        }),
      setCategoryAnchor: (id) => set({ categoryAnchorId: id }),
      selectCategoryRange: (fromId, toId, orderedIds) =>
        set((s) => {
          const fromIdx = orderedIds.indexOf(fromId)
          const toIdx = orderedIds.indexOf(toId)
          if (fromIdx === -1 || toIdx === -1) return s
          const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
          const next = new Set<number>()
          for (let i = start; i <= end; i++) next.add(orderedIds[i])
          return { selectedCategoryIds: next }
        }),
      clearCategorySelection: () => set({ selectedCategoryIds: new Set() }),

      /** 书签 CRUD dialog（null=关闭，'create'=新增，number=编辑该 id）*/
      bookmarkDialog: null as number | 'create' | null,
      openCreateBookmark: () => set({ bookmarkDialog: 'create' }),
      openEditBookmark: (id: number) => set({ bookmarkDialog: id }),
      openEditBookmarkWithPrefill: (id: number, prefill: AIPrefill) =>
        set({ bookmarkDialog: id, aiPrefill: prefill }),
      closeBookmarkDialog: () => set({ bookmarkDialog: null, aiPrefill: null }),

      /** AI 预填数据（右键智能填充返回，dialog 消费后清空）*/
      aiPrefill: null as AIPrefill | null,

      /** 设置模态框当前标签 */
      settingsTab: 'account' as 'account' | 'token' | 'ai' | 'appearance',
      setSettingsTab: (settingsTab) => set({ settingsTab }),

      /** 设置模态框开关 */
      settingsOpen: false,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

      /** WebSocket 连接状态（瞬态，不 persist）*/
      wsStatus: 'connecting',
      setWsStatus: (wsStatus) => set({ wsStatus }),

      /** 帮助页目录抽屉开关（供 MobileShell Dock 与 help.tsx 共享）*/
      helpTocOpen: false,
      toggleHelpToc: () => set((s) => ({ helpTocOpen: !s.helpTocOpen })),
      closeHelpToc: () => set({ helpTocOpen: false }),

      /** 分类 CRUD dialog（null=关闭，'create'=新增，number=编辑）*/
      categoryDialog: null as number | 'create' | null,
      openCreateCategory: () => set({ categoryDialog: 'create' }),
      openEditCategory: (id: number) => set({ categoryDialog: id }),
      closeCategoryDialog: () => set({ categoryDialog: null }),

      bookmarkDialogSubmitToken: 0,
      submitBookmarkDialog: () =>
        set((s) => ({ bookmarkDialogSubmitToken: s.bookmarkDialogSubmitToken + 1 })),
      categoryDialogSubmitToken: 0,
      submitCategoryDialog: () =>
        set((s) => ({ categoryDialogSubmitToken: s.categoryDialogSubmitToken + 1 })),
      batchDialogSubmitToken: 0,
      submitBatchDialog: () =>
        set((s) => ({ batchDialogSubmitToken: s.batchDialogSubmitToken + 1 })),

      // 分类退场标记：与书签退场标记分两份 Set，避免 id 撞车误判
      exitingCategoryIds: new Set<number>(),
      markCategoryExitingGlobal: (id) =>
        set((s) => {
          if (s.exitingCategoryIds.has(id)) return s
          const next = new Set(s.exitingCategoryIds)
          next.add(id)
          return { exitingCategoryIds: next }
        }),
      unmarkCategoryExitingGlobal: (id) =>
        set((s) => {
          if (!s.exitingCategoryIds.has(id)) return s
          const next = new Set(s.exitingCategoryIds)
          next.delete(id)
          return { exitingCategoryIds: next }
        }),
      // 书签退场标记
      exitingBookmarkIds: new Set<number>(),
      markBookmarkExitingGlobal: (id) =>
        set((s) => {
          if (s.exitingBookmarkIds.has(id)) return s
          const next = new Set(s.exitingBookmarkIds)
          next.add(id)
          return { exitingBookmarkIds: next }
        }),
      unmarkBookmarkExitingGlobal: (id) =>
        set((s) => {
          if (!s.exitingBookmarkIds.has(id)) return s
          const next = new Set(s.exitingBookmarkIds)
          next.delete(id)
          return { exitingBookmarkIds: next }
        }),
    }),
    {
      name: 'lumen-ui',
      partialize: (s) => ({ currentCategory: s.currentCategory }),
    },
  ),
)
