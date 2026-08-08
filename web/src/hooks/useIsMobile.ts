import { useEffect, useState } from 'react'

/**
 * useIsMobile —— 基于 matchMedia (max-width:768px) 检测移动端（移动端断点 768px）。
 * 监听 resize 实时更新，初始为 false（SSR 安全），mount 后同步真实值。
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}
