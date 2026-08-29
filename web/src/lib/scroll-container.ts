/**
 * 返回当前断点的滚动容器：移动端(≤768px)是根滚动器，桌面是 .main。
 *
 * Why：iOS Safari/Chrome 只在 document（根滚动器）滚动时才收起底部地址栏（全屏化）；
 * 壳 100dvh + overflow:hidden 锁死 + 内层 .main 滚动的结构永不触发。移动端滚动已还给
 * body（见 layout.css 移动端媒体查询），JS 滚动必须跟着走根滚动器；桌面仍是 .main。
 *
 * 约定：所有 JS 滚动（回顶 / 恢复位置 / scrollTop 读写的持久化监听）一律走这里，
 * 禁止直接 querySelector('.main').scrollTo。注意根滚动器的 scroll 事件派发在
 * document/window 上（scrollingElement 元素本身收不到），挂滚动监听需对 window 另挂一份
 * （见 bookmarks.tsx 持久化 effect 的双挂）。
 */
export function getScrollEl(): HTMLElement {
  return window.matchMedia('(max-width: 768px)').matches
    ? (document.scrollingElement as HTMLElement)
    : (document.querySelector('.main') as HTMLElement)
}
