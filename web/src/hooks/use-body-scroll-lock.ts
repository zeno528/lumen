import { useEffect } from 'react'

let lockCount = 0

/**
 * 锁定/解锁 body 滚动。
 * Why：移动端(≤768px)滚动容器是根滚动器（见 lib/scroll-container.ts），弹窗/抽屉
 * 打开时不锁 body，滑动遮罩会滚到背后的页面。
 * 引用计数：弹窗叠弹窗（如设置中心内 ConfirmDialog）内层关闭时不误放外层的锁。
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    if (++lockCount === 1) document.body.style.overflow = 'hidden'
    return () => {
      if (--lockCount === 0) document.body.style.overflow = ''
    }
  }, [locked])
}
