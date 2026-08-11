import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** 主题深浅：light / notion-dark。导航栏按钮和设置中心「外观」页共享，跨组件复用此类型，别各自重定义。 */
export type Theme = 'light' | 'notion-dark'

function getSavedTheme(): Theme {
  let saved = localStorage.getItem('theme') || 'light'
  if (saved === 'dark') saved = 'notion-dark'
  return saved === 'light' ? 'light' : 'notion-dark'
}

/**
 * 应用主题到 document.documentElement 与 localStorage。
 * 组件外部也用它做初始化同步。
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}

/**
 * 配色方案：赤陶为默认。加新配色 = 在此联合类型加值 + theme.css 加 [data-accent] 块 + AppearanceSection 加卡片。
 * 与主题深浅（data-theme）是两个独立维度：导航栏按钮只切 data-theme，配色由设置中心「外观」页切 data-accent。
 */
export type Accent = 'orange' | 'blue' | 'terracotta' | 'indigo' | 'burgundy' | 'gold'

/** 应用配色到 document.documentElement 与 localStorage（与 applyTheme 对称）。 */
export function applyAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent
  localStorage.setItem('accent', accent)
}

/** 读取已保存的配色：直接用 localStorage 存值，CSS [data-accent] 块未定义该值时 --accent 回退 :root 默认赤陶。加新配色无需改这里。 */
export function getSavedAccent(): Accent {
  return (localStorage.getItem('accent') as Accent) ?? 'terracotta'
}

/**
 * 主题切换按钮。
 *
 * - SVG 太阳/月亮组合图标
 * - hover 时图标整体旋转 30°
 * - data-theme 驱动太阳/月亮显隐 + 缩放旋转过渡
 * - View Transitions API 实现页面整体交叉淡化
 */
export function ThemeToggle({
  className,
  variant = 'icon',
}: {
  className?: string
  variant?: 'icon' | 'pill'
}) {
  const [theme, setTheme] = useState<'notion-dark' | 'light'>(() => {
    if (typeof document === 'undefined') return 'light'
    return (
      (document.documentElement.dataset.theme as 'notion-dark' | 'light') ||
      getSavedTheme()
    )
  })

  useEffect(() => {
    const saved = getSavedTheme()
    setTheme(saved)
    applyTheme(saved)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'notion-dark' ? 'light' : 'notion-dark'
    const doApply = () => {
      setTheme(next)
      applyTheme(next)
    }

    // 不走 View Transitions API：startViewTransition 会把页面渲染成静态快照，
    // .mobile-fab-menu 的 backdrop-filter / box-shadow / saturate 等依赖实时合成
    // 的 iOS 26 Liquid Glass 视觉效果在快照里丢失，表现为 dock 切换瞬间"变透明"。
    // 主题变量瞬时切换由浏览器自动完成视觉过渡。
    doApply()
  }

  const label = theme === 'light' ? '浅色' : '深色'

  return (
    <button
      type="button"
      className={cn(variant === 'pill' ? 'theme-toggle-pill' : 'theme-toggle', className)}
      onClick={toggleTheme}
      aria-label="切换主题"
    >
      <svg
        className="theme-icon"
        width={variant === 'pill' ? 16 : 20}
        height={variant === 'pill' ? 16 : 20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g className="theme-sun">
          <circle className="theme-circle" cx="12" cy="12" r="5" />
          <g className="theme-rays">
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </g>
        </g>
        <path
          className="theme-moon"
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        />
      </svg>
      {variant === 'pill' && <span className="theme-label">{label}</span>}
    </button>
  )
}
