import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, User, KeyRound, Bot, Palette, Trash2, Home, ImageUp, type LucideIcon } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SidebarItem } from '@/components/desktop/sidebar-item'
import { AccountSection } from '@/components/settings/account-section'
import { AiSection } from '@/components/settings/ai-section'
import { TokenSection } from '@/components/settings/token-section'
import { AppearanceSection } from '@/components/settings/appearance-section'
import { useUIStore } from '@/stores/ui'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useBatchDelete } from '@/hooks/useBookmarks'
import { useDeleteCategory } from '@/hooks/useCategories'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { Bookmark, Category } from '@/types'

interface TabDef {
  id: 'account' | 'ai' | 'token' | 'appearance'
  title: string
  icon: LucideIcon
  Component: React.ComponentType<{ subView: string | null; onSubView: (v: string | null) => void }>
}

/** 数据驱动标签配置 -- 未来加 cron 等模块 = 加一条 + 对应 Section 组件，零骨架改 */
const TABS: TabDef[] = [
  { id: 'account', title: '账号', icon: User, Component: AccountSection },
  { id: 'appearance', title: '外观', icon: Palette, Component: AppearanceSection },
  { id: 'ai', title: 'AI 设置', icon: Bot, Component: AiSection },
  { id: 'token', title: 'API Token', icon: KeyRound, Component: TokenSection },
]

/** 子操作视图标题 + 图标（Master-Detail 头部显示）*/
const SUBVIEW_META: Record<string, { title: string; icon: LucideIcon }> = {
  'change-username': { title: '修改账号', icon: User },
  'change-password': { title: '修改密码', icon: KeyRound },
  'avatar': { title: '选择头像', icon: ImageUp },
  'ai-add-provider': { title: '选择提供商', icon: Bot },
}

/**
 * 设置界面 -- 桌面模态框 / 移动端全屏，同一份逻辑响应式呈现（架构统一，形式适配设备）。
 *
 * 共享：settingsTab/subView/handleClose/清空/离开确认/数据驱动标签/子操作 Master-Detail 内嵌。
 * 外壳：桌面 Dialog（遮罩+圆角+960 宽）；移动端全屏 div（无遮罩、占满视口，内容区更大）。
 *
 * 关闭逻辑（Master-Detail 退栈）：退离开确认 -> 退清空确认 -> 退子视图 -> 未保存则弹离开确认 -> 真关闭。
 */
export function SettingsDialog() {
  const isMobile = useIsMobile(768)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const activeTab = useUIStore((s) => s.settingsTab)
  const setActiveTab = useUIStore((s) => s.setSettingsTab)

  const [subView, setSubView] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const qc = useQueryClient()
  const batchDelete = useBatchDelete()
  const deleteCat = useDeleteCategory()

  // 计数只读已有缓存，不订阅 query -- 避免每次开设置触发 refetchOnMount 重拉万条书签
  const bmCache = qc.getQueryData<{ bookmarks: Bookmark[] }>(['bookmarks'])
  const catCache = qc.getQueryData<{ categories: Category[] }>(['categories'])
  const allBookmarkIds = bmCache?.bookmarks.map((b) => b.id) ?? []
  const allCategoryIds = catCache?.categories.map((c) => c.id) ?? []

  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0]
  const CurrentSection = currentTab.Component

  const handleClose = () => {
    // 关闭窗口（X / ESC）：先关内嵌确认框 -> 未保存检测 -> 真关闭。
    // 不做「返回上一级」--那是二级页面返回按钮（setSubView(null)）的职责，
    // X 就是关闭整个设置窗口。
    if (confirmLeave) {
      setConfirmLeave(false)
      return
    }
    if (confirmingClear) {
      setConfirmingClear(false)
      return
    }
    if (document.documentElement.dataset.unsavedDirty === 'true') {
      setConfirmLeave(true)
      return
    }
    setSettingsOpen(false)
    // 关闭后 blur 触发元素（齿轮按钮），避免 ESC 键盘关闭后残留 focus-visible 描边
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  // 移动端全屏不走 Dialog（Dialog 自带 ESC 监听），这里补 ESC -> handleClose（用 ref 拿最新闭包）
  const handleCloseRef = useRef(handleClose)
  handleCloseRef.current = handleClose
  useEffect(() => {
    if (!isMobile) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMobile])

  const handleTabChange = (tab: 'account' | 'ai' | 'token' | 'appearance') => {
    setActiveTab(tab)
    setSubView(null)
  }

  const handleClearAll = async () => {
    if (allBookmarkIds.length === 0) return
    try {
      await batchDelete.mutateAsync(allBookmarkIds)
      // 同时删除所有分类（书签都不要了分类自然不要）
      await Promise.all(allCategoryIds.map((id) => deleteCat.mutateAsync({ id })))
      toast.success(
        `已清空 ${allBookmarkIds.length} 个书签${allCategoryIds.length > 0 ? `、${allCategoryIds.length} 个分类` : ''}`,
      )
    } catch (e) {
      toast.error('清空失败: ' + (e as Error).message)
    } finally {
      setConfirmingClear(false)
    }
  }

  const clearAllBlock = (
    <div className="pt-3 mt-3 flex flex-col gap-0.5">
      {confirmingClear ? (
        <div className="flex flex-col gap-1.5 px-1">
          <span className="text-xs text-(--destructive)">确认清空全部书签？此操作不可恢复</span>
          <div className="flex gap-3">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearAll}
              disabled={batchDelete.isPending}
            >
              确认清空
            </Button>
            <Button size="sm" variant="soft" onClick={() => setConfirmingClear(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmingClear(true)}
          disabled={allBookmarkIds.length === 0 || batchDelete.isPending}
          className="flex items-center gap-2 px-2.5 py-2 rounded-md text-sm w-full text-left text-(--destructive) hover:bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] transition-colors disabled:opacity-50"
        >
          <Trash2 size={14} /> 清空所有书签
        </button>
      )}
    </div>
  )

  // 共享内容：左标签栏（桌面 md+）+ 顶部 tab（移动端）+ 右内容区
  // 响应式 CSS（md:）在桌面模态框 / 移动端全屏两种外壳下都基于视口宽度正确切换
  const subMeta = subView ? SUBVIEW_META[subView] : undefined
  const content = (
    <>
      {/* 左标签栏（桌面）*/}
      <aside className="hidden md:flex md:flex-col md:w-[180px] md:shrink-0 md:py-1">
        <nav className="flex-1">
          <ul className="space-y-0.5">
            {TABS.map(({ id, title, icon: Icon }) => (
              <li key={id}>
                <SidebarItem
                  icon={<Icon size={14} />}
                  label={title}
                  active={activeTab === id}
                  onClick={() => handleTabChange(id)}
                  variant="pill"
                />
              </li>
            ))}
          </ul>
        </nav>
        {clearAllBlock}
      </aside>

      {/* 右内容区。移动端 pb-10 = 40px（实测：dialog p-4 底 padding 16px + tab bar 53px - 留 3px 呼吸 ≈ 40px），让卡片滚到底时停在 tab bar 上沿 3px 位置。桌面 md:pb-1 还原。 */}
      <main className="scrollbar-hover flex-1 min-w-0 overflow-y-auto pl-0 pr-4 md:pl-0 md:pr-6 pt-1 pb-10 md:pb-1">
        {confirmLeave ? (
          <div className="flex flex-col gap-3 p-5 rounded-2xl border border-(--border) bg-(--bg-card)">
            <h3 className="text-base font-semibold text-(--text-primary)">有未保存的修改</h3>
            <p className="text-sm text-(--text-secondary)">
              当前修改还未保存，确定要离开吗？离开后修改将丢失。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="soft" onClick={() => setConfirmLeave(false)}>
                取消
              </Button>
              <Button
                onClick={() => {
                  setConfirmLeave(false)
                  setSettingsOpen(false)
                }}
              >
                离开
              </Button>
            </div>
          </div>
        ) : (
          <>
            {subView && (
              <div className="hidden md:flex items-center gap-2 mb-4 pb-2">
                <button
                  onClick={() => setSubView(null)}
                  aria-label="返回上一级"
                  className="group inline-flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <ChevronLeft size={18} className="text-(--text-secondary) transition-colors group-hover:text-(--accent)" />
                  {subMeta && (
                    <subMeta.icon size={16} className="text-(--text-secondary) transition-colors group-hover:text-(--accent)" />
                  )}
                  <h3 className="text-base font-semibold text-(--text-primary) transition-colors group-hover:text-(--accent)">
                    {subMeta?.title ?? ''}
                  </h3>
                </button>
              </div>
            )}
            <CurrentSection subView={subView} onSubView={setSubView} />
            {/* 移动端清空书签（account tab 底部，桌面在左标签栏底部）*/}
            {activeTab === 'account' && !subView && (
              <div className="md:hidden mt-4">{clearAllBlock}</div>
            )}
          </>
        )}
      </main>
    </>
  )

  // 桌面：模态框
  if (!isMobile) {
    return (
      <Dialog open={settingsOpen} onClose={handleClose} title={<span className="inline-block pl-[11px]">设置中心</span>} maxWidth={1080}>
        {/* max-h 用视口 calc 而非 max-h-full：.modal-body 高度是 flex 计算值（非显式 height），
            百分比 max-height 相对它解析为 none 而失效。90vh 为 modal 上限，减 header(66) +
            body 上下 padding(32) + 余量(6) ≈ 104px，确保容器不溢出 modal-body 可视区，
            避免整体轻微滚动、底部「清空书签」被滚出可视区。大窗口仍由 h-[82vh] 主导。 */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 h-[82vh] max-h-[calc(90vh-104px)] md:-mr-5">{content}</div>
      </Dialog>
    )
  }

  // 移动端：全屏（无遮罩/圆角，占满视口，内容区更大；开关无过渡动画）
  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[1000] bg-(--bg-primary) flex flex-col',
        settingsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
    >
      {/* header 始终显示：左侧一级「设置中心」/ 二级「返回+标题」，右侧 Home 始终关闭设置中心回书签页 */}
      <header className="divider-fade-bottom flex items-center justify-between px-4 py-3 shrink-0">
        {subView ? (
          <button
            onClick={() => setSubView(null)}
            aria-label="返回上一级"
            className="inline-flex items-center gap-2 cursor-pointer text-(--text-primary) active:opacity-60 transition-opacity"
          >
            <ChevronLeft size={20} className="text-(--text-secondary)" />
            {subMeta && <subMeta.icon size={18} className="text-(--text-secondary)" />}
            <h3 className="text-base font-semibold">{subMeta?.title ?? ''}</h3>
          </button>
        ) : (
          <span className="text-base font-semibold text-(--text-primary)">设置中心</span>
        )}
        <button
          onClick={handleClose}
          aria-label="返回书签"
          title="返回书签"
          className="flex items-center justify-center w-9 h-9 -mr-1 rounded-full text-(--text-secondary) active:bg-(--bg-secondary) active:scale-95 transition-all cursor-pointer"
        >
          <Home size={20} />
        </button>
      </header>
      <div className="flex-1 flex flex-col overflow-hidden p-4 pr-0">
        <div className="flex flex-col gap-4 flex-1 min-h-0">{content}</div>
      </div>
      {/* 底部 tab bar：贴底毛玻璃操作栏（absolute 浮在内容上，内容滚到 bar 下毛玻璃模糊，iOS 风格）*/}
      <div className="settings-tabbar md:hidden flex gap-1 px-4 py-2 absolute bottom-0 left-0 right-0 rounded-t-2xl">
        {TABS.map(({ id, title, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleTabChange(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm transition-colors ${
              activeTab === id
                ? 'bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent) font-medium'
                : 'text-(--text-secondary) hover:text-(--text-primary)'
            }`}
          >
            <Icon size={14} />
            {title}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
