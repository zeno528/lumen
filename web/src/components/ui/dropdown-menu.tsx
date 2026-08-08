import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick?: () => void
  variant?: 'default' | 'edit' | 'delete'
  separator?: boolean
  /** 标题项；传 onClick 则变成可点击入口（如「切换模型」→ 跳设置）*/
  header?: boolean
  /** 激活态：accent 高亮 + 末尾 Check（标记当前选中项，如 AI 模型切换的当前 provider）*/
  active?: boolean
  /** 末尾额外节点（label 后、Check 前），如 AI 连通性状态点 */
  trailing?: ReactNode
}

/**
 * 右键/按钮下拉菜单。
 * 用 .show 触发显隐（CSS display: none → block）。
 *
 * **Portal 出去到 document.body**：sidebar 用 .liquid-glass（backdrop-filter）会让
 * `position: fixed` 的 containing block 从 viewport 退化成 sidebar 容器，
 * 配合 sidebar 的 overflow:hidden 导致菜单被裁剪 / 错位。
 * 用 createPortal 渲染到 body 跳出污染，配合 useLayoutEffect 做边界修正（避免渲染期 ref 读取）。
 *
 * **坐标直接读 props**：早期版本用 useState 缓存 x/y + useEffect 二次 setPos 同步，
 * 导致第二次打开菜单时 React 会先以"上次关闭时的旧 pos"commit 一帧，
 * 再 useLayoutEffect 修正 → 用户头像附近出现"UI 残影"。
 * 修复：完全去掉 pos state，直接 props 驱动；边界 clamp 通过 ref 直接写 style，
 * 跳过 state 二次 render。deps 改 [open, x, y]，在 prop 变化时立即检测。
 */
export function ContextMenu({
  open,
  onClose,
  x,
  y,
  items,
  onMouseEnter,
  onMouseLeave,
  anchor = 'left',
  alignY = 'top',
  minWidth,
}: {
  open: boolean
  onClose: () => void
  x: number
  y: number
  items: MenuItem[]
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** 菜单水平锚点：left 以 x 为左边缘展开；right 以 x 为右边缘向左展开；center 以 x 为水平中心（头像下拉居中） */
  anchor?: 'left' | 'right' | 'center'
  /** 菜单垂直对齐：top 以 y 为顶部（默认，符合右键菜单 / 下拉）；middle 以 y 为中心（用于 avatar 等居中场景） */
  alignY?: 'top' | 'middle'
  /** 最小宽度（px）：强制卡片 width ≥ 此值。用于内容异步/动态的卡片（AI 切换下拉的字体 hint /
   *  provider logo 异步加载会让首次 paint width 偏小、之后涨 3~5px），强制首次 width = 稳定值，
   * 配合 useLayoutEffect 一次定位，clamp 一次到位，避免贴边 / 跳动 / 间隔不一致 */
  minWidth?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  // 全局关闭：点外面 / Esc
  // 用 click capture 阶段（而非 mousedown）：capture 先于卡片 onClick（bubble），
  // stopPropagation 阻止 click 穿透到卡片 —— 否则 mousedown 只关闭菜单，
  // click 仍触发卡片 onClick → 误跳转 URL（移动端点卡片关闭菜单时触发的 bug）
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
        e.stopPropagation()
        e.preventDefault()
      }
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('click', onDoc, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // 定位 + 边界 clamp：DOM commit 后同步执行（useLayoutEffect，paint 前），无闪烁。
  // ⚠️ 定位必须用 left/top，不能用 transform：
  //   .context-menu 挂了 .liquid-glass，其入场动画 @keyframes liquidGlassIn 占用了 transform
  //   （translateY/scale）且 animation: ... both 锁定终态。CSS 规范里 keyframe animation 的优先级
  //   高于普通 inline style（MDN Cascade：author normal < keyframe animation < author !important），
  //   所以 inline 写 transform: translateX(-50%) 会被动画的 transform 覆盖 → 居中/向左锚点失效
  //   （菜单从头像中心向右展开）。改用 left/top 直接算偏移，transform 留给动画，两者不冲突。
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const position = () => {
      const rect = el.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      // 水平锚点 → left（用 left/top 不用 transform：见上方 transform 注释）
      let left: number
      if (anchor === 'right') left = x - width
      else if (anchor === 'center') left = x - width / 2
      else left = x
      // 垂直对齐 → top
      let top: number
      if (alignY === 'middle') top = y - height / 2
      else top = y
      // 边界 clamp：宁可偏离锚点也不出屏裁切
      if (left < 10) left = 10
      if (left + width > window.innerWidth - 10) left = window.innerWidth - 10 - width
      if (top + height > window.innerHeight - 10) top = window.innerHeight - 10 - height
      el.style.left = `${left}px`
      el.style.top = `${top}px`
    }
    position()
    // 监听 window resize：innerWidth 在 useLayoutEffect 执行后可能变化（如 dev resize / 窗口调整），
    // 没有 resize 监听时 clamp 用过时的 innerWidth，三个卡片的右边距会不一致。
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open, x, y, anchor, alignY])

  if (!open) return null

  const node = (
    <div
      ref={ref}
      className={cn('context-menu', 'show', 'liquid-glass', 'scrollbar-hover')}
      style={{
        left: x,
        top: y,
        minWidth: minWidth ? `${minWidth}px` : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div
            key={i}
            className="h-px my-1 mx-2"
            style={{ background: 'var(--border)' }}
          />
        ) : item.header ? (
          // header 默认只读标题；传了 onClick 则变成可点击入口（如「切换模型」→ 跳 AI 设置）
          item.onClick ? (
            <button
              key={i}
              type="button"
              className="context-menu-header clickable"
              onClick={() => {
                item.onClick?.()
                onClose()
              }}
            >
              {item.icon && <span className="icon">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ) : (
            <div key={i} className="context-menu-header">
              {item.icon && <span className="icon">{item.icon}</span>}
              <span>{item.label}</span>
            </div>
          )
        ) : (
          <button
            key={i}
            className={cn(
              'context-menu-item',
              item.variant === 'edit' && 'edit',
              item.variant === 'delete' && 'delete',
              item.active && 'active',
            )}
            onClick={() => {
              item.onClick?.()
              onClose()
            }}
          >
            {item.icon && <span className="icon">{item.icon}</span>}
            <span className="flex-1 min-w-0 truncate">{item.label}</span>
            {item.trailing && <span className="shrink-0">{item.trailing}</span>}
          </button>
        ),
      )}
    </div>
  )

  return createPortal(node, document.body)
}
