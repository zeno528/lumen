import { Fragment, type ReactNode } from 'react'
import type { Bookmark } from '@/types'
import { toast } from '@/components/ui/toast'

/**
 * 书签工具函数。
 */

/** URL 归一化：补协议 + scheme/域名转小写 + 合并路径连续 /（Nginx merge_slashes）
 *  - 末尾 / 自动加（WHATWG / RFC 2616 §3.2.2 + RFC 3986 §6.2.3 强制）
 *  - 路径内连续 / 合并为单个 /（Nginx 默认 merge_slashes on，不在 WHATWG 层做但服务端主流）
 *  - 协议分隔符 // 保留不动：只对 pathname 操作，toString 重新拼装 */
export function normalizeUrl(url: string): string {
  url = url.trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url
  }
  try {
    const u = new URL(url)
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()
    u.pathname = u.pathname.replace(/\/+/g, '/')
    return u.toString()
  } catch {
    return url.toLowerCase()
  }
}

/** URL 守卫：归一化 + 空值 toast 提示 + 返回 null 让调用方早返回。
 *  3 处按钮共用（智能填充 / 抓标题 / 抓描述），把"无网址"用户引导文案收敛到一处，
 *  未来要改文案只改 1 个点（之前 3 处各写一份，导致最近一次统一为"网址"时三处都改）。
 *  依赖方向：lib → components/ui/toast 单向，toast 不依赖 lib 业务，无循环引用。*/
export function requireUrl(url: string): string | null {
  const n = normalizeUrl(url)
  if (!n) {
    toast.warning('请先输入网址')
    return null
  }
  return n
}

/** 生成 www/非www 变体，用于重复检查*/
function getUrlVariants(url: string): string[] {
  try {
    const u = new URL(url)
    const base = u.toString().toLowerCase()
    if (u.hostname.startsWith('www.')) {
      const noWww = new URL(base)
      noWww.hostname = u.hostname.slice(4)
      return [base, noWww.toString()]
    }
    const withWww = new URL(base)
    withWww.hostname = 'www.' + u.hostname
    return [base, withWww.toString()]
  } catch {
    return [url.toLowerCase()]
  }
}

/** 本地重复检查（匹配大小写 + www/非www 变体），返回冲突书签或 null
 *  【公平比较修复】：b.url 同样过 getUrlVariants。
 *  原实现只对输入 url 调 getUrlVariants（normalize 末尾 /），但 b.url 是数据库原样（可能无末尾 /），
 *  导致用户复制旧书签 URL 粘贴时前端不拦截、后端按字面存多一个 / 的 bug。
 *  现在两边都过变体生成（new URL().toString() 会自动补末尾 /），交集命中即视为重复。*/
export function findDuplicateBookmark(
  bookmarks: Bookmark[],
  url: string,
  excludeId?: number,
): Bookmark | null {
  const inputVariants = new Set(getUrlVariants(url))
  return (
    bookmarks.find((b) => {
      if (b.id === excludeId) return false
      return getUrlVariants(b.url).some((v) => inputVariants.has(v))
    }) ?? null
  )
}

/**
 * 关键词高亮 —— 把 text 中匹配 query 的部分包进 <mark>。
 * React 自动转义文本节点，无需手动 escapeHtml。query 为空时原样返回。
 */
export function highlightText(text: string, query: string): ReactNode {
  if (!query || !text) return text
  const lower = text.toLowerCase()
  const ql = query.toLowerCase()
  const nodes: ReactNode[] = []
  let i = 0
  let idx = lower.indexOf(ql)
  let key = 0
  while (idx !== -1) {
    if (idx > i) nodes.push(<Fragment key={key++}>{text.slice(i, idx)}</Fragment>)
    nodes.push(<mark key={key++}>{text.slice(idx, idx + ql.length)}</mark>)
    i = idx + ql.length
    idx = lower.indexOf(ql, i)
  }
  if (i < text.length) nodes.push(<Fragment key={key++}>{text.slice(i)}</Fragment>)
  return <>{nodes}</>
}

/**
 * tags 字符串解析（"a, b, c" -> ["a","b","c"]）。
 * 同时按半角 "," 和全角 "，" 分隔：中文输入法默认输出全角逗号，统一在此规范化，
 * 调用方（bookmark-dialog / batch-dialog）无需在 onChange 里改受控 value --
 * 受控组件在 onChange 里 replace 会破坏 IME composition 状态，导致输入卡死。
 */
export function parseTags(tagsStr: string): string[] {
  return tagsStr
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
}
