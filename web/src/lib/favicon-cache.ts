/**
 * Favicon dataURI 持久化缓存（localStorage + 内存 Map）。
 *
 * 消除刷新页面时图标闪烁：列表 API 返回 favicon=''（防响应膨胀，bookmarks.go:64），
 * 图标全走 /api/bookmarks/{id}/favicon 端点，刷新时 HTTP 缓存未命中的走网络导致 img 空白闪烁。
 * 这里把已加载的图标 dataURI 缓存到 localStorage，渲染时同步读出 src=dataURI 立即显示不走网络。
 *
 * 本模块补回该缓存。规模小（书签 favicon 平均 2.5KB），localStorage 5-10MB 远够；
 * 满 / 隐私模式 try-catch 兜底，持久化失败时内存缓存仍让本次会话秒显。
 *
 * 失效：updated_at 变（图标更新）-> getFavicon 不匹配返回 null -> 走端点 -> 预加载后台更新缓存。
 */

const PREFIX = 'lumen:favi:'
const cache = new Map<number, { d: string; u: string }>()

/** 启动时从 localStorage 批量加载到内存 Map（同步，书签规模小瞬间完成）*/
export function loadFaviconCache(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      const id = Number(key.slice(PREFIX.length))
      if (!Number.isFinite(id)) continue
      try {
        const v = JSON.parse(localStorage.getItem(key) || '{}')
        if (v && typeof v.d === 'string' && typeof v.u === 'string') {
          cache.set(id, { d: v.d, u: v.u })
        }
      } catch {
        /* 单条损坏跳过 */
      }
    }
  } catch {
    /* 隐私模式 localStorage 不可用，静默 */
  }
}

/** 取缓存 dataURI：updated_at 匹配才返回，否则 null（图标更新视为失效，走端点重新加载）*/
export function getFavicon(id: number, updatedAt: string | undefined): string | null {
  const v = cache.get(id)
  if (!v || v.u !== updatedAt) return null
  return v.d
}

/** 写缓存：内存 Map + localStorage。
 *  配额满时按 FIFO 淘汰最早的 favicon 键腾位重试（localStorage 键序 = 写入序），
 *  否则新设备首次全量灌入 315+ 图标就把 5MB 配额吃光，后续所有小写入全部 QuotaExceeded。
 *  淘汰只删 localStorage，内存缓存保留（本会话秒显不受影响，被淘汰项下次刷新走端点）。
 *  没有可腾空间（隐私模式/仅剩当前键）放弃，静默。 */
export function setFavicon(id: number, updatedAt: string, dataUri: string): void {
  if (!updatedAt) return
  cache.set(id, { d: dataUri, u: updatedAt })
  const payload = JSON.stringify({ d: dataUri, u: updatedAt })
  try {
    localStorage.setItem(PREFIX + id, payload)
    return
  } catch {
    /* 配额满，走淘汰重试；再抛则最终静默 */
  }
  try {
    const ownKey = PREFIX + id
    for (;;) {
      let victim: string | null = null
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(PREFIX) && k !== ownKey) {
          victim = k
          break
        }
      }
      if (!victim) return
      localStorage.removeItem(victim)
      try {
        localStorage.setItem(ownKey, payload)
        return
      } catch {
        /* 一次淘汰不够，继续腾 */
      }
    }
  } catch {
    /* 隐私模式 / storage 不可用：静默，内存缓存仍生效 */
  }
}

/** 删缓存：书签删除时清，避免残留 */
export function deleteFavicon(id: number): void {
  cache.delete(id)
  try {
    localStorage.removeItem(PREFIX + id)
  } catch {
    /* 静默 */
  }
}

/**
 * 无 favicon 书签记忆（id -> updated_at）。内存级，不持久化。
 *
 * 用途：BookmarkCard 路由切换重挂时，无 favicon 的 <img> 重挂后走端点拿 404 再 onError 切 Globe，
 * "空白->Globe"跳变就是图标闪烁根因。这里记忆首次 404 的结果，重挂时 hasNoFavicon 命中直接
 * 显示 Globe 不发请求；书签更新后 updated_at 变，记忆自动失效（不匹配）重新走 <img>。
 *
 * 清除图标也用它乐观显示 Globe（markNoFavicon）：清除瞬间端点还没 404（PUT 未完成）会返回
 * 旧图标，走端点就闪旧图标 + 和 toast 不同步；markNoFavicon 让卡片直接 Globe 不走端点。
 */
const noFavicon = new Map<number, string>()

/** 是否已知该书签无 favicon（updated_at 匹配才命中，书签更新后自动失效）*/
export function hasNoFavicon(id: number, updatedAt: string | undefined): boolean {
  return noFavicon.get(id) === updatedAt
}

/** 标记书签无 favicon（img 404 或清除图标时调用）*/
export function markNoFavicon(id: number, updatedAt: string): void {
  noFavicon.set(id, updatedAt)
}

/** 清除无 favicon 标记（清除图标失败回滚时调用，让 img 重新走端点）*/
export function unmarkNoFavicon(id: number): void {
  noFavicon.delete(id)
}
