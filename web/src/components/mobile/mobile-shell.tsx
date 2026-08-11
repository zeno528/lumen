import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Search, Plus, CheckCheck, X, Menu, PanelLeft, Rocket, Keyboard, ChevronDown, Layers, Star, Folder, Bookmark } from 'lucide-react'
import { TopbarAvatar } from '@/components/shared/topbar-avatar'
import { TopbarAIButton } from '@/components/shared/topbar-ai-button'
import { ContextMenu, type MenuItem } from '@/components/ui/dropdown-menu'
import { Sidebar } from '@/components/desktop/sidebar'
import { useBookmarks } from '@/hooks/useBookmarks'
import { useCategories } from '@/hooks/useCategories'
import { resolveCategoryIcon } from '@/lib/icon-map'
import { useUIStore } from '@/stores/ui'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { SearchCount } from '@/components/shared/search-count'
import { cn } from '@/lib/utils'
import { useRouterState, useNavigate } from '@tanstack/react-router'

/**
 * 移动端 Shell。
 * - 顶栏压缩：只保留 logo + 搜索图标 + 用户头像（隐藏文字/搜索框）
 * - 底部 Dock（mobile-fab-menu）：4 按钮 = 搜索 / 批量 / 添加 / 回到顶部
 * - 抽屉式 sidebar：复用桌面 Sidebar 组件（含右键菜单/编辑/删除/长按，零重复）
 *   CSS 窄屏把 .sidebar 改 fixed 抽屉，移动端传 open 滑入
 * - 移动端搜索栏（点击 Dock 搜索图标展开，顶部胶囊条）+ 结果计数
 * - 批量模式时 Dock 完全隐藏（CSS .dock-hidden）
 */
export function MobileShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Dock 滚动隐藏
  const mainRef = useRef<HTMLElement>(null)
  const [dockHide, setDockHide] = useState(false)
  // 返回书签过渡：flushSync 同步隐藏 main，避免 BookmarksPage concurrent 渲染期间帮助页 UI 残影
  const [switching, setSwitching] = useState(false)

  const {
    searchQuery,
    setSearchQuery,
    batchMode,
    toggleBatchMode,
    toggleHelpToc,
    bookmarkDialog,
    openCreateBookmark,
    idSearchMode,
    toggleIdSearchMode,
  } = useUIStore()

  // 检测当前路由，决定 Dock 显示书签页按钮还是设置页/帮助页按钮
  const routerState = useRouterState()
  const pathname = routerState.location.pathname
  const isHelpPage = pathname === '/help'
  const navigate = useNavigate()

  const [input, setInput] = useState(searchQuery)
  const debounced = useDebouncedValue(input, 300)
  // 搜索 input 用稳定 ref（不再 inline lambda），避免每次 render 重建 ref 触发 focus 重置
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSearchQuery(debounced)
  }, [debounced, setSearchQuery])

  useEffect(() => {
    setInput(searchQuery)
  }, [searchQuery])

  // searchOpen 变化时 focus（而非 inline ref 每次 render 触发），
  // 避免 store 变化（如 idSearchMode 切换）引起 input 焦点跳动、键盘异常收起
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [searchOpen])

  useHotkeys({
    onFocusSearch: () => {
      setSearchOpen(true)
      requestAnimationFrame(() => document.getElementById('global-search')?.focus())
    },
  })

  // 抽屉打开/关闭时锁滚动
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  // 路由变化时自动关闭侧边栏（帮助页/设置页不需要侧边栏）
  useEffect(() => {
    if (sidebarOpen && isHelpPage) {
      setSidebarOpen(false)
    }
  }, [isHelpPage, sidebarOpen])

  // 已切到书签页后恢复 main 显示。关键：isHelpPage 变 false（router location 更新）早于
  // BookmarksPage 实际 commit（navigate 走 startTransition，渲染期间旧 HelpPage 还挂在 main），
  // 若在 isHelpPage 变 false 时立即恢复，main 会提前 opacity 1 显示残留的 HelpPage（残影）。
  // 所以等 main 真正出现 BookmarksPage 标志（grid / empty-state / 首屏 spinner）才恢复。
  useLayoutEffect(() => {
    if (!isHelpPage && switching) {
      const main = mainRef.current
      const hasBookmarks = () =>
        main?.querySelector('.bookmarks-grid, .empty-state, .animate-spin')
      if (hasBookmarks()) {
        setSwitching(false)
        return
      }
      const obs = new MutationObserver(() => {
        if (hasBookmarks()) {
          setSwitching(false)
          obs.disconnect()
        }
      })
      obs.observe(main!, { childList: true, subtree: true })
      const timeout = window.setTimeout(() => {
        setSwitching(false)
        obs.disconnect()
      }, 2000)
      return () => {
        obs.disconnect()
        window.clearTimeout(timeout)
      }
    }
  }, [isHelpPage, switching])

  // Dock 滚动自动隐藏：向下滚隐藏、停止 300ms 显示、顶部立即显示
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    let scrollTimer: number | null = null
    let ticking = false
    let firstScroll = true // 首次 scroll 跳过：恢复 scroll position 会触发 scroll 事件，
    // 不跳过会 setDockHide(true→false) 播 transition → dock 首次刷新动画（期望首次不动）
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        if (batchMode) {
          ticking = false
          return
        }
        if (firstScroll) {
          firstScroll = false
          ticking = false
          return
        }
        if (el.scrollTop === 0) {
          setDockHide(false)
          if (scrollTimer) window.clearTimeout(scrollTimer)
        } else {
          setDockHide(true)
          if (scrollTimer) window.clearTimeout(scrollTimer)
          scrollTimer = window.setTimeout(() => setDockHide(false), 300)
        }
        ticking = false
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (scrollTimer) window.clearTimeout(scrollTimer)
    }
  }, [batchMode])

  return (
    <div className="app-shell">
      {!isHelpPage && (
        <header className="header">
          <div className="header-top">
            <div
              className="logo"
              onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <img src="/logo_color.svg" alt="Lumen" />
            </div>
            <div className="flex-1" />
            <MobileCategorySelect />
            {/* 移动端无分组容器，恢复描边圆钮样式与其它顶栏按钮一致 */}
            <TopbarAIButton
              className="border border-(--border) bg-(--bg-secondary)"
              scaleContainerWhenOpen
            />
            <TopbarAvatar />
          </div>
        </header>
      )}

      {/* 移动端搜索栏（点击搜索图标展开）。
          右侧按钮 onMouseDown preventDefault：阻止 button 抢 input 焦点，
          防止 iOS/Android 键盘收起（用户感知的"退出输入模式"）。
          搜索计数用共享 SearchCount 显示胶囊样式。*/}
      <div className={cn('mobile-search-bar', searchOpen && 'active')}>
        {/* 左侧搜索图标按钮：点击切换 ID 搜索模式，有背景填充，激活时高亮 */}
        <button
          type="button"
          className={cn('search-icon-btn', idSearchMode && 'active')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            toggleIdSearchMode()
            searchInputRef.current?.focus()
          }}
          title={idSearchMode ? '已开启 ID 搜索（点击关闭）' : '开启 ID 搜索（免输 #）'}
          aria-label={idSearchMode ? '关闭 ID 搜索模式' : '开启 ID 搜索模式'}
          aria-pressed={idSearchMode}
        >
          <Search size={14} aria-hidden="true" />
        </button>
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
        />
        <SearchCount />
        <button
          className="search-close-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (input) {
              setInput('')
              setSearchQuery('')
              searchInputRef.current?.focus()
            } else {
              setSearchOpen(false)
            }
          }}
          aria-label={input ? '清空' : '关闭搜索'}
        >
          <X size={14} />
        </button>
      </div>

      <div className="layout">
        {/* 抽屉遮罩 */}
        <div
          className={cn('sidebar-overlay', sidebarOpen && 'active')}
          onClick={() => setSidebarOpen(false)}
        />
        {/* 抽屉式 sidebar：复用桌面 Sidebar（含右键菜单/编辑/删除/长按，选中分类后关抽屉）*/}
        <MobileSidebarHost open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main ref={mainRef} className={cn('main', switching && 'opacity-0')}>{children}</main>
      </div>

      {/* 底部 Dock：根据当前页面动态切换按钮 */}
      <div className={cn('mobile-fab-menu', batchMode && 'dock-hidden', dockHide && 'dock-hide')}>
        {isHelpPage ? (
          // 帮助页 Dock：目录 / 快速开始 / 快捷键 / 返回书签
          <>
            <button
              onClick={() => toggleHelpToc()}
              aria-label="目录"
            >
              <Menu size={22} />
              <span className="dock-label">目录</span>
            </button>
            <button
              onClick={() => {
                document.getElementById('quick-start')?.scrollIntoView({ behavior: 'smooth' })
              }}
              aria-label="快速开始"
            >
              <Rocket size={22} />
              <span className="dock-label">开始</span>
            </button>
            <button
              onClick={() => {
                document.getElementById('shortcuts')?.scrollIntoView({ behavior: 'smooth' })
              }}
              aria-label="快捷键"
            >
              <Keyboard size={22} />
              <span className="dock-label">快捷键</span>
            </button>
            <button
              onClick={() => {
                // flushSync 同步把 main 隐藏（opacity-0）commit，双 rAF 等浏览器实际 paint 透明态
                // 再 navigate。navigate 走 startTransition，渲染 BookmarksPage 期间屏幕停留在上次
                // paint -- 不先 paint 透明态会残留帮助页 UI。恢复时机由 useLayoutEffect 的
                // MutationObserver 等 BookmarksPage 真正挂载才执行（见上方恢复逻辑）。
                flushSync(() => setSwitching(true))
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    navigate({ to: '/bookmarks' })
                  }),
                )
              }}
              aria-label="返回书签"
            >
              <Bookmark size={22} />
              <span className="dock-label">书签</span>
            </button>
          </>
        ) : (
          // 书签页 Dock：搜索 / 批量 / 添加 / 回到顶部
          <>
            <button
              onClick={() => {
                // Dock "搜索"图标 toggle：取消选中 = 一次性清空搜索 query + 收起搜索栏，
                // 等同于搜索框内 × 关闭按钮功能（区别于 × 是逐步清：先清 input 再关闭）。
                // 这样视图从过滤态恢复、input 重置、键盘收起同步生效。
                if (searchOpen) {
                  setInput('')
                  setSearchQuery('')
                  setSearchOpen(false)
                } else {
                  // 移动浏览器只会为点击手势内的 focus 唤起软键盘；rAF/effect 已脱离手势。
                  flushSync(() => setSearchOpen(true))
                  searchInputRef.current?.focus()
                }
              }}
              className={cn(searchOpen && 'search-active')}
              aria-label="搜索"
            >
              <Search size={22} />
              <span className="dock-label">搜索</span>
            </button>
            <button onClick={toggleBatchMode} aria-label="批量">
              <CheckCheck size={22} />
              <span className="dock-label">批量</span>
            </button>
            <button
              onClick={openCreateBookmark}
              className={cn(bookmarkDialog === 'create' && 'search-active')}
              aria-label="添加"
            >
              <Plus size={22} />
              <span className="dock-label">添加</span>
            </button>
            <button
              onClick={() => setSidebarOpen(true)}
              className={cn(sidebarOpen && 'search-active')}
              aria-label="主侧栏"
            >
              <PanelLeft size={22} />
              <span className="dock-label">主侧栏</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** 分类被点击时关闭抽屉——由 Sidebar 的 onCategoryClick 直接通知，不再用 effect 对比 prev/curr
 *  推断（点已选分类时 currentCategory 不变，旧 effect 不触发，抽屉不收缩）。 */
function MobileSidebarHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sidebar open={open} onCategoryClick={onClose} />
}

/**
 * 移动端顶栏分类快捷选择。
 * - 徽章：当前分类图标 + 名 + 计数 + 箭头，点击 toggle 下拉
 * - 下拉：全部 / 收藏(>0) / 未分类(>0) / 各分类，active 高亮，点选切换 + 关闭
 * - 遮罩：点击关闭
 * 架构升级：React state 驱动显隐（不用 classList），数据复用 useCategories/useBookmarks/useUIStore，
 * counts 逻辑与 desktop/sidebar 一致。
 */
function MobileCategorySelect() {
  const { data: catData } = useCategories()
  const { data: bmData } = useBookmarks()
  const { currentCategory, setCurrentCategory } = useUIStore()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const categories = catData?.categories ?? []
  const bookmarks = bmData?.bookmarks ?? []

  const catIds = new Set(categories.map((c) => c.id))
  const counts = {
    all: bookmarks.length,
    favorites: bookmarks.filter((b) => b.is_favorite).length,
    uncategorized: bookmarks.filter(
      (b) => b.category_id == null || !catIds.has(b.category_id),
    ).length,
  }
  const countByCat = (id: number) =>
    bookmarks.filter((b) => b.category_id === id).length

  // 当前分类信息
  const current = (() => {
    if (currentCategory === 'all')
      return {
        name: '全部',
        icon: <Layers size={13} style={{ color: 'var(--icon-all)' }} />,
        count: counts.all,
      }
    if (currentCategory === '__favorites__')
      return {
        name: '收藏',
        icon: <Star size={13} style={{ color: 'var(--favorite-star)', fill: 'var(--favorite-star)' }} />,
        count: counts.favorites,
      }
    if (currentCategory === '__uncategorized__')
      return {
        name: '未分类',
        icon: <Folder size={13} style={{ color: 'var(--icon-uncategorized)', fill: 'var(--icon-uncategorized)' }} />,
        count: counts.uncategorized,
      }
    const cat = categories.find((c) => c.id === currentCategory)
    if (cat) {
      const Icon = resolveCategoryIcon(cat.icon)
      return {
        name: cat.name,
        icon: <Icon size={13} style={{ color: cat.color || 'var(--default-category-color)' }} />,
        count: countByCat(cat.id),
      }
    }
    return {
      name: '全部',
      icon: <Layers size={13} style={{ color: 'var(--icon-all)' }} />,
      count: counts.all,
    }
  })()

  // 下拉项：复用 ContextMenu —— 与头像 / AI 切换同款锚定 + viewport clamp + ESC + 玻璃范式，不再自造一套。
  // count 走 trailing（label 是 flex-1，trailing 自然靠右）；点选后 ContextMenu 的 onClick 自动 onClose 关闭。
  const countNode = (n: number) => (
    <span className="text-xs text-(--text-secondary) tabular-nums">{n}</span>
  )
  const items: MenuItem[] = [
    {
      label: '全部',
      icon: <Layers size={13} style={{ color: 'var(--icon-all)' }} />,
      active: currentCategory === 'all',
      trailing: countNode(counts.all),
      onClick: () => setCurrentCategory('all'),
    },
  ]
  if (counts.favorites > 0)
    items.push({
      label: '收藏',
      icon: <Star size={13} style={{ color: 'var(--favorite-star)', fill: 'var(--favorite-star)' }} />,
      active: currentCategory === '__favorites__',
      trailing: countNode(counts.favorites),
      onClick: () => setCurrentCategory('__favorites__'),
    })
  if (counts.uncategorized > 0)
    items.push({
      label: '未分类',
      icon: <Folder size={13} style={{ color: 'var(--icon-uncategorized)', fill: 'var(--icon-uncategorized)' }} />,
      active: currentCategory === '__uncategorized__',
      trailing: countNode(counts.uncategorized),
      onClick: () => setCurrentCategory('__uncategorized__'),
    })
  categories.forEach((cat) => {
    const Icon = resolveCategoryIcon(cat.icon)
    items.push({
      label: cat.name,
      icon: <Icon size={13} style={{ color: cat.color || 'var(--default-category-color)' }} />,
      active: currentCategory === cat.id,
      trailing: countNode(countByCat(cat.id)),
      onClick: () => setCurrentCategory(cat.id),
    })
  })

  return (
    <>
      <button
        className={cn('mobile-category-badge', menu && 'open')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          // 锚到视口右边（留 clamp 的 10px 边距）+ anchor=right 向左展开：
          // 分类徽章在三个按钮里最左，照搬头像的 center 锚定会让卡片偏左（center = 卡片中心跟着按钮走），
          // 改成右对齐到窗口右边，与头像 / AI 卡片视觉统一靠右。
          setMenu({ x: window.innerWidth - 10, y: r.bottom + 6 })
        }}
        aria-label="切换分类"
      >
        {current.icon}
        <span className="mobile-category-name">{current.name}</span>
        <span className="mobile-category-count">{current.count}</span>
        <ChevronDown size={10} className="mobile-category-arrow" />
      </button>
      <ContextMenu
        open={!!menu}
        onClose={() => setMenu(null)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={items}
        anchor="right"
        alignY="top"
        minWidth={200}
      />
    </>
  )
}
