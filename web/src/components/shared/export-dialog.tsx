import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, FileCode, FileText, Folder, Save } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { api } from '@/api/client'
import { toast } from '@/components/ui/toast'
import type { Bookmark as BookmarkData, Category } from '@/types'

type ExportFormat = 'json' | 'html'

type ExportData = {
  categories: Category[]
  bookmarks: BookmarkData[]
}

function escapeHTML(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char]!)
}

function safeURL(value: string, allowDataImage = false) {
  if (allowDataImage && /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(value)) return value
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

function normalizeSVGDataURI(value: string) {
  const commaIndex = value.indexOf(',')
  if (!value.startsWith('data:image/svg+xml') || commaIndex === -1 || value.slice(0, commaIndex).includes(';base64')) return value
  try {
    // Go 的 url.QueryEscape 会把空格写成 +；浏览器的 data: URI 不会把 + 再解为空格。
    return `${value.slice(0, commaIndex + 1)}${encodeURIComponent(decodeURIComponent(value.slice(commaIndex + 1).replaceAll('+', ' ')))}`
  } catch {
    return value
  }
}

function safeColor(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : ''
}

function buildHTMLExport({ categories, bookmarks }: ExportData, exportedAt: string) {
  const categoriesByID = new Map(categories.map((category) => [category.id, category]))
  // ponytail: 手动导出时的分类数很小；书签达到数千时再改为单次 Map 分组。
  const groups = [
    ...categories
      .map((category) => ({ category, bookmarks: bookmarks.filter((bookmark) => bookmark.category_id === category.id) }))
      .filter((group) => group.bookmarks.length > 0),
    {
      category: null,
      bookmarks: bookmarks.filter((bookmark) => bookmark.category_id === null || !categoriesByID.has(bookmark.category_id)),
    },
  ].filter((group) => group.bookmarks.length > 0)

  const cards = (items: BookmarkData[]) => items.map((bookmark) => {
    const href = safeURL(bookmark.url)
    const favicon = normalizeSVGDataURI(safeURL(bookmark.favicon, true))
    const domain = href ? new URL(href).hostname : bookmark.url
    const tags = bookmark.tags.slice(0, 3).map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')
    return `<a class="bookmark" href="${escapeHTML(href || '#')}"${href ? ' target="_blank" rel="noopener noreferrer"' : ''}>
      <div class="bookmark-head">
        <div class="favicon">${favicon ? `<img src="${escapeHTML(favicon)}" alt="◎" loading="lazy">` : '<b aria-hidden="true">◎</b>'}</div>
        <div><h3>${escapeHTML(bookmark.title || domain)}</h3><p class="domain">${escapeHTML(domain)}</p></div>
        ${bookmark.is_favorite ? '<i title="收藏">★</i>' : ''}
      </div>
      ${bookmark.description ? `<p class="description">${escapeHTML(bookmark.description)}</p>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </a>`
  }).join('')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumen 书签导出</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ee;color:#2c2a25;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1320px;margin:auto;padding:56px 28px 72px}.eyebrow{margin:0 0 12px;color:#9a7b3f;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.intro{display:flex;justify-content:space-between;gap:24px;align-items:end;padding-bottom:34px;border-bottom:1px solid rgba(55,53,47,.12)}h1{margin:0;font-size:clamp(30px,5vw,46px);letter-spacing:-.045em}.summary{margin:11px 0 0;color:rgba(55,53,47,.7);font-size:14px}.readonly{white-space:nowrap;color:#9a7b3f;font-size:13px}.section{padding-top:42px}.section-title{display:flex;align-items:center;gap:10px;margin:0 0 18px;font-size:18px}.section-title b{width:10px;height:10px;border-radius:50%;background:var(--color,#9a7b3f)}.section-title small{color:rgba(55,53,47,.55);font-size:13px;font-weight:500}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.bookmark{display:flex;min-width:0;min-height:150px;flex-direction:column;padding:16px;border:0;border-radius:20px;background:rgba(255,255,252,.95);color:inherit;text-decoration:none;box-shadow:0 0 0 1px rgba(55,53,47,.1),0 6px 20px rgba(0,0,0,.15);transform-origin:center;transition:transform .25s cubic-bezier(.25,.46,.45,.94),box-shadow .25s ease,background .2s ease}.bookmark:hover{transform:scale(1.04);background:rgba(255,255,252,1);box-shadow:0 0 0 1px rgba(55,53,47,.18),0 14px 32px rgba(0,0,0,.22),0 6px 12px rgba(0,0,0,.1)}.bookmark-head{display:flex;gap:11px;align-items:center;min-width:0}.bookmark-head>div:nth-child(2){min-width:0;flex:1}.favicon{display:grid;width:36px;height:36px;flex:none;place-items:center;border-radius:9px;background:rgba(55,53,47,.07);color:#9a7b3f;overflow:hidden}.favicon img{width:28px;height:28px;object-fit:contain}.favicon b{font-size:20px;font-weight:500;line-height:1}.bookmark h3{margin:0;overflow:hidden;font-size:15px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.domain{margin:3px 0 0;overflow:hidden;color:rgba(55,53,47,.58);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.bookmark i{margin-left:auto;color:#f0b90b;font-size:15px;font-style:normal}.description{display:-webkit-box;margin:16px 0 0;overflow:hidden;color:rgba(55,53,47,.72);font-size:13px;line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:2}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:14px}.tags span{padding:3px 7px;border-radius:999px;background:rgba(154,123,63,.1);color:#896d39;font-size:11px}footer{margin-top:56px;color:rgba(55,53,47,.5);font-size:12px;text-align:center}@media(max-width:960px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){main{padding:38px 18px 48px}.intro{display:block}.readonly{display:block;margin-top:18px}.grid{grid-template-columns:1fr}.section{padding-top:32px}}
</style></head><body><main><header class="intro"><div><p class="eyebrow">Lumen · Bookmark Archive</p><h1>书签导出</h1><p class="summary">${bookmarks.length} 个书签 · ${categories.length} 个分类 · ${escapeHTML(exportedAt)}</p></div><span class="readonly">HTML 只读快照</span></header>
${groups.map(({ category, bookmarks: groupBookmarks }) => { const color = safeColor(category?.color ?? ''); return `<section class="section"><h2 class="section-title"><b${color ? ` style="--color:${color}"` : ''}></b>${escapeHTML(category?.name || '未分类')} <small>${groupBookmarks.length} 个书签</small></h2><div class="grid">${cards(groupBookmarks)}</div></section>` }).join('')}
<footer>由 Lumen 导出 · 可直接在浏览器中打开</footer></main></body></html>`
}

/**
 * 导出书签对话框 —— 点导出 → 自动拉数据 → 显示明细 → 确认下载。
 * 用 api() 统一客户端（自动注入 token / 401 跳登录 / 错误归一化），不用裸 fetch。
 */
export function ExportDialog({
  open,
  onClose,
  /** 选中导出的书签 id 列表（批量导），不传则导出全部 */
  ids,
}: {
  open: boolean
  onClose: () => void
  ids?: number[]
}) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ExportData | null>(null)
  const [format, setFormat] = useState<ExportFormat>('json')
  const [exportedAt, setExportedAt] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [categoryCount, setCategoryCount] = useState<number | null>(null)
  const [filename, setFilename] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fetched = useRef(false)

  useEffect(() => {
    if (!open) {
      fetched.current = false
      return
    }
    if (fetched.current) return
    fetched.current = true

    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const host = location.hostname.replace(/^www\./, '').split('.')[0]
    const suffix = ids?.length ? `-selected${ids.length}` : ''
    setFilename(`lumenbackup-${host}-${date}${suffix}`)
    setFormat('json')
    setLoading(true)
    setError(null)

    const url = ids?.length
      ? `/export?format=json&ids=${ids.join(',')}`
      : '/export?format=json'

    // 用 api() 统一客户端 —— 自动注入 Authorization、401 跳登录、错误归一化
    // api() 默认解析 JSON，返回 object
    api<ExportData>(url)
      .then((data) => {
        setData(data)
        setExportedAt(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date()))
        setCount(data.bookmarks?.length ?? 0)
        setCategoryCount(data.categories?.length ?? 0)
      })
      .catch((e) => {
        setError(e.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, ids])

  const file = useMemo(() => {
    if (!data) return null
    if (format === 'html') {
      return new Blob([buildHTMLExport(data, exportedAt)], { type: 'text/html;charset=utf-8' })
    }
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }, [data, exportedAt, format])

  const size = file
    ? file.size >= 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(1)} KB`
    : ''

  const handleDownload = () => {
    if (!file) return
    // 触发浏览器下载 —— 只能用 <a download> + click，浏览器 API 无声明式替代
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith(`.${format}`) ? filename : `${filename}.${format}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('导出成功')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="导出书签"
      maxWidth={380}
      footer={
        <>
          <Button variant="soft" onClick={onClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleDownload} disabled={loading || !file}>
            <Save size={14} />
            导出
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-sm text-(--text-secondary) mb-1 block">
            文件名
          </label>
          <Input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="导出文件名"
            aria-label="文件名"
          />
        </div>

        <div>
          <label className="text-sm text-(--text-secondary) mb-1 block" htmlFor="export-format">
            导出格式
          </label>
          <Select
            id="export-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
            options={[
              { value: 'json', label: 'JSON（备份，可导入）' },
              { value: 'html', label: 'HTML（查看，仅导出）' },
            ]}
          />
        </div>

        {loading && (
          <p className="text-sm text-(--text-muted)">准备中…</p>
        )}

        {!loading && !error && file && (
          <div className="flex flex-col gap-2.5 p-3 rounded-[10px] bg-(--bg-primary) border border-(--border)">
            <div className="flex items-center gap-2 text-sm">
              {format === 'json' ? <FileCode size={14} className="text-(--accent)" /> : <FileText size={14} className="text-(--accent)" />}
              <span className="font-semibold">{format.toUpperCase()}</span>
              <span className="text-xs text-(--text-secondary)">· {size}</span>
            </div>
            {count !== null && (
              <div className="grid grid-cols-2 pt-2">
                <div className="flex items-center gap-2">
                  <Bookmark size={14} className="text-(--accent)" />
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg leading-none font-semibold tabular-nums text-(--text-primary)">{count}</span>
                    <span className="text-sm text-(--text-secondary)">个书签</span>
                  </div>
                </div>
                {categoryCount !== null && (
                  <div className="flex items-center gap-2 border-l border-(--border) pl-3">
                    <Folder size={14} className="text-(--accent)" />
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg leading-none font-semibold tabular-nums text-(--text-primary)">{categoryCount}</span>
                      <span className="text-sm text-(--text-secondary)">个分类</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--destructive)]">{error}</p>
        )}
      </div>
    </Dialog>
  )
}
