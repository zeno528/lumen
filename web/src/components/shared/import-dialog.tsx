import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Check, AlertCircle, Repeat, FolderPlus, Folder } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { importBookmarks } from '@/api/import-export'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/** 导入结果（与 importBookmarks 返回类型对齐）*/
interface ImportResult {
  ok: boolean
  imported?: number
  skipped?: number
  imported_ids?: number[]
  imported_categories?: string[]
  skipped_categories?: number
}

type Phase = 'idle' | 'importing' | 'success' | 'error'

/**
 * 导入书签对话框 -- Dialog + 拖拽区 + 状态机反馈。
 * - 点击拖拽区 / 拖拽 JSON -> 直接导入
 * - 导入模式：merge（重复按 url 跳过，后端 INSERT OR IGNORE）
 * - 反馈在模态框内闭环：idle -> importing(旋转) -> success(勾选+统计卡片+分类) / error(错误卡片,可重试)
 * - 不再靠列表卡片高亮反馈（去掉 recentlyImportedIds，避免大量导入时一堆卡片同时动画的性能负担）
 */
export function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported: (res: ImportResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importMut = useMutation({
    mutationFn: (file: File) => importBookmarks(file, 'merge'),
    onSettled: () => {
      // 数据刷新走 invalidate（替代调用方手动 refetch + invalidate）
      qc.invalidateQueries({ queryKey: ['bookmarks'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  // 打开时重置状态（组件常驻 mount，避免上次 phase/结果残留到下次打开）
  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setResult(null)
    setError(null)
  }, [open])

  const doImport = async (file: File) => {
    setError(null)
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      setError('请选择 JSON 文件')
      setPhase('error')
      return
    }
    setPhase('importing')
    try {
      const res = await importMut.mutateAsync(file)
      setResult(res)
      setPhase('success')
      toast.success(`导入成功，新增 ${res.imported ?? 0} 个，跳过 ${res.skipped ?? 0} 个`)
      onImported(res)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      setPhase('error')
      toast.error('导入失败: ' + msg)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) doImport(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (phase === 'importing') return
    const file = e.dataTransfer.files?.[0]
    if (file) doImport(file)
  }

  const busy = phase === 'importing'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="导入书签"
      maxWidth={480}
      footer={
        <Button variant="soft" onClick={onClose} disabled={busy}>
          关闭
        </Button>
      }
    >
      {phase === 'success' && result ? (
        // 成功态：勾选光晕 + 统计卡片（--shadow-card 三层阴影质感）+ 分类标签卡
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="flex flex-col items-center gap-3">
            <div
              className="check-pop flex items-center justify-center size-16 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 32% 28%, color-mix(in srgb, var(--success) 88%, white), var(--success))',
                boxShadow:
                  'inset 0 1px 0 color-mix(in srgb, white 35%, transparent), 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent), 0 10px 28px color-mix(in srgb, var(--success) 35%, transparent)',
              }}
            >
              <Check size={28} strokeWidth={3.5} className="text-white" />
            </div>
            <p className="text-base font-semibold text-(--text-primary)">导入成功</p>
            <p className="text-xs text-(--text-muted)">
              {result.skipped
                ? `共处理 ${(result.imported ?? 0) + (result.skipped ?? 0)} 条 · 跳过重复 ${result.skipped} 条`
                : `全部 ${result.imported ?? 0} 条书签已导入`}
            </p>
          </div>

          {/* 数字统计卡片：bg-card + border + 三层阴影，数字等宽大号 */}
          <div className="flex gap-3 w-full">
            <div
              className="flex-1 flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-(--bg-card) border border-(--border)"
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              <span className="text-3xl font-semibold text-(--success) tabular-nums">
                {result.imported ?? 0}
              </span>
              <span className="flex items-center gap-1 text-xs text-(--text-muted)">
                <Check size={11} strokeWidth={3} className="text-(--success)" />
                新增书签
              </span>
            </div>
            <div
              className="flex-1 flex flex-col items-center gap-1.5 py-4 rounded-2xl bg-(--bg-card) border border-(--border)"
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              <span className="text-2xl font-semibold text-(--text-secondary) tabular-nums">
                {result.skipped ?? 0}
              </span>
              <span className="flex items-center gap-1 text-xs text-(--text-muted)">
                <Repeat size={11} className="text-(--text-secondary)" />
                跳过重复
              </span>
            </div>
          </div>

          {/* 新增分类：外层卡包裹 + 内层 chip 独立小卡 */}
          {result.imported_categories && result.imported_categories.length > 0 && (
            <div className="flex flex-col gap-2.5 w-full p-3.5 rounded-2xl bg-(--bg-secondary) border border-(--border)">
              <p className="flex items-center justify-center gap-1.5 text-xs text-(--text-muted)">
                <FolderPlus size={13} className="text-(--accent)" />
                新增 <span className="font-semibold text-(--text-primary)">{result.imported_categories.length}</span> 个分类
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {result.imported_categories.slice(0, 5).map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-(--bg-card) border border-(--border) text-xs font-medium text-(--text-primary)"
                  >
                    <Folder size={11} className="text-(--text-muted) shrink-0" />
                    {cat}
                  </span>
                ))}
                {result.imported_categories.length > 5 && (
                  <span className="inline-flex items-center px-1.5 py-1 text-xs text-(--text-muted)">
                    共 {result.imported_categories.length} 个
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-(--text-secondary) mb-4 leading-relaxed">
            支持 <code className="px-1.5 py-0.5 rounded font-mono text-[0.85em] font-medium text-(--accent) bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]">.json</code>{' '}
            格式的备份文件，导入模式为合并（重复书签自动跳过）。
          </p>

          {/* 拖拽区 / 点击选择 / 导入中 */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (!busy) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'group flex flex-col items-center justify-center gap-4 py-12 px-6 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200',
              'border-(--border-hover) hover:border-(--accent) hover:bg-(--bg-secondary)',
              dragging && 'border-(--accent) bg-(--bg-secondary)',
              busy && 'opacity-60 pointer-events-none',
            )}
          >
            {/* 图标容器：独立小卡，hover 随拖拽区放大 */}
            <div
              className="flex items-center justify-center size-14 rounded-2xl border border-(--border) bg-(--bg-card) transition-transform duration-200 group-hover:scale-105"
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              {busy ? (
                <Loader2 size={26} className="text-(--accent) animate-spin" strokeWidth={2} />
              ) : (
                <Download size={26} className="text-(--accent)" strokeWidth={2} />
              )}
            </div>
            <p className="text-sm font-medium text-(--text-primary)">
              {busy ? '导入中…' : '点击选择文件 / 拖拽 JSON 到此处'}
            </p>
          </div>

          {/* 错误反馈：destructive 色派生卡片 + 图标，替代裸红字 */}
          {error && (
            <div
              className="animate-enter mt-3 flex items-start gap-2 p-3 rounded-xl border"
              style={{
                background: 'color-mix(in srgb, var(--destructive) 8%, transparent)',
                borderColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)',
              }}
            >
              <AlertCircle size={16} className="text-(--destructive) flex-shrink-0 mt-0.5" />
              <p className="text-sm text-(--destructive) break-words">{error}</p>
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onFileChange}
          />
        </>
      )}
    </Dialog>
  )
}
