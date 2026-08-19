import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, CheckCheck, X } from 'lucide-react'
import { useRouterState } from '@tanstack/react-router'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { Sidebar } from './sidebar'
import { AddBookmarkFab } from './add-bookmark-fab'
import { TopbarAvatar } from '@/components/shared/topbar-avatar'
import { TopbarAIButton } from '@/components/shared/topbar-ai-button'
import { useUIStore } from '@/stores/ui'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { SearchCount, SearchEnterHint } from '@/components/shared/search-count'
import { MobileShell } from '@/components/mobile/mobile-shell'
import { useBookmarks } from '@/hooks/useBookmarks'
import { useCategories } from '@/hooks/useCategories'
import { getSingleSearchMatch } from '@/lib/bookmark-search'
import { openInNewTab } from '@/lib/utils'
import { AppDragOverlay } from '@/components/shared/drag-overlay'
import {
  computeGridContentWidth,
  MAX_CONTAINER_WIDTH,
  MAIN_CONTENT_HORIZONTAL_PADDING,
} from '@/hooks/use-grid-metrics'

/**
 * 拖拽触发约束（覆盖库默认）：库默认鼠标「按住 200ms 或移动 5px」任一即触发，
 * 长按片刻就误进拖拽。改为鼠标仅移动 5px 触发（长按不动永不拖拽）；
 * 触摸/触控笔保持库默认（touch=长按 250ms，pen=长按 200ms 或移动 5px）。
 * 无 drag handle 用法，鼠标分支无需保留 handle 豁免。键盘 sensor 一并带上（无障碍拖拽）。
 */
const dragSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      if (event.pointerType === 'mouse') return [new PointerActivationConstraints.Distance({ value: 5 })]
      if (event.pointerType === 'touch') return [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
      return [
        new PointerActivationConstraints.Delay({ value: 200, tolerance: 10 }),
        new PointerActivationConstraints.Distance({ value: 5 }),
      ]
    },
  }),
  KeyboardSensor,
]

/**
 * 首帧 inset 估算：mount 后 rAF / ResizeObserver 真实计算前（约 1 帧），用视口宽度粗估一个
 * 接近最终值的 inset 占位，避免顶栏从「贴边」跳到「对齐」的可见跳变。精度无所谓——rAF 回调
 * 用真实 clientWidth 修正。SIDEBAR_WIDTH 与 layout.css 的 --sidebar-width:260px 同步。
 */
function estimateInitialInset(): number {
  if (typeof window === 'undefined') return 0
  const SIDEBAR_WIDTH = 260
  const gridWidth = Math.min(
    MAX_CONTAINER_WIDTH,
    Math.max(0, window.innerWidth - SIDEBAR_WIDTH - MAIN_CONTENT_HORIZONTAL_PADDING),
  )
  const contentWidth = computeGridContentWidth(gridWidth)
  return Math.max(0, (gridWidth - contentWidth) / 2)
}

/**
 * 计算书签卡片网格当前列布局的左右内缩量，让顶栏搜索框左缘对齐第一列卡片左缘、
 * 右侧按钮组右缘对齐最后一列卡片右缘，并随窗口自适应。
 *
 * 原理：.bookmarks-grid 用 auto-fill + justify-content:center，列数随宽度变化，
 * 左右会出现对称空白。监听 .main-content 尺寸变化，实时算出该空白宽度。
 * 无真实网格时（设置页/帮助页），按 .main-content 宽度用同一公式回算，保持跨页对齐。
 *
 * 性能（避免 forced reflow，实测首屏曾因本 hook 累计 985ms reflow 拖慢 LCP）：
 * - inset 只依赖 .main-content 宽度（列数由宽度决定）。首屏 100+ 卡片批量挂载只改高度不改宽度，
 *   但旧实现监听 .main-content 会被高度变化频繁触发，每次 compute 读几何 + setInset 写都 forced reflow。
 * - 现在回调里比较宽度，宽度不变直接 return，跳过所有由高度变化触发的无效 compute。
 * - mount 时 compute 进 rAF，避免 useEffect 同步读几何引发 layout thrash
 *   （webperf.tips：useEffect 里测量 DOM 是 thrash 典型场景）。
 * - compute 内批量读几何后再 setInset 写，避免读写交错（web.dev avoid-large-complex-layouts）。
 * 依据：web.dev ResizeObserver / avoid-large-complex-layouts；Tiger Oakes「ResizeObserver is a
 * safe place to read clientWidth」（回调内读本身安全，关键是别在 mount 同步读 + 写 thrash）。
 */
function useGridInset() {
  const [inset, setInset] = useState(estimateInitialInset)
  const rafRef = useRef<number | null>(null)
  // 上次触发 compute 的 .main-content 宽度：宽度不变（如首屏卡片挂载只改高度）时跳过
  const lastWidthRef = useRef<number | null>(null)

  useEffect(() => {
    const mainContent = document.querySelector('.main-content') as HTMLElement | null
    if (!mainContent) return

    const compute = () => {
      const grid = Array.from(mainContent.querySelectorAll<HTMLElement>('.bookmarks-grid'))
        .find((candidate) => candidate.querySelector('.bookmark-card')) ?? null
      const card = grid?.querySelector('.bookmark-card') as HTMLElement | null
      const searchWrap = document.querySelector('.main-top-inner .search-wrap') as HTMLElement | null
      const actions = document.querySelector('.main-top-inner .main-top-actions') as HTMLElement | null
      if (!searchWrap || !actions) {
        setInset(0)
        return
      }

      // 批量读：几何属性一次性读完，再 setInset 写，避免读写交错引发 layout thrash
      let gridWidth: number
      let contentWidth: number
      if (grid && card) {
        // 书签页：直接测量真实网格
        gridWidth = grid.clientWidth
        const cardWidth = card.offsetWidth
        const style = window.getComputedStyle(grid)
        const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 16
        const columns = Math.max(1, Math.floor((gridWidth + gap) / (cardWidth + gap)))
        contentWidth = columns * cardWidth + (columns - 1) * gap
      } else {
        // 设置页/帮助页：没有真实网格，按同一公式回算
        gridWidth = Math.min(
          MAX_CONTAINER_WIDTH,
          mainContent.clientWidth - MAIN_CONTENT_HORIZONTAL_PADDING,
        )
        contentWidth = computeGridContentWidth(gridWidth)
      }

      const insetX = Math.max(0, (gridWidth - contentWidth) / 2)
      // 避免列数过少时搜索框与按钮组重叠：左右内缩量不能超过可用空间的一半
      const minCenterGap = 20
      const maxInset = Math.max(
        0,
        (gridWidth - searchWrap.offsetWidth - actions.offsetWidth - minCenterGap) / 2,
      )
      setInset(Math.min(insetX, maxInset))
    }

    const ro = new ResizeObserver((entries) => {
      // 只响应宽度变化：borderBoxSize 是规范推荐 API（Chrome 84+/FF/Safari 16.4+），
      // contentRect.width 兜底旧浏览器。宽度不变（首屏卡片挂载只改高度）直接 return，
      // 跳过无效 compute——这是消除首屏 forced reflow 的关键。
      const entry = entries[0]
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
      if (width === lastWidthRef.current) return
      lastWidthRef.current = width
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(compute)
    })
    ro.observe(mainContent)
    // mount 进 rAF，避免 useEffect 同步读几何引发 layout thrash
    rafRef.current = requestAnimationFrame(compute)

    return () => {
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return inset
}

/**
 * AppShell 入口 —— 仅做桌面/移动端分流（≤768px），避免提前 return 后调 hook 引发 React #300。
 * 桌面渲染拆到 <DesktopShell/> 独立子组件，所有 hooks（useState / useUIStore）都在稳定分支中。
 * 路由不分流，仅按 useIsMobile 切换布局壳。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile(768)
  return (
    <DragDropProvider sensors={dragSensors}>
      {isMobile ? <MobileShell>{children}</MobileShell> : <DesktopShell>{children}</DesktopShell>}
      <AppDragOverlay />
    </DragDropProvider>
  )
}

/**
 * 桌面 Shell —— 侧边栏（logo + 分类 + 用户卡片）+ 主内容区（main-top 搜索/批量/主题 + main-content 内容）。
 * 布局：grid 贴边占满，侧栏与 main 无缝隙；都透 .layout 的 glass-bg，同层无三角。
 * 搜索在 main-top，输入停顿 150ms 后同步到 store。
 */
function DesktopShell({ children }: { children: React.ReactNode }) {
  // 搜索框常驻展开（不再收缩）：input 始终 300px（= 一张卡片宽度），icon 固定左侧，
  // 清空按钮仅在有输入时显示。原收起态 state / onBlur 收起 / 关闭退 ID 模式 effect 全部移除。
  const searchInputRef = useRef<HTMLInputElement>(null)
  const focusSearch = useCallback(() => {
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])
  useHotkeys({ onFocusSearch: focusSearch })
  const {
    searchQuery,
    setSearchQuery,
    batchMode,
    toggleBatchMode,
    idSearchMode,
    toggleIdSearchMode,
  } = useUIStore()
  const [input, setInput] = useState(searchQuery)
  const debounced = useDebouncedValue(input, 150)
  const { data: bmData } = useBookmarks()
  const { data: catData } = useCategories()
  const categoryNames = useMemo(
    () => new Map((catData?.categories ?? []).map((category) => [category.id, category.name])),
    [catData?.categories],
  )
  const searchEnterTarget = useMemo(
    () => input === searchQuery ? getSingleSearchMatch(bmData?.bookmarks ?? [], categoryNames, input, idSearchMode) : null,
    [bmData?.bookmarks, categoryNames, idSearchMode, input, searchQuery],
  )
  // 顶栏搜索框/按钮组与下方卡片网格列对齐所需的左右内缩量（0 表示无网格时回退）
  const gridInset = useGridInset()
  // 设置页/帮助页是独立全屏区域，隐藏侧边栏（对齐移动端 mobile-shell.tsx:99-101 的处理）
  const pathname = useRouterState().location.pathname
  const isFullPage = pathname === '/help'
  // 独立页顶栏已收窄到 SINGLE_PAGE_MAX_WIDTH 与内容对齐，不做网格内缩（顶栏元素自然两端分布）
  const topInset = isFullPage ? 0 : gridInset

  useEffect(() => {
    setSearchQuery(debounced)
  }, [debounced, setSearchQuery])

  useEffect(() => {
    setInput(searchQuery)
  }, [searchQuery])

  return (
    <div className="app-shell">
      <div className={`layout${isFullPage ? ' layout-full' : ''}`}>
        {!isFullPage && <Sidebar />}
        <main className="main">
          <div className="main-top">
            <div className="main-top-inner">
              <div className="search-wrap search-box" style={{ marginLeft: topInset }}>
                <input
                  id="global-search"
                  ref={searchInputRef}
                  placeholder={idSearchMode ? '搜书签或直接输 ID…' : '搜索书签…'}
                  autoComplete="off"
                  data-1p-ignore=""
                  data-lpignore="true"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  title="搜索（Ctrl+K）"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && input) {
                      setInput('')
                      setSearchQuery('')
                    }
                    // 回车直达：仅唯一搜索结果打开，与点击卡片一致（新标签页）。
                    if (e.key === 'Enter' && !batchMode) {
                      const hit = getSingleSearchMatch(bmData?.bookmarks ?? [], categoryNames, input, idSearchMode)
                      if (hit) openInNewTab(hit.url)
                    }
                  }}
                />
                <button
                  type="button"
                  className={`search-icon-btn ${idSearchMode ? 'active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    toggleIdSearchMode()
                    // 同时 focus 搜索框：激活 ID 模式或关闭 ID 模式后用户都期望能直接输入
                    focusSearch()
                  }}
                  title={idSearchMode ? '已开启 ID 搜索（点击关闭）' : '开启 ID 搜索（免输 #）'}
                  aria-label={idSearchMode ? '关闭 ID 搜索模式' : '开启 ID 搜索模式'}
                  aria-pressed={idSearchMode}
                >
                  <Search size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                {/* 等防抖搜索清空后再显示 Ctrl+K，避免与上一轮结果计数短暂重叠。 */}
                {!input && !searchQuery && <span className="shortcut-kbd search-kbd">Ctrl+K</span>}
                {/* 搜索结果计数：常驻显示（搜索框不再收缩）。*/}
                <SearchCount />
                <SearchEnterHint query={input} visible={searchEnterTarget != null} />
                {/* 清空按钮：仅在已有输入时显示（无收起动作，故无"关闭"语义）*/}
                {input && (
                  <button
                    type="button"
                    className="clear-btn visible"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setInput('')
                      setSearchQuery('')
                      searchInputRef.current?.focus()
                    }}
                    aria-label="清空"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
              {/* 偏好按钮靠右：用 .main-top-actions 包裹，margin-left:auto 推到末尾，
                  margin-right 让它整体往左收，与下方卡片网格右缘保持对齐并自适应跟随。*/}
              <div className="main-top-actions" style={{ marginRight: topInset }}>
                {/* 操作组：批量 + AI + 设置 收进统一胶囊容器，内部按钮透明化只留图标，
                    避免各自独立飘散；头像（身份 + 同步状态）保持独立在右侧。 */}
                {/* 组内容器高度 = 32px 按钮 + 6px 内边距 + 2px 边框 = 40px，与搜索框/头像对齐 */}
                <div className="flex items-center gap-2 rounded-full border border-(--border) bg-(--bg-secondary) p-[3px] shrink-0">
                  <button
                    className={`btn batch-toggle-btn ${batchMode ? 'active' : ''}`}
                  onClick={toggleBatchMode}
                  aria-label="批量操作"
                  aria-pressed={batchMode}
                  title="批量操作（Ctrl+B）"
                >
                    <CheckCheck size={16} strokeWidth={2} />
                    <span>批量</span>
                  </button>
                  <TopbarAIButton className="w-8 h-8" />
                </div>
                <TopbarAvatar className="h-10" />
              </div>
            </div>
          </div>
          <div className="main-content scrollbar-hover">{children}</div>
        </main>
      </div>
      {/* 悬浮添加书签按钮：帮助页隐藏（独立全屏页，无新建书签入口，对齐移动端 Dock 帮助页也无"添加"按钮）*/}
      {!isFullPage && <AddBookmarkFab />}
    </div>
  )
}
