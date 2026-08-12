import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, HelpCircle, LogOut, Moon, Settings, Sun, Monitor, Cat, type LucideIcon } from 'lucide-react'
import { ContextMenu, type MenuItem } from '@/components/ui/dropdown-menu'
import { applyTheme, getSavedTheme, THEME_CHANGE_EVENT, THEME_OPTIONS, type Theme } from '@/lib/theme'
import { useAvatar } from '@/hooks/use-avatar'
import { resolveAvatarIcon, getCustomAvatarUrl } from '@/lib/avatar-icons'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { getNickname } from '@/api/settings'
import { cn, openInNewTab } from '@/lib/utils'

const CLOSE_DELAY = 150
const AVATAR_MENU_WIDTH = 184

const THEME_ICONS: Record<Theme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  'notion-dark': Moon,
}

/** WS 连接状态 → 角标颜色/脉冲/标签（颜色走 theme.css token，复用 .ai-status-dot 语义）*/
const WS_DOT: Record<string, { color: string; pulse: boolean; label: string }> = {
  connected:    { color: 'var(--status-ok)',   pulse: false, label: '已连接' },
  reconnecting: { color: 'var(--status-warn)', pulse: true,  label: '重连中' },
  disconnected: { color: 'var(--destructive)', pulse: false, label: '已断开' },
}

/**
 * 顶栏用户头像 —— 点击或悬停展开下拉卡片。
 *
 * - 桌面：鼠标悬停头像展开，移出关闭；点击可显式 toggle。
 * - 移动端：无 hover，点击展开，点外部/菜单项关闭。
 * - 菜单包含：主题切换、设置、帮助、登出。
 * - 头像优先显示用户自定义图片；未选自定义时显示内置图标。
 */
export function TopbarAvatar({
  className,
}: { className?: string } = {}) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)
  const { data: avatarData } = useAvatar()
  const { data: nicknameData } = useQuery({
    queryKey: ['auth-nickname'],
    queryFn: getNickname,
  })

  const [theme, setTheme] = useState<Theme>(getSavedTheme)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [menuView, setMenuView] = useState<'main' | 'theme'>('main')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const customUrl = getCustomAvatarUrl(avatarData?.avatar, avatarData?.avatarImage)
  const AvatarIcon = resolveAvatarIcon(avatarData?.avatar) ?? Cat
  const avatarColor = avatarData?.avatarColor || '#f59e0b'
  const nickname = nicknameData?.nickname || '用户'
  const wsStatus = useUIStore((s) => s.wsStatus)
  const initialConnection = wsStatus === 'initial'
  const dot = WS_DOT[wsStatus] ?? WS_DOT.connected

  // 监听同页和跨标签页主题变化，避免菜单显示旧的选中态。
  useEffect(() => {
    const sync = () => setTheme(getSavedTheme())
    window.addEventListener('storage', sync)
    window.addEventListener(THEME_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(THEME_CHANGE_EVENT, sync)
    }
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const openMenu = useCallback((x: number, y: number) => {
    cancelClose()
    setMenu({ x, y })
  }, [cancelClose])

  const dismissMenu = useCallback(() => {
    setMenu(null)
    setMenuView('main')
  }, [])

  const closeMenu = useCallback(() => {
    closeTimer.current = setTimeout(dismissMenu, CLOSE_DELAY)
  }, [dismissMenu])

  const handleButtonClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      if (menu) {
        closeMenu()
      } else {
        // 头像正下方 + 水平居中：x=头像水平中心，y=头像底部；配合 anchor="center" + alignY="top"
        openMenu(r.left + r.width / 2, r.bottom + 6)
      }
    },
    [menu, openMenu, closeMenu],
  )

  const handleButtonEnter = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // 仅鼠标悬停展开；触摸走 click 路径。否则 tap 合成的 mouseenter 会先打开菜单、
      // 紧随其后的 click 被 ContextMenu 的 document 关闭监听捕获 -> 菜单瞬间关掉
      if (e.pointerType !== 'mouse') return
      if (menu) return
      const r = e.currentTarget.getBoundingClientRect()
      // 与 click 同一套坐标：头像正下方 + 水平居中
      openMenu(r.left + r.width / 2, r.bottom + 6)
    },
    [menu, openMenu],
  )

  const handleButtonLeave = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType !== 'mouse') return
      closeMenu()
    },
    [closeMenu],
  )

  const selectTheme = useCallback((next: Theme) => {
    setTheme(next)
    applyTheme(next)
  }, [])

  const activeTheme = THEME_OPTIONS.find((option) => option.value === theme)!
  const ActiveThemeIcon = THEME_ICONS[theme]
  const items: MenuItem[] = menuView === 'theme' ? [
    {
      label: '返回',
      icon: <ChevronLeft size={14} />,
      onClick: () => setMenuView('main'),
      keepOpen: true,
    },
    { separator: true, label: '' },
    ...THEME_OPTIONS.map(({ value, label }) => {
      const Icon = THEME_ICONS[value]
      return {
        label,
        icon: <Icon size={14} />,
        active: theme === value,
        onClick: () => selectTheme(value),
      }
    }),
  ] : [
    {
      label: '设置',
      icon: <Settings size={14} />,
      trailing: <kbd className="shortcut-kbd">Ctrl+,</kbd>,
      onClick: () => {
        setSettingsTab('account')
        setSettingsOpen(true)
      },
    },
    {
      label: '主题',
      icon: <ActiveThemeIcon size={14} />,
      trailing: <span className="inline-flex items-center gap-1 text-xs text-(--text-muted)">{activeTheme.label}<ChevronRight size={14} /></span>,
      onClick: () => setMenuView('theme'),
      keepOpen: true,
    },
    { separator: true, label: '' },
    {
      label: '帮助',
      icon: <HelpCircle size={14} />,
      onClick: () => openInNewTab('/help'),
    },
    {
      label: '登出',
      icon: <LogOut size={14} />,
      variant: 'delete',
      onClick: () => {
        logout()
        navigate({ to: '/login' })
      },
    },
  ]

  return (
    <>
      <button
        type="button"
        className={cn(
          'topbar-icon-btn w-24 h-9 rounded-full pl-1 pr-2 flex items-center gap-1.5 shrink-0 cursor-pointer transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) border bg-(--bg-secondary)',
          menu ? 'menu-open scale-105' : 'border-(--border)',
          className,
        )}
        onClick={handleButtonClick}
        onPointerEnter={handleButtonEnter}
        onPointerLeave={handleButtonLeave}
        aria-label={`用户菜单 · 实时同步：${initialConnection ? '初始连接中' : dot.label}`}
        aria-expanded={!!menu}
      >
        <span className="relative w-7 h-7 shrink-0">
          <span className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-(--bg-secondary)">
            {customUrl ? (
              <img src={customUrl} alt="头像" className="w-full h-full object-cover" loading="eager" decoding="sync" />
            ) : (
              <span className="w-full h-full rounded-full flex items-center justify-center" style={{ background: avatarColor + '22', color: avatarColor }}>
                <AvatarIcon size={18} />
              </span>
            )}
          </span>
          <span className={cn('absolute -right-0.5 -bottom-0.5 w-[10px] h-[10px] rounded-full border-2 border-(--bg-secondary)', initialConnection && 'invisible', dot.pulse && 'animate-pulse')} style={{ background: dot.color }} />
        </span>
        <span className="flex-1 min-w-0 text-xs font-medium truncate text-(--text-primary)" title={nickname}>{nickname}</span>
      </button>
      <ContextMenu
        open={!!menu}
        onClose={dismissMenu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={items}
        onMouseEnter={cancelClose}
        onMouseLeave={closeMenu}
        anchor="center"
        alignY="top"
        minWidth={AVATAR_MENU_WIDTH}
      />
    </>
  )
}
