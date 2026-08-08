import { useAuthStore } from '@/stores/auth'

/**
 * Favicon 抓取转换工具。
 *
 * 复用后端 GET /api/favicon（5 阶段降级抓取，auth group 需带 token）拿图片字节，
 * 前端转 data URI。体积控制适配 DB 64KB 限制（bookmarks.go:269）：
 * - SVG：URL 编码（≤25600 字符）
 * - 小图（<20KB）：直接 base64
 * - 大图：canvas 缩放到 64×64 + 空白检测（平均亮度 >245 视为空白）
 *
 * canvas / FileReader / Blob 是浏览器原生图片处理 API，非命令式 DOM 技术债。
 */

/** 嗅探图片真实 MIME（魔术字节）。第三方 favicon 服务常返回不准的 Content-Type
 *（如把 PNG 标成 image/x-icon），FileReader.readAsDataURL 会继承 blob.type 导致 data URI 标签错。
 * 此函数以字节为准；嗅探不出返回空，由调用方 fallback 到 blob.type。 */
function sniffImageMIME(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02) && bytes[3] === 0x00) return 'image/x-icon'
  return ''
}

/** blob → base64 data URI。用魔术字节嗅探真实 MIME 覆盖不准的 blob.type，避免 data URI 标签错。 */
export async function blobToDataUri(blob: Blob): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const realType = sniffImageMIME(bytes) || blob.type || 'image/png'
    const fixedBlob = new Blob([bytes], { type: realType })
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(fixedBlob)
    })
  } catch {
    return null
  }
}

/** 大图缩放到 64×64 转 data URI；空白图标返回 null */
async function resizeFaviconToDataUri(blob: Blob): Promise<string | null> {
  const size = 64
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image()
      const t = window.setTimeout(() => resolve(null), 5000)
      el.crossOrigin = 'anonymous'
      el.onload = () => {
        window.clearTimeout(t)
        resolve(el)
      }
      el.onerror = () => {
        window.clearTimeout(t)
        resolve(null)
      }
      el.src = url
    })
    if (!img) return null

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)

    // 空白图标检测：平均亮度 >245 视为纯白/近纯白
    const { data } = ctx.getImageData(0, 0, size, size)
    let totalBrightness = 0
    let opaqueCount = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 30) continue // 跳过透明像素
      totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3
      opaqueCount++
    }
    if (opaqueCount > 0 && totalBrightness / opaqueCount > 245) return null

    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 从 URL 抓 favicon 转 data URI（不写 DB）。
 * 复用后端 GET /api/favicon?url=...（auth group，需带 token）。
 * @param signal 用于 Esc 中断
 */
export async function fetchFaviconDataUri(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  // 15s 总超时：超时后 abort fetch 并 reject 抛 AbortError
  // 用 timedOut flag 区分内部超时 vs 用户主动取消：浏览器原生 AbortError 的
  // message 不带"超时"或时间字样（Chrome "The user aborted a request." / Firefox
  // "signal is aborted without reason"），bookmarks.tsx catch 用
  // `err.message.includes('15')` 永远 false，会把超时错误归类为"已取消"。
  // 这里超时 throw 带"15秒"的 Error，让调用方 catch 能正确区分。
  const timeoutController = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, 15000)
  const onUserAbort = () => timeoutController.abort()
  signal?.addEventListener('abort', onUserAbort)
  try {
    const hostname = new URL(url).hostname
    const token = useAuthStore.getState().token
    const resp = await fetch(`/api/favicon?url=https://${encodeURIComponent(hostname)}`, {
      signal: timeoutController.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-cache',
    })
    if (!resp.ok) return null

    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('svg')) {
      const svgText = await resp.text()
      if (svgText.length > 25600) return null
      return 'data:image/svg+xml,' + encodeURIComponent(svgText)
    }

    const blob = await resp.blob()
    if (blob.size < 20480) return await blobToDataUri(blob)
    return await resizeFaviconToDataUri(blob)
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      // 内部 15s 触发 → 超时；用户 signal 触发 → 主动取消
      if (timedOut) throw new Error('获取超时（15秒），请稍后重试')
      throw e
    }
    return null
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', onUserAbort)
  }
}
