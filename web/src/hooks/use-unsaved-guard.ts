import { useEffect } from 'react'

/**
 * 未保存离开守护 —— 拦截"页面内 ESC/路由切换"和"浏览器关闭/刷新"。
 *
 * 用法：
 *   const isDirty = nicknameDirty || usernameDirty
 *   useUnsavedGuard(isDirty)
 *
 * 内部实现：
 * - 浏览器关闭/刷新：beforeunload 事件（弹原生确认框，由浏览器实现）
 * - 页面内 ESC/路由切换：在 document.documentElement 上挂 data-unsaved-dirty="true" 标志，
 *   外部监听者（settings.tsx 的 ESC 跳转）先检查这个标志再决定是否弹 ConfirmDialog
 *
 * 为什么不用 zustand：dirty 是 UI 临时态，DOM 标志够用，避免 store 膨胀
 * 为什么不在 hook 里弹 ConfirmDialog：hook 不知道 ConfirmDialog 在哪
 * 为什么不在 hook 里直接拦截 ESC：ESC 已被 Dialog / useHotkeys 等多个机制处理，hook 不应越权
 */
export function useUnsavedGuard(isDirty: boolean) {
  // 同步 dirty 状态到 DOM 标志（供 settings.tsx 的 ESC 监听者读取）
  useEffect(() => {
    if (isDirty) {
      document.documentElement.dataset.unsavedDirty = 'true'
    } else {
      delete document.documentElement.dataset.unsavedDirty
    }
  }, [isDirty])

  // 浏览器关闭/刷新原生确认（Chrome/Firefox 现代版本都尊重 preventDefault，无需 returnValue）
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])
}
