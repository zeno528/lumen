import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Sparkles } from 'lucide-react'
import { AI_PRESETS, CUSTOM_PROVIDER_PRESET, type AIProviderPreset } from '@/lib/ai-providers'
import { cn } from '@/lib/utils'

/**
 * AI Provider 下拉 —— trigger 是 button（只选预设厂商，不能输入）。
 *
 * 视觉协议：
 * - trigger：左 logo + 中文 label，右 ChevronDown（打开时旋转 180°）
 * - option：左 logo + label + 右侧 format hint
 * - placeholder：未选中时显示"-- 选择提供商 --"
 * - 已保存 provider：右侧绿色圆点 badge（props.savedProviders 传入）
 *
 * listbox 用 portal + position:fixed 跳出 ancestor backdrop-filter 污染。
 */

interface ProviderSelectOption {
  value: string
  preset: AIProviderPreset
  saved?: boolean
  active?: boolean
}

interface ProviderSelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  options: ProviderSelectOption[]
  placeholder?: string
  /** 自定义 trigger 样式（提供时绕过默认 .dropdown-trigger，完全自定义 -- 用于卡片式触发器）*/
  triggerClassName?: string
  /** 自定义 trigger 内容（提供时不渲染默认 logo/placeholder/chevron）*/
  triggerChildren?: ReactNode
}

export function ProviderSelect({
  id,
  value,
  onChange,
  options,
  placeholder = '-- 选择提供商 --',
  triggerClassName,
  triggerChildren,
}: ProviderSelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [listPos, setListPos] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)

  // 打开时按 trigger 位置定位 listbox（commit 后同步算，避免布局抖动）
  useLayoutEffect(() => {
    if (!open) {
      setListPos(null)
      return
    }
    const update = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (!r) return
      setListPos({ left: r.left, top: r.bottom + 4, width: r.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // 全局关闭：点外面 / Esc（仅在 open 时挂载，节省监听）
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (listRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  const onPick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const listbox = open && listPos && (
    <div
      ref={listRef}
      className="provider-options dropdown-options show"
      style={{
        position: 'fixed',
        left: listPos.left,
        top: listPos.top,
        width: listPos.width,
        maxHeight: '320px',
      }}
      role="listbox"
    >
      {options.map((o) => (
        <div
          key={o.value}
          className={cn(
            'dropdown-option',
            o.value === value && 'active',
            o.saved && 'has-badge',
          )}
          onMouseDown={(e) => {
            // mousedown 比 click 早，不丢 trigger 焦点
            e.preventDefault()
            onPick(o.value)
          }}
          role="option"
          aria-selected={o.value === value}
        >
          <span className="dropdown-option-prefix">
            <ProviderLogo preset={o.preset} />
          </span>
          <span className="dropdown-option-label">{o.preset.label}</span>
          <span className="dropdown-option-suffix provider-hint">
            {o.preset.format}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="dropdown-select provider-select" id={id}>
      <button
        ref={triggerRef}
        type="button"
        data-open={open || undefined}
        className={
          triggerClassName
            ? triggerClassName
            : cn('dropdown-trigger provider-trigger', open && 'open', !selected && 'placeholder')
        }
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {triggerChildren != null ? (
          triggerChildren
        ) : (
          <>
            {selected ? (
              <>
                <ProviderLogo preset={selected.preset} />
                <span className="dropdown-trigger-label provider-trigger-label">
                  {selected.preset.label}
                </span>
              </>
            ) : (
              <span className="dropdown-trigger-label provider-trigger-label">{placeholder}</span>
            )}
            <ChevronDown size={14} className="dropdown-trigger-chevron provider-trigger-chevron" />
          </>
        )}
      </button>

      {listbox && createPortal(listbox, document.body)}
      {/* 隐藏 input 留给表单 / 测试用 */}
      <input type="hidden" value={value} readOnly />
    </div>
  )
}

/** 厂商 logo —— 有 SVG 走 SVG，没 logo 走 Sparkles 占位（避免大小跳动） */
function ProviderLogo({ preset }: { preset: AIProviderPreset }) {
  if (preset.logo) {
    return <img src={preset.logo} alt="" className="provider-logo dropdown-trigger-logo" />
  }
  return (
    <span className="provider-logo-fallback dropdown-trigger-logo-fallback">
      <Sparkles size={14} />
    </span>
  )
}

/** 复用入口：传入 AI_PROVIDER_ORDER + 已保存列表 → 转成 ProviderSelectOption[] */
export function buildProviderOptions(
  order: string[],
  saved: { provider: string }[] = [],
  active: string = '',
): ProviderSelectOption[] {
  const savedSet = new Set(saved.map((s) => s.provider))
  return order.map((p) => ({
    value: p,
    preset: p === 'custom' ? CUSTOM_PROVIDER_PRESET : (AI_PRESETS[p] ?? CUSTOM_PROVIDER_PRESET),
    saved: savedSet.has(p),
    active: p === active,
  }))
}