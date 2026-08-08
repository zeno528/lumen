import { useRef, useCallback, useEffect } from 'react'

interface LongPressResult {
  onTouchStart: (e: React.TouchEvent) => void
  onTouchEnd: () => void
  onTouchMove: () => void
}

/**
 * 移动端长按 hook —— 500ms 长按触发 onLongPress(x, y)。
 * 用于在触摸设备上模拟桌面右键菜单。
 *
 * 产品契约：touchstart 500ms setTimeout 触发长按。
 * 升级写法：hook + props，不操作 classList。
 *
 * ⚠️ 关键陷阱（修复"长按弹菜单后首击失效，要点两次"）：
 * 原做法在长按触发时调 `e.preventDefault()`（且 touchstart 用 `{ passive: false }`），
 * 目的是**抑制松手时浏览器合成的那次 click**。React 17+ 的 touch 监听默认是 passive，
 * 无法用旧方式 preventDefault → 必须主动吞掉这次合成 click，否则它会被 ContextMenu 的
 * document click 捕获监听（onDoc）当成"外部点击"关闭菜单。
 *
 * 现代等价写法：长按触发后用一次性 **document 捕获阶段 click 吞噬器**吞掉紧随的合成 click
 * （比 ContextMenu.onDoc 先注册 → stopImmediatePropagation 抢先拦截）。
 *
 * ❌ 不要用"距离判断"（dx/dy > 10 放行）区分合成 click vs 真实菜单项 click：
 * 真机触摸合成 click 的位置不可预测（手指微抖 / 接触面变化 / 不同浏览器实现差异都可能导致
 * click 位置偏离 touchend 位置几像素到几十像素），距离判断会两边翻车 —— 偏离大时放行被 onDoc
 * 误关菜单，偏离小时误吞用户真实菜单项 click（导致要点两次）。
 * ✅ 改用"吞一个就 off"（无论距离），新一次 touchstart 通过 disarm 抢先解除即可。
 */
export function useLongPress(
  onLongPress: (x: number, y: number) => void,
  options: { delay?: number } = {},
): LongPressResult {
  const { delay = 500 } = options
  const timer = useRef<number | null>(null)
  const pos = useRef({ x: 0, y: 0 })
  const armed = useRef(false)

  // 一组稳定的 handler（用 ref 持有，避免相互引用导致的闭包/依赖问题）
  const h = useRef<{
    swallow: (e: MouseEvent) => void
    disarm: () => void
    off: () => void
  } | null>(null)
  if (!h.current) {
    const off = () => {
      if (!armed.current) return
      armed.current = false
      document.removeEventListener('click', h.current!.swallow, true)
      document.removeEventListener('touchstart', h.current!.disarm, true)
    }
    h.current = {
      // 吞掉合成 click：先于 ContextMenu.onDoc 执行，拦下后立即解除自身。
      // 原本用 dx/dy > 10 距离判断区分"松手合成 click"和"用户真实点菜单项 click"，
      // 但真机触摸合成 click 的位置不可预测（手指微抖/接触面变化/浏览器实现差异都可能让
      // click 位置偏离 touchend 位置），距离判断会两边翻车：
      //   - 偏离 > 10 → 放行 → 走到 ContextMenu.onDoc 把菜单误关（用户根本没机会点菜单项）
      //   - 偏离 ≤ 10 但其实是菜单项 click → 误吞 → 用户必须再点一次
      // 改为 arm 后**只吞一个**（无论距离），disarm（任何新一次 touchstart）抢先解除，
      // 这是最可靠的信号 —— 用户开始新手势=旧手势结束，不可能同时点菜单项+刚长按完。
      swallow: (e: MouseEvent) => {
        e.stopImmediatePropagation()
        e.preventDefault()
        off()
      },
      // 用户开始新的一次触摸（如去点菜单项）→ 先解除，保证放行其真实 click
      disarm: () => off(),
      off,
    }
  }

  const arm = useCallback(() => {
    if (armed.current) return
    armed.current = true
    document.addEventListener('click', h.current!.swallow, true)
    document.addEventListener('touchstart', h.current!.disarm, true)
  }, [])

  const clear = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // 新手势开始：先解除上一次长按遗留的 click 吞噬器（避免误吞本次点击）
      h.current!.off()
      const touch = e.touches[0]
      pos.current = { x: touch.clientX, y: touch.clientY }
      timer.current = window.setTimeout(() => {
        timer.current = null
        onLongPress(pos.current.x, pos.current.y)
        // 长按已触发 → 武装吞噬器，吞掉随后松手合成的那次 click
        arm()
      }, delay)
    },
    [onLongPress, delay, arm],
  )

  const onTouchEnd = useCallback(() => clear(), [clear])
  const onTouchMove = useCallback(() => {
    // 用户开始移动手指 → 如果已 armed 立即解除 click 吞噬器。
    // 移动端最自然的手势：长按 500ms 后菜单弹出，用户**手指不离屏**就开始拖到菜单项，
    // 在菜单项位置 touchend → 浏览器合成 click 在 touchend 位置（菜单项），
    // 这个 click 是用户**真实的菜单项 click**，绝不能被 swallow 误吞（吞了就要点两次）。
    // 判定逻辑：一旦用户开始 touchmove，明显不是单纯"长按后松手"（单纯松手不会触发 touchmove），
    // 后续 click 100% 是用户的真实点击。disarm 抢先解除比等"下次 touchstart"更及时。
    if (armed.current) {
      h.current!.off()
    }
    clear()
  }, [clear])

  // 卸载时清理定时器与残留监听
  useEffect(
    () => () => {
      clear()
      h.current?.off()
    },
    [clear],
  )

  return { onTouchStart, onTouchEnd, onTouchMove }
}
