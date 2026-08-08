import { useEffect, useState } from 'react'

/**
 * 通用防抖 hook —— 输入值变化后 delay ms 才更新 debounced。
 * 用于搜索框：用户停止输入 300ms 后再触发过滤。
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}
