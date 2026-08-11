import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cat, LogOut, Shield, User } from 'lucide-react'
import { getUsername, getNickname, updateNickname } from '@/api/settings'
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
    onSuccess: (_data, n) => {
      try {
        localStorage.setItem('nickname', n)
      } catch {
        /* quota 等不影响功能 */
      }
      qc.invalidateQueries({ queryKey: ['auth-nickname'] })
    },
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
    if (v.length > 20) {
      setNickError('昵称最多 20 字符')
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
  if (subView === 'change-credentials')
    return <ChangeCredentialsForm currentUsername={usernameData?.username ?? ''} />
  if (subView === 'avatar')
    return (
      <AvatarPicker
        currentAvatar={avatarData?.avatar || 'fa-piggy-bank'}
        currentColor={avatarColor}
        currentAvatarImage={avatarData?.avatarImage}
        onDone={() => onSubView(null)}
      />
    )

  // === 默认：账号 + 安全 section ===
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
          <User size={16} />
          账号
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
          <div>
            <div className="text-xs text-(--text-muted) mb-1.5 flex items-center gap-2">
              <span>昵称</span>
              <span className="text-(--text-muted)/70">· 点击编辑</span>
            </div>
            {nickEditing ? (
              <div className="space-y-1.5">
                <Input
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
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
                  maxLength={20}
                  disabled={nickPending}
                  autoFocus
                  className="h-9 rounded-lg text-sm border-(--border-hover) focus:shadow-none focus:ring-4 focus:ring-(--accent)/15"
                  aria-label="编辑昵称"
                  aria-invalid={!!nickError}
                />
                {nickError && (
                  <p role="alert" className="text-xs text-(--destructive)">
                    {nickError}
                  </p>
                )}
                <p className="text-xs text-(--text-muted)">回车保存 · ESC 取消 · 失焦自动保存</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={startNickEdit}
                className="text-sm text-(--text-primary) hover:text-(--accent) hover:underline transition-colors"
                title="点击编辑昵称"
              >
                {nickCommitted ?? '-'}
              </button>
            )}
          </div>

          {/* 账号（只读，修改入口在安全区「修改账号密码」） */}
          <div>
            <div className="text-xs text-(--text-muted) mb-1.5">账号</div>
            <span className="text-sm text-(--text-primary)">{usernameData?.username ?? '-'}</span>
            <p className="text-xs text-(--text-muted) mt-1.5">用于登录，改动需重新登录</p>
          </div>

          {/* 退出登录 */}
          <div className="pt-2 mt-1 border-t border-(--border)">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                logout()
                navigate({ to: '/login' })
              }}
            >
              <LogOut size={14} className="text-(--destructive)" />
              退出登录
            </Button>
          </div>
        </div>
      </section>

      {/* 安全区 */}
      <section className="flex flex-col gap-2 mt-6">
        <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
          <Shield size={16} />
          安全
        </h3>
        <div className={SECTION_CLASS}>
          <div className="divide-y divide-(--border)">
            <div className="py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-(--text-primary)">修改账号密码</div>
                <div className="text-xs text-(--text-muted) mt-0.5">可单独改账号 / 密码，或一起改</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => onSubView('change-credentials')}>
                修改
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
