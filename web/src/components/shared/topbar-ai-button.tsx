import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useQueries } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { ContextMenu, type MenuItem } from '@/components/ui/dropdown-menu'
import { getAISettings, switchAIProvider, testAIConnection } from '@/api/settings'
import { AI_PRESETS } from '@/lib/ai-providers'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { createTimeoutSignal } from '@/lib/abort'
import { useUIStore } from '@/stores/ui'

const CLOSE_DELAY = 150

/**
 * 顶栏 AI 模型快速切换按钮 —— 交互照搬 TopbarAvatar（桌面悬停展开下拉，触摸走点击）。
 *
 * - 按钮：36×36 圆形，显示当前 activeProvider 的 logo（一眼看到当前模型），无 logo 用 Sparkles。
 * - 下拉：header「模型管理」（点击跳设置 AI tab）+ 每个 savedConfig 一项（供应商 logo + 模型名 + 当前激活 Check）。
 * - 点击：switchAIProvider 切换 + invalidate 刷新 + toast。
 * - 没配置任何 provider（savedProviders 空）时不渲染。
 */
export function TopbarAIButton({
  className,
  scaleContainerWhenOpen = false,
}: {
  className?: string
  scaleContainerWhenOpen?: boolean
} = {}) {
  const qc = useQueryClient()
  const { data: aiData } = useQuery({ queryKey: ['ai-settings'], queryFn: getAISettings })
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const openMenu = useCallback(
    (x: number, y: number) => {
      cancelClose()
      setMenu({ x, y })
    },
    [cancelClose],
  )

  const closeMenu = useCallback(() => {
    closeTimer.current = setTimeout(() => setMenu(null), CLOSE_DELAY)
  }, [])

  const handleButtonClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      // 移动端（<=768）右对齐到视口右边（与头像 / 分类卡片视觉统一靠右），桌面保持 center（在按钮下方）
      const isMobile = window.innerWidth <= 768
      if (menu) closeMenu()
      else openMenu(isMobile ? window.innerWidth - 10 : r.left + r.width / 2, r.bottom + 6)
    },
    [menu, openMenu, closeMenu],
  )

  const handleButtonEnter = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // 仅鼠标悬停展开；触摸走 click 路径（同 TopbarAvatar，否则 tap 合成 mouseenter 先开菜单、
      // 紧随的 click 被 ContextMenu 点外监听捕获 -> 菜单瞬间关掉）
      if (e.pointerType !== 'mouse') return
      if (menu) return
      const r = e.currentTarget.getBoundingClientRect()
      const isMobile = window.innerWidth <= 768
      openMenu(isMobile ? window.innerWidth - 10 : r.left + r.width / 2, r.bottom + 6)
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

  const onSwitch = useCallback(
    async (configId: number, provider: string) => {
      try {
        await switchAIProvider(configId)
        await qc.invalidateQueries({ queryKey: ['ai-settings'] })
        toast.success('已切换到 ' + (AI_PRESETS[provider]?.label || provider))
      } catch (e) {
        toast.error('切换失败: ' + (e as Error).message)
      }
    },
    [qc],
  )

  // 「切换模型」header 点击 → 打开设置并切到 AI tab
  const openAISettings = useCallback(() => {
    setSettingsTab('ai')
    setSettingsOpen(true)
  }, [setSettingsTab, setSettingsOpen])

  const savedConfigs = aiData?.savedConfigs ?? []
  const activeProvider = aiData?.activeProvider
  const activeConfigId = aiData?.activeConfigId

  // 连通性检测：菜单展开时并发测每个配置（staleTime 5 分钟缓存，失败不重试）。
  // 后端 max_tokens:1 最小探针，token 消耗 ≈ 0；不传 apiKey，后端解密 DB 里已保存的。
  const tests = useQueries({
    queries: savedConfigs.map((c) => ({
      queryKey: ['ai-test', c.id],
      queryFn: ({ signal }) => {
        // 顶栏下拉用户被动看，react-query 默认 fetch 无超时；
        // 10s 自动 abort：正常 2~5s 应答，10s 覆盖抖动 + 给真黑洞/端点下线明确"超时"信号
        const { signal: reqSignal } = createTimeoutSignal(signal, 10000)
        return testAIConnection(
          { configId: c.id, provider: c.provider, model: c.model, baseUrl: c.baseUrl, apiFormat: c.apiFormat },
          reqSignal,
        )
      },
      enabled: !!menu,
      staleTime: 5 * 60 * 1000,
      retry: 0,
    })),
  })

  // 预加载所有 provider logo：刷新后首次展开下拉，非激活项 logo 已进 HTTP 缓存，img 秒显不闪
  useEffect(() => {
    savedConfigs.forEach((c) => {
      const logo = AI_PRESETS[c.provider]?.logo
      if (logo) {
        const img = new Image()
        img.src = logo
      }
    })
  }, [savedConfigs])

  // 没配置任何配置不渲染（无可切换项）。hooks 全在上方，return 顺序合法。
  if (savedConfigs.length === 0) return null

  // 移动端（<=768）右对齐到视口右边（与头像 / 分类卡片视觉统一靠右），桌面保持 center（在按钮下方）
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768

  const activeLogo = activeProvider ? AI_PRESETS[activeProvider]?.logo : undefined

  // 连通性状态点：灰检测中 / 绿可用 / 橙欠费(402) / 红失效(其他错误)
  const dotFor = (i: number) => {
    const t = tests[i]
    if (!t || t.isPending) return { cls: 'loading', title: '检测中…' }
    if (t.data?.ok) return { cls: 'ok', title: `可用（${t.data.latency ?? 0}ms）` }
    if (t.data?.statusCode === 402) return { cls: 'warn', title: '欠费（余额不足）' }
    return { cls: 'error', title: t.data?.error || '连接失败' }
  }

  const items: MenuItem[] = [
    { header: true, label: '模型管理', icon: <Bot size={14} />, onClick: openAISettings },
    { separator: true, label: '' },
    ...savedConfigs.map((c, i) => {
      const logo = AI_PRESETS[c.provider]?.logo
      const dot = dotFor(i)
      return {
        label: c.model || AI_PRESETS[c.provider]?.label || c.provider,
        icon: logo ? (
          <img src={logo} alt="" className="w-4 h-4 object-contain" />
        ) : (
          <Bot size={14} />
        ),
        active: c.id === activeConfigId,
        trailing: (
          <span
            className={cn('ai-status-dot', dot.cls, dot.cls === 'loading' && 'animate-pulse')}
            title={dot.title}
          />
        ),
        onClick: () => onSwitch(c.id, c.provider),
      }
    }),
  ]

  return (
    <>
      <button
        type="button"
        className={cn(
          'group w-9 h-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors duration-200 ease-out hover:bg-(--bg-primary) hover:text-(--accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) text-(--text-secondary)',
          menu && 'bg-(--bg-primary) text-(--accent)',
          scaleContainerWhenOpen && menu && 'scale-105',
          className,
        )}
        onClick={handleButtonClick}
        onPointerEnter={handleButtonEnter}
        onPointerLeave={handleButtonLeave}
        aria-label="切换 AI 模型"
        aria-expanded={!!menu}
      >
        <span
          className={cn(
            'flex items-center justify-center transition-transform duration-200 ease-out',
            !scaleContainerWhenOpen && 'group-hover:scale-105',
            menu && !scaleContainerWhenOpen && 'scale-105',
          )}
        >
          {activeLogo ? (
            <img src={activeLogo} alt="" className="w-[22px] h-[22px] object-contain" />
          ) : (
            <Bot size={22} />
          )}
        </span>
      </button>
      <ContextMenu
        open={!!menu}
        onClose={() => setMenu(null)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={items}
        onMouseEnter={cancelClose}
        onMouseLeave={closeMenu}
        anchor={isMobile ? 'right' : 'center'}
        alignY="top"
      />
    </>
  )
}
