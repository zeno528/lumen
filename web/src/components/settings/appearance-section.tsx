import { useState } from 'react'
import { Palette, Check, Sun, Moon, Monitor, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  applyAccent,
  getSavedAccent,
  type Accent,
} from '@/components/shared/theme-toggle'
import { applyTheme, getSavedTheme, THEME_OPTIONS, type Theme } from '@/lib/theme'
import { SECTION_CLASS } from './section-styles'

/**
 * 配色方案清单 -- 加新配色在此加一条 + theme.css 加 [data-accent='xxx'] 块 + theme-toggle.tsx 的 Accent 联合类型加值。
 * light/dark 是该配色在两种深浅下的 accent 主色，用于卡片双色预览（与 theme.css 里定义的值保持一致）。
 */
const ACCENTS: { id: Accent; name: string; desc: string; light: string; dark: string }[] = [
  { id: 'terracotta', name: '赤陶', desc: '默认', light: '#c1513f', dark: '#ca6b5c' },
  { id: 'gold', name: '暗金', desc: '复古暗金', light: '#9a7b3f', dark: '#c2a55c' },
  { id: 'burgundy', name: '勃艮第', desc: '浓郁典雅', light: '#9f1239', dark: '#f43f5e' },
  { id: 'orange', name: '琥珀橙', desc: '温暖明亮', light: '#d97706', dark: '#ffa344' },
  { id: 'indigo', name: '靛蓝', desc: '深邃冷静', light: '#635bff', dark: '#8183ff' },
  { id: 'blue', name: '海洋蓝', desc: '清亮明快', light: '#007aff', dark: '#0a84ff' },
]

const THEME_ICONS: Record<Theme, LucideIcon> = {
  system: Monitor,
  light: Sun,
  'notion-dark': Moon,
}

/**
 * 外观设置 section -- 主题深浅 + 主题配色。
 *
 * 两个独立维度：data-theme（深浅）+ data-accent（配色），都可以在这里选。
 * 与顶栏 ThemeToggle / topbar 菜单项共享同一份 `applyTheme`，状态自动双向同步。
 * 平铺卡片直接选，无子操作，故不消费 subView/onSubView（TabDef 约定 Section 接收这俩 props，本组件忽略）。
 */
export function AppearanceSection() {
  const [accent, setAccent] = useState<Accent>(() => {
    const saved = getSavedAccent()
    // 兜底：若 saved 不在 ACCENTS 里（删配色后的 localStorage 僵尸值 / 外部污染），回退赤陶选中
    return ACCENTS.some((a) => a.id === saved) ? saved : 'terracotta'
  })
  const [theme, setTheme] = useState<Theme>(getSavedTheme)

  const handleSelectAccent = (id: Accent) => {
    if (id === accent) return
    setAccent(id)
    applyAccent(id)
  }

  const handleSelectTheme = (next: Theme) => {
    if (next === theme) return
    setTheme(next)
    applyTheme(next)
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
        <Palette size={16} />
        外观
      </h3>
      <div className={SECTION_CLASS}>

        {/* 主题深浅：紧凑分段控件，三种偏好一步直选。 */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-(--border) bg-(--bg-input) p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-(--text-primary)">主题</span>
            <span className="block text-xs text-(--text-muted)">控制界面深浅</span>
          </span>
          <span className="inline-flex shrink-0 gap-1 rounded-lg border border-(--border) bg-(--bg-secondary) p-1" role="group" aria-label="主题">
            {THEME_OPTIONS.map(({ value, label }) => {
              const Icon = THEME_ICONS[value]
              return <button
                key={value}
                type="button"
                className={cn(
                  'flex h-8 w-9 items-center justify-center rounded-md text-(--text-secondary) transition-colors hover:bg-(--bg-card-hover) hover:text-(--text-primary)',
                  theme === value && 'bg-(--accent-soft-bg) text-(--accent)',
                )}
                onClick={() => handleSelectTheme(value)}
                aria-label={label}
                aria-pressed={theme === value}
                title={label}
              >
                <Icon size={16} />
              </button>
            })}
          </span>
        </div>

        {/* 配色方案：选项与主题深浅独立，可自由组合 */}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-(--text-secondary)">配色方案</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ACCENTS.map((a) => (
              <AccentCard
                key={a.id}
                accent={a}
                selected={a.id === accent}
                onSelect={handleSelectAccent}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/** 配色卡片：双圆点预览该 accent 在浅 / 深两个主题下的主色。 */
function AccentCard({
  accent,
  selected,
  onSelect,
}: {
  accent: { id: Accent; name: string; desc: string; light: string; dark: string }
  selected: boolean
  onSelect: (next: Accent) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(accent.id)}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border transition-colors text-left cursor-pointer',
        selected
          ? 'border-(--accent) bg-(--accent-soft-bg)'
          : 'border-(--border) hover:border-(--border-hover) hover:bg-(--bg-card-hover)',
      )}
    >
      {/* 双色预览：浅色 + 深色各一圆点，叠放展示该配色在两种深浅下的 accent */}
      <span className="flex items-center -space-x-1.5 shrink-0">
        <span
          className="w-5 h-5 rounded-full border border-(--border)"
          style={{ background: accent.light }}
        />
        <span
          className="w-5 h-5 rounded-full border border-(--border)"
          style={{ background: accent.dark }}
        />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-(--text-primary)">{accent.name}</span>
        <span className="block text-xs text-(--text-muted)">{accent.desc}</span>
      </span>
      {selected && <Check size={16} className="text-(--accent) shrink-0" />}
    </button>
  )
}
