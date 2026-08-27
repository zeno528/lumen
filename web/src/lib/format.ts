/** 字节数 → 人类可读（B / KB / MB），全站唯一实现。 */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** ISO/naive 时间串 → 中文短日期；naive 串补 Z 按 UTC 解析。 */
export function formatDateTime(value: string | undefined, fallback = '—'): string {
  if (!value) return fallback
  const normalized = value.endsWith('Z') || value.includes('+') ? value : `${value}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
