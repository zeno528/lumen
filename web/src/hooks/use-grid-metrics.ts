/** 书签卡片网格的列宽与间距，与 layout.css .bookmarks-grid 保持一致 */
export const CARD_WIDTH = 300
export const GAP = 16
/**
 * 书签网格容器最大宽度，与 layout.css .bookmarks-grid / .main-top-inner 三处必须同步。
 * 取值约束（卡片 300 / gap 16）：5 列内容宽 5×300+4×16=1564，6 列临界 6×300+5×16=1880；
 * 故 1680 ≥1564（全屏放得下 5 列）且 <1880（封顶 5 列），1920 全屏 5 列居中左右各留约 46px。
 */
export const MAX_CONTAINER_WIDTH = 1680
/** .main-content 的左右内边距各 12px */
export const MAIN_CONTENT_HORIZONTAL_PADDING = 24

/**
 * 设置页/帮助页等独立全屏页面（无侧边栏）的内容最大宽度。
 * 这类页面是表单/文档，不应跟随书签网格宽度（1564）撑满——960 给左侧标签栏 200 + 右侧
 * 表单/文档留舒适阅读宽度（扣 padding 后内容 ~680，接近长文排版理想宽度）；
 * 配合外层 mx-auto 在宽屏居中，窄屏由 w-full 自然收缩（max-width 不生效）。
 */
export const SINGLE_PAGE_MAX_WIDTH = 960

/**
 * 根据容器宽度计算书签网格实际占用的内容宽度。
 * 实现 auto-fill + justify-content:center 的排布：
 *   columns = floor((containerWidth + gap) / (cardWidth + gap))
 *   contentWidth = columns * cardWidth + (columns - 1) * gap
 */
export function computeGridContentWidth(containerWidth: number): number {
  const gridContainerWidth = Math.min(MAX_CONTAINER_WIDTH, Math.max(0, containerWidth))
  const columns = Math.max(1, Math.floor((gridContainerWidth + GAP) / (CARD_WIDTH + GAP)))
  return columns * CARD_WIDTH + (columns - 1) * GAP
}
