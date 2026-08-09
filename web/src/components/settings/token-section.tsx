import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Plus, Pencil, Trash2, KeyRound, X, ExternalLink } from 'lucide-react'
import { listTokens, createToken, updateToken, deleteToken } from '@/api/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { useAuthStore } from '@/stores/auth'
import { SECTION_CLASS } from './section-styles'
import { cn } from '@/lib/utils'

const TOKEN_BOX =
  'flex flex-col gap-2 p-3.5 rounded-xl border border-(--border) bg-(--bg-primary)'

/**
 * API Token 设置 section。
 *
 * 设置页改为模态框后，改名/删除不再弹 Dialog/ConfirmDialog（避免弹窗堆叠坑）：
 * - 改名：行内编辑（点编辑 -> 名变 input + 保存/取消）
 * - 删除：行内确认（点删除 -> 整行变红 + 确认删除/取消）
 */
export function TokenSection() {
  const qc = useQueryClient()
  const { data: tokens = [] } = useQuery({
    queryKey: ['tokens'],
    queryFn: listTokens,
  })
  const createMut = useMutation({
    mutationFn: (name: string) => createToken(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  })

  const [name, setName] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  /** 行内改名：editingId 命中时该 token 名变 input */
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  /** 行内删除确认：confirmingDeleteId 命中时该行显示确认 */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  // 复制反馈：图标变 ✓ + 文字变「已复制」，1.5s 后恢复
  const [copiedToken, setCopiedToken] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    try {
      const res = await createMut.mutateAsync(name.trim() || 'API Token')
      setNewToken(res.token)
      setName('')
      toast.success('Token 创建成功')
    } catch (e) {
      toast.error('创建失败: ' + (e as Error).message)
    }
  }

  const copy = (text: string, msg: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(msg)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const saveEdit = async () => {
    if (editingId === null) return
    if (saving) return
    const trimmed = editName.trim()
    if (!trimmed) {
      toast.warning('名称不能为空')
      return
    }
    setSaving(true)
    try {
      await updateToken(editingId, trimmed)
      qc.invalidateQueries({ queryKey: ['tokens'] })
      toast.success('名称已更新')
      setEditingId(null)
    } catch {
      toast.error('更新失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteToken(id)
      qc.invalidateQueries({ queryKey: ['tokens'] })
      toast.success('Token 已删除')
    } catch {
      toast.error('删除失败')
    } finally {
      setConfirmingDeleteId(null)
    }
  }

  const handleOpenAPIDocs = async () => {
    const popup = window.open('', '_blank')
    if (!popup) return
    try {
      const authToken = useAuthStore.getState().token
      const res = await fetch('/openapi.json', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      })
      if (!res.ok) throw new Error(`请求失败 (${res.status})`)
      const url = URL.createObjectURL(await res.blob())
      popup.location.href = url
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      popup.close()
      toast.error('API 文档打开失败: ' + (e as Error).message)
    }
  }

  const fmtDate = (s?: string) => {
    if (!s) return ''
    try {
      const d = new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z')
      return d.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return s
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
            <KeyRound size={16} />
            API Token
          </h3>
        </div>
        <p className="text-xs text-(--text-muted) mt-0.5">
          用于 AI agent 调用本服务 API（Bearer 鉴权，与登录 JWT 独立）
          {' '}
          <a
            href="/openapi.json"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault()
              void handleOpenAPIDocs()
            }}
            className="inline-flex items-center gap-1 align-middle text-(--accent) hover:underline"
          >
            <ExternalLink size={11} /> 查看 API 文档
          </a>
        </p>
      </div>
      <div className={SECTION_CLASS}>

      {/* 创建 */}
      <div className="flex gap-2">
        <Input
          className="flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token 名称（如：Openclaw）"
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <Button
          onClick={handleCreate}
          disabled={createMut.isPending}
          className="h-11"
        >
          <Plus size={14} /> 创建
        </Button>
      </div>

      {/* 新建明文展示 */}
      {newToken && (
        <div className={TOKEN_BOX}>
          <div className="flex items-center gap-2 w-full">
            <code className="flex-1 min-w-0 h-8 text-[0.82rem] leading-8 text-(--text-primary) select-all bg-(--bg-secondary) px-2.5 rounded-lg border border-(--border) font-mono overflow-hidden text-ellipsis whitespace-nowrap">
              {newToken}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(newToken, 'Token 已复制', setCopiedToken)}
            >
              {copiedToken ? (
                <Check size={12} className="text-(--success)" strokeWidth={3} />
              ) : (
                <Copy size={12} />
              )}
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <code className="flex-1 min-w-0 h-8 text-[0.82rem] leading-8 text-(--text-primary) select-all bg-(--bg-secondary) px-2.5 rounded-lg border border-(--border) font-mono overflow-hidden text-ellipsis whitespace-nowrap">
              curl -H &quot;Authorization: Bearer {newToken}&quot;{' '}
              {location.origin}/api/bookmarks
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copy(
                  `curl -H "Authorization: Bearer ${newToken}" ${location.origin}/api/bookmarks`,
                  'cURL 已复制',
                  setCopiedCurl,
                )
              }
            >
              {copiedCurl ? (
                <Check size={12} className="text-(--success)" strokeWidth={3} />
              ) : (
                <Copy size={12} />
              )}
            </Button>
          </div>
          <p className="text-xs text-(--text-muted) m-0">
            ⚠️ 明文仅显示此次，请立即复制保存，关闭后无法再查看。
          </p>
          <Button
            variant="default"
            size="sm"
            className="self-end"
            onClick={() => setNewToken(null)}
          >
            我已保存
          </Button>
        </div>
      )}

      {/* Token 列表 */}
      <div className="flex flex-col gap-2">
        {tokens.length === 0 ? (
          <div className="text-center text-(--text-muted) py-5 text-sm">
            还没有创建 Token
          </div>
        ) : (
          tokens.map((t) => (
            <div
              key={t.id}
              className={cn(
                // min-h 锁定展示/编辑两态等高：展示态左侧两行(token 名 text-sm≈20px + 日期 text-xs+mt-0.5≈18px)
                // 内容约 38px，编辑态仅一行 Input(h-8=32px)约 32px，且第二行 token 值/日期整行消失，
                // 不锁定则点编辑瞬间卡片缩 ~6px 抖动。取 60px(略高于展示态自然 58px)，两态统一为 60px，
                // items-center 让编辑态 Input 垂直居中，消除点击编辑的高度跳变
                'flex items-center justify-between min-h-[60px] p-2.5 px-3 rounded-xl border transition-colors',
                confirmingDeleteId === t.id
                  ? 'border-[var(--destructive)] bg-[var(--destructive-soft-bg)]'
                  : 'border-(--border) bg-(--bg-primary) hover:border-[color-mix(in_srgb,var(--accent)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_3%,var(--bg-primary))]',
              )}
            >
              <div className="flex-1 min-w-0">
                {editingId === t.id ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      className="h-8 text-sm"
                    />
                    <Button size="sm" onClick={saveEdit} disabled={saving}>
                      保存
                    </Button>
                    <Button size="sm" variant="soft" onClick={() => setEditingId(null)}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-medium text-(--text-primary)">
                      {t.name}
                    </div>
                    <div className="text-xs text-(--text-muted) mt-0.5">
                      <code className="font-mono text-(--accent) text-xs">
                        {t.prefix}∗∗∗∗∗∗{t.suffix}
                      </code>
                      {` · 创建于 ${fmtDate(t.created_at)}`}
                      {t.last_used_at ? ` · 最近使用 ${fmtDate(t.last_used_at)}` : ''}
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-1 shrink-0 items-center">
                {editingId === t.id ? null : confirmingDeleteId === t.id ? (
                  <>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(t.id)}>
                      <Trash2 size={13} /> 确认删除
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setConfirmingDeleteId(null)}
                      aria-label="取消删除"
                    >
                      <X size={14} />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="编辑名称"
                      /* 行容器 bg-(--bg-primary) 与 ghost variant 默认 hover:bg-(--bg-primary) 同色看不出，
                         用 accent 浅色底 + accent 图标色，覆盖默认 hover */
                      className="text-(--text-muted) hover:bg-(--accent-hover-bg) hover:text-(--accent)"
                      onClick={() => {
                        setEditingId(t.id)
                        setEditName(t.name)
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除"
                      className="text-(--text-muted) hover:text-[var(--destructive)] hover:bg-[var(--destructive-soft-bg)]"
                      onClick={() => setConfirmingDeleteId(t.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      </div>
    </section>
  )
}
