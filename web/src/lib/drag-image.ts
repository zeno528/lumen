// 拖拽 ghost 图单例：整个页面复用一个离屏元素，拖拽期间不增删 DOM 节点。
// Chromium 对拖拽会话中的 DOM 结构突变（增删节点）处理不稳，曾因快速来回拖拽
// 触发渲染进程崩溃（react-dnd#2177 / #3649 / #3505，Chromium ManualTests/drag-image-no-crash.html）。
// 旧的实现每次 dragstart append 一个新元素、dragend remove —— 正是这类突变；
// 改为惰性创建一次、复用到底。1×1 离屏，永不移除（无害且省去清理路径）。
let dragImage: HTMLDivElement | null = null

export function getDragImage(): HTMLDivElement {
  if (!dragImage) {
    dragImage = document.createElement('div')
    dragImage.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none;'
    document.body.append(dragImage)
  }
  return dragImage
}
