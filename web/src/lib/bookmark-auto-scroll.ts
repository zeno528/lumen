const EDGE_SIZE = 72
const MAX_SCROLL_PER_FRAME = 16
const RAMP_UP_MS = 400

let container: HTMLElement | null = null
let pointerY: number | null = null
let frameId: number | null = null
let activeSince: number | null = null

/** 指针越靠近滚动容器边缘，速度越快；前 400ms 逐步加速。 */
export function getAutoScrollDelta(clientY: number, rect: Pick<DOMRect, 'top' | 'bottom'>, elapsedMs: number) {
  const topDistance = clientY - rect.top
  const bottomDistance = rect.bottom - clientY
  const direction = topDistance < EDGE_SIZE ? -1 : bottomDistance < EDGE_SIZE ? 1 : 0
  if (direction === 0) return 0
  const proximity = 1 - Math.max(0, Math.min(EDGE_SIZE, direction < 0 ? topDistance : bottomDistance)) / EDGE_SIZE
  const speed = MAX_SCROLL_PER_FRAME * proximity * Math.min(1, elapsedMs / RAMP_UP_MS)
  return direction * Math.max(1, Math.round(speed))
}

function tick(now: number) {
  if (!container || pointerY == null) return stopBookmarkAutoScroll()
  const delta = getAutoScrollDelta(pointerY, container.getBoundingClientRect(), activeSince == null ? 0 : now - activeSince)
  if (delta === 0) {
    activeSince = null
    frameId = null
    return
  }
  if (activeSince == null) activeSince = now
  const previousScrollTop = container.scrollTop
  container.scrollTop += delta
  if (container.scrollTop === previousScrollTop) {
    frameId = null
    return
  }
  frameId = window.requestAnimationFrame(tick)
}

/** 同一时间只维护一个书签拖拽的自动滚动会话。 */
export function startBookmarkAutoScroll(scrollContainer: HTMLElement) {
  stopBookmarkAutoScroll()
  container = scrollContainer
}

export function updateBookmarkAutoScroll(clientY: number) {
  if (!container || clientY <= 0) return
  pointerY = clientY
  if (frameId == null) frameId = window.requestAnimationFrame(tick)
}

export function stopBookmarkAutoScroll() {
  if (frameId != null) window.cancelAnimationFrame(frameId)
  container = null
  pointerY = null
  frameId = null
  activeSince = null
}
