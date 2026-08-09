import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from './input'

/**
 * 可输入下拉框（Combobox）-- 用于分类选择 / 模型选择等"可输入 + 可选预设"场景。
 *
 * 交互：trigger 输入框可直接打字（输入即值，输入预设外的值也合法），
 * 也可点下拉选预设。下拉按 trigger 输入过滤。
 * - 模型：trigger 输入自定义 ID = model 值
 * - 分类：trigger 输入新分类名 = categoryName，submit 时创建（调用方处理）
 *
 * 实现：trigger 用 <Input>，下拉用 createPortal 出去的 listbox
 * （脱离 modal-body overflow 裁剪，跳出祖先 backdrop-filter 污染）。
 */

export interface ComboboxOption {
  value: string
  label: string
  icon?: React.ReactNode
  color?: string
}

export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyText?: string
  className?: string
  inputClassName?: string
  /** 回车回调：分类框按回车触发保存（与 URL/标题框一致，Ctrl+Enter 由全局快捷键处理）*/
  onEnter?: () => void
  /** 下拉列表最大高度（px），超出滚动。默认 240，分类框传较小值收窄只露几项 */
  listMaxHeight?: number
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  emptyText = '无匹配项',
  className,
  inputClassName,
  onEnter,
  listMaxHeight = 240,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
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

  const hasExactMatch = options.some(
    (o) => o.label.toLowerCase() === value.toLowerCase(),
  )
  // 有匹配 -> 过滤（搜索）；无匹配（自定义值）-> 显示全部预设，方便切换
  const filtered = useMemo(() => {
    if (!value || hasExactMatch) return options
    const matches = options.filter((o) => o.label.toLowerCase().includes(value.toLowerCase()))
    return matches.length > 0 ? matches : options
  }, [value, hasExactMatch, options])

  const onPick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const listbox = open && listPos && (
    <div
      ref={listRef}
      className="combobox-dropdown dropdown-options show"
      style={{
        position: 'fixed',
        left: listPos.left,
        top: listPos.top,
        width: listPos.width,
        maxHeight: `${listMaxHeight}px`,
      }}
      role="listbox"
    >
      {filtered.length === 0 && <div className="dropdown-option-empty">{emptyText}</div>}
      {filtered.map((o) => (
        <div
          key={o.value}
          className={cn(
            'dropdown-option',
            o.label === value && 'active',
          )}
          onMouseDown={(e) => {
            // mousedown 比 click 早，且不会丢 input 焦点
            e.preventDefault()
            onPick(o.label)
          }}
          role="option"
          aria-selected={o.label === value}
        >
          {o.icon && (
            <span className="dropdown-option-prefix">
              <span className="w-5 h-5 inline-flex items-center justify-center shrink-0">
                {o.icon}
              </span>
            </span>
          )}
          <span className="dropdown-option-label">{o.label}</span>
          {o.color && (
            <span className="dropdown-option-suffix">
              <span
                className="w-2 h-2 rounded-full shrink-0 inline-block"
                style={{ background: o.color }}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className={cn('combobox relative', className)}>
      <div ref={triggerRef} className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onMouseDown={() => {
            // 点击输入框关闭下拉：用户点输入框 = 要输入/搜索，列表保持展开不符合逻辑
            if (open) setOpen(false)
          }}
          onKeyDown={(e) => {
            // 回车触发保存（与 URL/标题框一致）；Ctrl+Enter 由全局快捷键处理
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && onEnter) {
              e.preventDefault()
              setOpen(false)
              onEnter()
            }
          }}
          placeholder={placeholder}
          className={cn('combobox-input pr-[52px]', inputClassName)}
        />
        {value && (
          <button
            type="button"
            className="input-clear-btn absolute right-8 top-1/2 -translate-y-1/2 text-(--text-muted) hover:text-(--text-primary) p-0.5 transition-colors z-[1]"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onChange('')}
            tabIndex={-1}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? '收起选项' : '展开选项'}
          className="absolute right-0 top-0 bottom-0 w-[52px] flex items-center justify-end pr-3 cursor-pointer text-(--text-muted) hover:text-(--text-primary) transition-colors"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            size={14}
            className={cn('transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </div>
      {listbox && createPortal(listbox, document.body)}
    </div>
  )
}
