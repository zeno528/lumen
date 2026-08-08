import { useEffect, useRef, useState } from 'react'
import { FileCode, Save } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api/client'
import { toast } from '@/components/ui/toast'

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
  const [blob, setBlob] = useState<Blob | null>(null)
  const [size, setSize] = useState('')
  const [count, setCount] = useState<number | null>(null)
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
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const host = location.hostname.replace(/^www\./, '').split('.')[0]
    const suffix = ids?.length ? `-selected${ids.length}` : ''
    setFilename(`lumen-backup-${host}-${date}${suffix}`)
    setLoading(true)
    setError(null)

    const url = ids?.length
      ? `/export?format=json&ids=${ids.join(',')}`
      : '/export?format=json'

    // 用 api() 统一客户端 —— 自动注入 Authorization、401 跳登录、错误归一化
    // api() 默认解析 JSON，返回 object
    api<{ categories: unknown[]; bookmarks: { id: number }[] }>(url)
      .then((data) => {
        const json = JSON.stringify(data, null, 2)
        const b = new Blob([json], { type: 'application/json' })
        setBlob(b)

        const sizeKB = (b.size / 1024).toFixed(1)
        const sizeMB = (b.size / 1024 / 1024).toFixed(2)
        setSize(b.size >= 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`)
        setCount(data.bookmarks?.length ?? 0)
      })
      .catch((e) => {
        setError(e.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, ids])

  const handleDownload = () => {
    if (!blob) return
    // 触发浏览器下载 —— 只能用 <a download> + click，浏览器 API 无声明式替代
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.json`
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
          <Button onClick={handleDownload} disabled={loading || !blob}>
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
            placeholder="导出文件名"
          />
        </div>

        {loading && (
          <p className="text-sm text-(--text-muted)">准备中…</p>
        )}

        {!loading && !error && blob && (
          <div className="flex flex-col gap-1.5 p-3 rounded-[10px] bg-(--bg-primary) border border-(--border)">
            <div className="flex items-center gap-2 text-sm">
              <FileCode size={14} className="text-(--accent)" />
              <span className="font-semibold">{size}</span>
            </div>
            {count !== null && (
              <div className="flex items-center gap-2 text-xs text-(--text-secondary)">
                <Save size={14} className="text-(--accent)" />
                <span>{count} 个书签</span>
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
