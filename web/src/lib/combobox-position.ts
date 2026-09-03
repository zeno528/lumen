const GAP = 4
const VIEWPORT_PADDING = 8

/** 让 portal 下拉框优先完整展示；下方不足时取空间较大的一侧。 */
export function getDropdownPlacement(
  trigger: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number,
  requestedHeight: number,
) {
  const above = Math.max(0, trigger.top - GAP - VIEWPORT_PADDING)
  const below = Math.max(0, viewportHeight - trigger.bottom - GAP - VIEWPORT_PADDING)
  const opensUp = below < requestedHeight && above > below
  const maxHeight = Math.min(requestedHeight, opensUp ? above : below)
  return {
    top: opensUp ? trigger.top - GAP - maxHeight : trigger.bottom + GAP,
    maxHeight,
  }
}
