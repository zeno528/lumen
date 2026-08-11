import { useEffect, useState } from 'react'

/**
 * useIsMobile —— 基于 matchMedia (max-width:768px) 检测移动端（移动端断点 768px）。
 * 浏览器首帧同步读取真实值，避免移动端先挂桌面壳、再切换移动壳；非浏览器环境回退 false。
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setIsMobile(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}
