import { useState } from 'react'
import { Palette, Check, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  applyAccent,
  applyTheme,
  getSavedAccent,
  type Accent,
  type Theme,
} from '@/components/shared/theme-toggle'
import { SECTION_CLASS } from './section-styles'

/** 读取已应用的主题：与顶栏一致走 dataset.theme（真值源是 html 节点），localStorage 仅作持久化。 */
function getCurrentTheme(): Theme {
  const v = document.documentElement.dataset.theme
  return v === 'notion-dark' ? 'notion-dark' : 'light'
}

/**
 * 配色方案清单 -- 加新配色在此加一条 + theme.css 加 [data-accent='xxx'] 块 + theme-toggle.tsx 的 Accent 联合类型加值。
 * light/dark 是该配色在两种深浅下的 accent 主色，用于卡片双色预览（与 theme.css 里定义的值保持一致）。
 */
const ACCENTS: { id: Accent; name: string; desc: string; light: string; dark: string }[] = [
  { id: 'terracotta', name: '赤陶', desc: '默认', light: '#c1513f', dark: '#ca6b5c' },
  { id: 'gold', name: '暗金', desc: '奢华典雅', light: '#9a7b3f', dark: '#c2a55c' },
  { id: 'burgundy', name: '勃艮第', desc: '浓郁典雅', light: '#9f1239', dark: '#f43f5e' },
  { id: 'orange', name: '琥珀橙', desc: '温暖明亮', light: '#d97706', dark: '#ffa344' },
  { id: 'indigo', name: '靛蓝', desc: '深邃冷静', light: '#635bff', dark: '#8183ff' },
  { id: 'blue', name: '海洋蓝', desc: '清亮明快', light: '#007aff', dark: '#0a84ff' },
]

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
    // 兜底：若 saved 不在 ACCENTS 里（删配色后的 localStorage 僵尸值 / 外部污染），回退橙色选中
    return ACCENTS.some((a) => a.id === saved) ? saved : 'terracotta'
  })
  const [theme, setTheme] = useState<Theme>(() => getCurrentTheme())

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

        {/* 主题深浅：与顶栏同步，状态由 dataset.theme 单一真值源驱动 */}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-(--text-secondary)">主题</h4>
          <div className="grid grid-cols-2 gap-2.5">
            <ThemeCard
              value="light"
              icon={<Sun size={16} />}
              label="浅色"
              selected={theme === 'light'}
              onSelect={handleSelectTheme}
            />
            <ThemeCard
              value="notion-dark"
              icon={<Moon size={16} />}
              label="深色"
              selected={theme === 'notion-dark'}
              onSelect={handleSelectTheme}
            />
          </div>
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

/** 主题深浅卡片（浅 / 深二选一，视觉与配色卡片统一）。 */
function ThemeCard({
  value,
  icon,
  label,
  selected,
  onSelect,
}: {
  value: Theme
  icon: React.ReactNode
  label: string
  selected: boolean
  onSelect: (next: Theme) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border transition-colors text-left cursor-pointer',
        selected
          ? 'border-(--accent) bg-(--accent-soft-bg)'
          : 'border-(--border) hover:border-(--border-hover) hover:bg-(--bg-card-hover)',
      )}
    >
      <span className="shrink-0 text-(--text-secondary)">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-(--text-primary)">{label}</span>
      </span>
      {selected && <Check size={16} className="text-(--accent) shrink-0" />}
    </button>
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
