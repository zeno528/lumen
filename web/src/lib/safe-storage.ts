import type { StateStorage } from 'zustand/middleware'

/**
 * zustand persist 用 localStorage 适配层：配额满 / 隐私模式吞错降级。
 *
 * Why：zustand v5 persist 把 setItem 同步挂进 api.setState 且不捕获（middleware.js
 * `api.setState = (...) => { ...; return setItem() }`），favicon 缓存塞满配额后，
 * 任何 UI 状态写入（登录 token / 切分类 / 折叠分类…）都会把 QuotaExceededError
 * 直接抛进调用方（表现=页面报 "the quota has been exceeded"）。
 * 这里吞掉写入错误：本次状态仅在内存生效，与 query 缓存 persister 的静默行为对齐。
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      /* 配额满 / 隐私模式：静默，不持久化 */
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
}
