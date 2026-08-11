import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HelpCircle, LogOut, Moon, Settings, Sun, Cat, User, Radio } from 'lucide-react'
import { ContextMenu, type MenuItem } from '@/components/ui/dropdown-menu'
import { applyTheme } from '@/components/shared/theme-toggle'
import { useAvatar } from '@/hooks/use-avatar'
import { resolveAvatarIcon, getCustomAvatarUrl } from '@/lib/avatar-icons'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { getNickname } from '@/api/settings'
import { cn } from '@/lib/utils'

const CLOSE_DELAY = 150

/** WS 连接状态 → 角标颜色/脉冲/标签（颜色走 theme.css token，复用 .ai-status-dot 语义）*/
const WS_DOT: Record<string, { color: string; pulse: boolean; label: string }> = {
  connected:    { color: 'var(--status-ok)',   pulse: false, label: '已连接' },
  reconnecting: { color: 'var(--status-warn)', pulse: true,  label: '重连中' },
  disconnected: { color: 'var(--destructive)', pulse: false, label: '已断开' },
}

function getInitialTheme(): 'notion-dark' | 'light' {
  if (typeof document === 'undefined') return 'light'
  return (document.documentElement.dataset.theme as 'notion-dark' | 'light') || 'light'
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
  hideSettings = false,
  className,
}: { hideSettings?: boolean; className?: string } = {}) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)
  const { data: avatarData } = useAvatar()
  const { data: nicknameData } = useQuery({
    queryKey: ['auth-nickname'],
    queryFn: getNickname,
  })

  const [theme, setTheme] = useState<'notion-dark' | 'light'>(getInitialTheme)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const customUrl = getCustomAvatarUrl(avatarData?.avatar, avatarData?.avatarImage)
  const AvatarIcon = resolveAvatarIcon(avatarData?.avatar) ?? Cat
  const avatarColor = avatarData?.avatarColor || '#f59e0b'
  const nickname = nicknameData?.nickname || '用户'
  const wsStatus = useUIStore((s) => s.wsStatus)
  const initialConnection = wsStatus === 'initial'
  const dot = WS_DOT[wsStatus] ?? WS_DOT.connected

  // 监听 storage 事件：其他标签页或 ThemeToggle 切换主题时同步 label/icon。
  useEffect(() => {
    const sync = () => {
      const t = (document.documentElement.dataset.theme as 'notion-dark' | 'light') || 'light'
      setTheme(t)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
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

  const closeMenu = useCallback(() => {
    closeTimer.current = setTimeout(() => setMenu(null), CLOSE_DELAY)
  }, [])

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

  const toggleTheme = useCallback(() => {
    const next = theme === 'notion-dark' ? 'light' : 'notion-dark'
    setTheme(next)
    applyTheme(next)
  }, [theme])

  const items: MenuItem[] = [
    {
      header: true,
      label: nickname,
      icon: <User size={14} />,
      onClick: () => {
        setSettingsTab('account')
        setSettingsOpen(true)
      },
    },
    { separator: true, label: '' },
    {
      header: true,
      label: initialConnection ? '连接中' : dot.label,
      icon: <Radio size={14} />,
      labelColor: dot.color,
    },
    { separator: true, label: '' },
    {
      label: theme === 'notion-dark' ? '浅色' : '深色',
      icon: theme === 'notion-dark' ? <Sun size={14} /> : <Moon size={14} />,
      onClick: toggleTheme,
    },
    ...(hideSettings
      ? []
      : [
          {
            label: '设置',
            icon: <Settings size={14} />,
            onClick: () => setSettingsOpen(true),
          },
        ]),
    { separator: true, label: '' },
    {
      label: '帮助',
      icon: <HelpCircle size={14} />,
      onClick: () => window.open('/help', '_blank', 'noopener,noreferrer'),
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
        onClose={() => setMenu(null)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={items}
        onMouseEnter={cancelClose}
        onMouseLeave={closeMenu}
        anchor="center"
        alignY="top"
      />
    </>
  )
}
