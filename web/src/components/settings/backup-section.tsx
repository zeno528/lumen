import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import {
  getBackupSettings,
  updateBackupSettings,
  listBackups,
  runBackup,
  renameBackup,
  deleteBackup,
  previewBackup,
  restoreBackup,
  type BackupFile,
} from '@/api/backups'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { formatBytes, formatDateTime } from '@/lib/format'
import { SECTION_CLASS } from './section-styles'
import { cn } from '@/lib/utils'

const INTERVALS = [
  { hours: 0, label: '关闭自动备份' },
  { hours: 6, label: '每 6 小时' },
  { hours: 12, label: '每 12 小时' },
  { hours: 24, label: '每天' },
  { hours: 168, label: '每周' },
]
const MAX_COUNTS = [3, 5, 7, 10, 20]
const INTERVAL_OPTIONS = INTERVALS.map(({ label }) => ({ value: label, label }))
const COUNT_OPTIONS = MAX_COUNTS.map((count) => {
  const label = `${count} 份`
  return { value: label, label, count }
})

export function BackupSection() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['backup-settings'],
    queryFn: getBackupSettings,
    refetchOnMount: 'always',
  })
  const filesQuery = useQuery({
    queryKey: ['backups'],
    queryFn: listBackups,
    refetchOnMount: 'always',
  })
  const settings = settingsQuery.data
  const backups = filesQuery.data?.backups ?? []

  const [intervalHours, setIntervalHours] = useState(24)
  const [maxCount, setMaxCount] = useState(3)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const previewQuery = useQuery({
    queryKey: ['backup-preview', restoringId],
    queryFn: () => previewBackup(restoringId as string),
    enabled: !!restoringId,
  })

  useEffect(() => {
    if (!settings) return
    setIntervalHours(settings.interval_hours)
    setMaxCount(settings.max_count)
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: (input: { interval_hours: number; max_count: number }) => updateBackupSettings(input),
    onSuccess: (data) => {
      qc.setQueryData(['backup-settings'], data)
      void qc.invalidateQueries({ queryKey: ['backups'] })
      toast.success('备份设置已保存')
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const runMutation = useMutation({
    mutationFn: runBackup,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['backup-settings'] })
      void qc.invalidateQueries({ queryKey: ['backups'] })
      toast.success('备份创建成功')
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameBackup(id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['backups'] })
      toast.success('名称已更新')
      setEditingId(null)
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBackup,
    onSuccess: (_, id) => {
      qc.setQueryData<{ backups: BackupFile[] }>(['backups'], (current) =>
        current ? { backups: current.backups.filter((item) => item.id !== id) } : current,
      )
      toast.success('备份已删除')
      setDeletingId(null)
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const restoreMutation = useMutation({
    mutationFn: restoreBackup,
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['bookmarks'] })
      void qc.invalidateQueries({ queryKey: ['categories'] })
      void qc.invalidateQueries({ queryKey: ['backup-settings'] })
      void qc.invalidateQueries({ queryKey: ['backups'] })
      toast.success(`已恢复 ${result.restored_bookmarks} 个书签`)
      setRestoringId(null)
    },
    onError: (error) => toast.error((error as Error).message),
  })

  const busy =
    settingsQuery.isLoading || saveMutation.isPending || runMutation.isPending || restoreMutation.isPending

  const saveEdit = async (id: string) => {
    const name = editName.trim()
    if (!name) {
      toast.warning('名称不能为空')
      return
    }
    renameMutation.mutate({ id, name })
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="inline-flex items-center gap-2 text-base font-semibold text-(--text-primary)">
          <Database size={16} />
          备份
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-(--text-muted)">
          在服务器本机创建 SQLite 一致性快照；定时任务由后端运行，恢复仅回滚书签与分类。
        </p>
      </div>

      <div className={cn(SECTION_CLASS, 'gap-4')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-(--text-secondary)">备份间隔</span>
            <Combobox
              readOnly
              value={INTERVALS.find((i) => i.hours === intervalHours)?.label ?? ''}
              onChange={(label) => {
                const next = INTERVALS.find((i) => i.label === label)
                if (!next) return
                setIntervalHours(next.hours)
                saveMutation.mutate({ interval_hours: next.hours, max_count: maxCount })
              }}
              options={INTERVAL_OPTIONS}
              disabled={busy}
              inputClassName="h-11"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-(--text-secondary)">最大保留数量</span>
            <Combobox
              readOnly
              value={COUNT_OPTIONS.find((o) => o.count === maxCount)?.label ?? ''}
              onChange={(label) => {
                const next = COUNT_OPTIONS.find((o) => o.label === label)
                if (!next) return
                setMaxCount(next.count)
                saveMutation.mutate({ interval_hours: intervalHours, max_count: next.count })
              }}
              options={COUNT_OPTIONS}
              disabled={busy}
              inputClassName="h-11"
            />
          </label>
        </div>

        <div className="grid gap-2 rounded-xl border border-(--border) bg-(--bg-primary) p-3 text-xs text-(--text-secondary)">
          <div>上次备份：{formatDateTime(settings?.last_run_at)}</div>
          <div>下次备份：{formatDateTime(settings?.next_run_at)}</div>
          {settings?.last_error && (
            <div className="text-[var(--destructive)]">最近错误：{settings.last_error}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            size="sm"
            onClick={() => runMutation.mutate()}
            disabled={busy || runMutation.isPending}
          >
            {runMutation.isPending ? '备份中…' : '立即备份'}
          </Button>
        </div>
      </div>

      <div className="mt-1">
        <h3 className="text-base font-semibold text-(--text-primary)">备份记录</h3>
        <p className="mt-0.5 text-xs leading-5 text-(--text-muted)">
          可修改便于识别的名称；恢复前会展示该快照的明细并要求二次确认。
        </p>
      </div>

      <div className={SECTION_CLASS}>
        {filesQuery.isLoading ? (
          <p className="py-2 text-sm text-(--text-secondary)">正在加载备份…</p>
        ) : backups.length === 0 ? (
          <p className="py-2 text-center text-sm text-(--text-muted)">暂无备份</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {backups.map((item) => {
              const isEditing = editingId === item.id
              const isDeleting = deletingId === item.id
              const isRestoring = restoringId === item.id

              return (
                <li
                  key={item.id}
                  className={cn(
                    'rounded-xl border transition-colors',
                    isRestoring || isDeleting
                      ? 'border-[var(--destructive)] bg-(--bg-primary)'
                      : 'border-(--border) bg-(--bg-primary)',
                  )}
                >
                  <div className="flex min-h-[52px] items-center justify-between gap-3 p-2.5 px-3">
                    {isEditing ? (
                      <div className="flex min-h-[38px] min-w-0 flex-1 items-center">
                        <Input
                          autoFocus
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEdit(item.id)
                            if (event.key === 'Escape') setEditingId(null)
                          }}
                          maxLength={120}
                          className="h-9 text-sm"
                          aria-label="备份名称"
                        />
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-(--text-primary)">
                          {item.display_name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-(--text-muted)">
                          {formatDateTime(item.created_at)} · {formatBytes(item.size_bytes)} ·{' '}
                          {item.source === 'auto' ? '自动' : '手动'}
                        </p>
                      </div>
                    )}

                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button size="sm" onClick={() => void saveEdit(item.id)} disabled={renameMutation.isPending}>
                            保存
                          </Button>
                          <Button variant="soft" size="icon-sm" onClick={() => setEditingId(null)} aria-label="取消改名">
                            <X size={14} />
                          </Button>
                        </>
                      ) : isDeleting || isRestoring ? (
                        <>
                          <Button variant="soft" size="icon-sm" onClick={() => {
                            setDeletingId(null)
                            setRestoringId(null)
                          }} aria-label="取消操作">
                            <X size={14} />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="改名"
                            title="改名"
                            className="text-(--text-muted) hover:bg-(--accent-hover-bg) hover:text-(--accent)"
                            onClick={() => {
                              setEditingId(item.id)
                              setEditName(item.display_name)
                            }}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="恢复此备份"
                            title="恢复此备份"
                            disabled={restoreMutation.isPending}
                            className="text-(--text-muted) hover:bg-(--accent-hover-bg) hover:text-(--accent)"
                            onClick={() => setRestoringId(item.id)}
                          >
                            <RotateCcw size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="删除"
                            title="删除"
                            className="text-(--text-muted) hover:text-[var(--destructive)] hover:bg-[var(--destructive-soft-bg)]"
                            onClick={() => setDeletingId(item.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {(isDeleting || isRestoring) && (
                    <div className="mx-2.5 mb-2.5 rounded-xl bg-(--bg-input) p-3">
                      {isDeleting ? (
                        <>
                          <p className="text-sm font-medium text-(--text-primary)">删除这份备份？</p>
                          <p className="mt-1 text-xs leading-5 text-(--text-secondary)">
                            该 SQLite 快照将被移除，之后无法用它恢复数据。
                          </p>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button size="sm" variant="soft" onClick={() => setDeletingId(null)}>
                              取消
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(item.id)}>
                              确认删除
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-(--text-primary)">确认恢复到这份备份？</p>
                          <p className="mt-2 text-xs leading-5 text-(--text-secondary)">
                            {previewQuery.isPending
                              ? '正在读取备份内容…'
                              : previewQuery.data
                                ? `这份备份包含 ${previewQuery.data.bookmarks} 个书签、${previewQuery.data.categories} 个分类`
                                : `备份内容读取失败：${previewQuery.error instanceof Error ? previewQuery.error.message : '未知错误'}`}
                          </p>
                          <p className="mt-2 text-xs leading-5 text-(--text-secondary)">
                            恢复将覆盖当前的书签和分类，且不可撤销（账号与设置不受影响）。
                          </p>
                          <div className="mt-3 flex justify-end gap-2">
                            <Button size="sm" variant="soft" onClick={() => setRestoringId(null)}>
                              取消
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={restoreMutation.isPending}
                              onClick={() => restoreMutation.mutate(item.id)}
                            >
                              确认恢复
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
