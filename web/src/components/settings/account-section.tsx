import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cat, ChevronRight, LogOut, MonitorSmartphone, Pencil, User } from 'lucide-react'
import { getUsername, getNickname, revokeOtherSessions, updateNickname } from '@/api/settings'
import { useAvatar } from '@/hooks/use-avatar'
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resolveAvatarIcon, getCustomAvatarUrl } from '@/lib/avatar-icons'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ChangeCredentialsForm } from '@/components/settings/change-credentials-form'
import { AvatarPicker } from '@/components/settings/avatar-picker'
import { SECTION_CLASS } from './section-styles'

/**
 * 账号设置 section。
 *
 * 设置页改为模态框后，子操作（改密码/账号/头像）不再弹独立 Dialog（避免弹窗堆叠坑），
 * 改为通过 onSubView 回调通知 SettingsDialog 切换右内容区到对应 Form（Master-Detail）。
 * subView 非空时本组件直接返回对应 Form，由 SettingsDialog 统一渲染子视图头部（返回+标题）。
 */
export function AccountSection({
  subView,
  onSubView,
}: {
  subView: string | null
  onSubView: (v: string | null) => void
}) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const setToken = useAuthStore((s) => s.setToken)
  const qc = useQueryClient()
  const { data: usernameData } = useQuery({ queryKey: ['auth-username'], queryFn: getUsername })
  const { data: nicknameData } = useQuery({ queryKey: ['auth-nickname'], queryFn: getNickname })
  const { data: avatarData } = useAvatar()

  // === 昵称 inline edit 状态机 ===
  const [nickEditing, setNickEditing] = useState(false)
  const [nickDraft, setNickDraft] = useState('')
  // 内部"上次成功保存的值" -- 跟 queryData 解耦，避免 server refetch 时 input 被覆盖
  const [nickCommitted, setNickCommitted] = useState<string | null>(null)
  const [nickPending, setNickPending] = useState(false)
  const [nickError, setNickError] = useState('')
  // 踢出其他设备：内联二次确认态（设置模态框内不弹 Dialog，避免堆叠 ESC/遮罩坑）
  const [revoking, setRevoking] = useState(false)

  // 首次从 queryData 同步到 committed（一次性，ref 防 effect 重跑）
  const initialized = useRef(false)
  useEffect(() => {
    if (!initialized.current && nicknameData) {
      setNickCommitted(nicknameData.nickname || '')
      setNickDraft(nicknameData.nickname || '')
      initialized.current = true
    }
  }, [nicknameData])

  const nickIsDirty = nickEditing && nickDraft !== nickCommitted

  // 暴露 dirty 给 useUnsavedGuard（SettingsDialog 关闭前检测，触发离开确认）
  useUnsavedGuard(nickIsDirty)

  const updateNickMut = useMutation({
    mutationFn: (n: string) => updateNickname(n),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-nickname'] })
    },
  })

  // 踢出其他设备：后端递增 token 版本让旧 token 全失效，返回新 token 替换以保留当前会话
  const revokeMut = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: (data) => {
      setToken(data.token)
      toast.success('其他设备已退出登录')
      setRevoking(false)
    },
    onError: () => toast.error('操作失败，请重试'),
  })

  const startNickEdit = () => {
    setNickDraft(nickCommitted ?? '')
    setNickError('')
    setNickEditing(true)
  }

  const cancelNickEdit = () => {
    setNickDraft(nickCommitted ?? '')
    setNickError('')
    setNickEditing(false)
  }

  const commitNickEdit = async () => {
    if (nickPending) return
    const v = nickDraft.trim()
    if (!v) {
      setNickError('昵称不能为空')
      return
    }
    if (Array.from(v).length > 12) {
      setNickError('昵称最多 12 个字符')
      return
    }
    if (v === nickCommitted) {
      // 没改 -> 退出编辑态
      setNickEditing(false)
      setNickError('')
      return
    }
    setNickError('')
    setNickPending(true)
    try {
      await updateNickMut.mutateAsync(v)
      setNickCommitted(v)
      setNickEditing(false)
      toast.success('昵称已保存')
    } catch (e) {
      setNickError('保存失败: ' + (e as Error).message)
    } finally {
      setNickPending(false)
    }
  }

  // === 头像预览数据 ===
  const customUrl = getCustomAvatarUrl(avatarData?.avatar, avatarData?.avatarImage)
  const AvatarIcon = resolveAvatarIcon(avatarData?.avatar) ?? Cat
  const avatarColor = avatarData?.avatarColor || '#f59e0b'

  // === 子操作视图（Master-Detail：SettingsDialog 切换到 subView 时渲染对应 Form）===
  if (subView === 'change-username' || subView === 'change-password')
    return (
      <ChangeCredentialsForm
        mode={subView === 'change-username' ? 'username' : 'password'}
        currentUsername={usernameData?.username ?? ''}
        onSubView={onSubView}
      />
    )
  if (subView === 'avatar')
    return (
      <AvatarPicker
        currentAvatar={avatarData?.avatar || 'fa-piggy-bank'}
        currentColor={avatarColor}
        currentAvatarImage={avatarData?.avatarImage}
        onDone={() => onSubView(null)}
      />
    )

  // === 默认：账号与安全合并为一个卡片（X 风格：值 + 箭头行）===
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
        <User size={16} />
        账号与安全
      </h3>
      <div className={cn(SECTION_CLASS, 'gap-4')}>
          {/* 头像 */}
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center shrink-0"
              style={customUrl ? undefined : { background: avatarColor + '22', color: avatarColor }}
            >
              {customUrl ? (
                <img src={customUrl} alt="头像" className="w-full h-full object-cover" width={48} height={48} />
              ) : (
                <AvatarIcon size={22} />
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => onSubView('avatar')}>
              修改头像
            </Button>
          </div>

          {/* 昵称（inline edit） */}
          <div className="divide-y divide-(--border)">
            {nickEditing ? (
              <div className="py-3">
                <div className="text-sm font-medium text-(--text-primary)">昵称</div>
                <div className="relative mt-0.5">
                  <Input
                    value={nickDraft}
                    onChange={(e) => setNickDraft(Array.from(e.target.value).slice(0, 12).join(''))}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitNickEdit()
                      if (e.key === 'Escape') {
                        // 拦截冒泡：SettingsDialog 的 ESC 退子视图/关 Dialog，nick 编辑态应先取消编辑
                        e.preventDefault()
                        e.stopPropagation()
                        cancelNickEdit()
                      }
                    }}
                    onBlur={() => void commitNickEdit()}
                    disabled={nickPending}
                    autoFocus
                    title="回车或失焦时自动保存，ESC 取消"
                    className="h-7 rounded-lg text-xs border-(--border-hover) focus:shadow-none focus:ring-4 focus:ring-(--accent)/15"
                    aria-label="编辑昵称"
                    aria-invalid={!!nickError}
                  />
                  {nickError && (
                    <p role="alert" className="absolute left-0 top-full z-10 mt-1 rounded bg-(--bg-secondary) px-1 text-xs text-(--destructive)">
                      {nickError}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-3">
                <div className="text-sm font-medium text-(--text-primary)">昵称</div>
                <button
                  type="button"
                  onClick={startNickEdit}
                  className="group inline-flex h-7 min-w-0 items-center gap-1.5 mt-0.5 text-xs text-(--text-muted) transition-colors hover:text-(--accent)"
                  title="编辑昵称"
                >
                  <span className="truncate">{nickCommitted ?? '-'}</span>
                  <Pencil size={13} className="shrink-0 text-(--text-muted) transition-colors group-hover:text-(--accent)" />
                </button>
              </div>
            )}

          {/* 账号 / 密码（修改入口，X 风格行） */}
            <button
              type="button"
              onClick={() => onSubView('change-username')}
              className="w-full py-3 flex items-center justify-between gap-3 text-left group"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-(--text-primary)">账号</div>
                <div className="text-xs text-(--text-muted) mt-0.5 truncate">{usernameData?.username ?? '-'}</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-(--text-muted) transition-colors group-hover:text-(--accent)" />
            </button>
            <button
              type="button"
              onClick={() => onSubView('change-password')}
              className="w-full py-3 flex items-center justify-between gap-3 text-left group"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-(--text-primary)">密码</div>
                <div className="text-xs text-(--text-muted) mt-0.5">••••••••</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-(--text-muted) transition-colors group-hover:text-(--accent)" />
            </button>
            {revoking ? (
              <div className="h-14 py-3 flex items-center gap-2 flex-nowrap">
                <MonitorSmartphone size={16} className="shrink-0 text-(--destructive)" />
                <span className="text-sm text-(--text-muted) shrink-0">其他设备将需要重新登录</span>
                <Button variant="destructive" size="sm" disabled={revokeMut.isPending} onClick={() => revokeMut.mutate()}>
                  退出
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRevoking(false)}>
                  取消
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRevoking(true)}
                className="w-full h-14 py-3 flex items-center gap-3 text-left group"
              >
                <MonitorSmartphone size={16} className="shrink-0 text-(--text-muted) transition-colors group-hover:text-(--accent)" />
                <div className="text-sm font-medium text-(--text-primary)">退出其他设备</div>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                logout()
                navigate({ to: '/login' })
              }}
              className="w-full h-14 py-3 flex items-center gap-3 text-left text-(--destructive) transition-opacity hover:opacity-80"
            >
              <LogOut size={16} className="shrink-0" />
              <div className="text-sm font-medium">退出登录</div>
            </button>
          </div>
      </div>
    </section>
  )
}
