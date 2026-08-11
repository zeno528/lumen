import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/shared/password-input'
import { getPasswordVerified, updatePassword, verifyPassword } from '@/api/settings'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { SECTION_CLASS } from './section-styles'

/**
 * 修改账号 / 修改密码（Master-Detail 子视图）。
 * 流程：当前会话在 10 分钟验证时效内（登录/验证密码后）直接进入编辑表单；
 * 否则先验证当前密码（POST /api/auth/verify-password，无副作用）再编辑。
 * 提交成功后端 tokenVersion+1（其他设备 401 退出）并返回新 token——当前会话保留，不重登。
 *
 * 后端 handleChangePassword：newPassword 可选，只改账号时不动密码哈希。
 */
export function ChangeCredentialsForm({
  mode,
  currentUsername,
  onSubView,
}: {
  mode: 'username' | 'password'
  currentUsername: string
  onSubView: (v: string | null) => void
}) {
  const qc = useQueryClient()
  const setToken = useAuthStore((s) => s.setToken)
  const [step, setStep] = useState<'verify' | 'edit'>('verify')
  const [statusLoading, setStatusLoading] = useState(true)
  const [currentPw, setCurrentPw] = useState('')
  const [username, setUsername] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const confirmShownAtRef = useRef(0)

  // 会话已验证（10 分钟时效内）→ 直接跳过验证步骤，避免重复输入当前密码
  useEffect(() => {
    let cancelled = false
    getPasswordVerified()
      .then((s) => {
        if (!cancelled && s.verified) setStep('edit')
      })
      .catch(() => {
        /* 状态拉取失败按未验证处理，走验证步骤 */
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 子视图 mount / 切换步骤后兜底 focus（autoFocus 在 Portal/条件渲染时时机不对）
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 100)
    return () => window.clearTimeout(t)
  }, [step])

  const handleVerify = async () => {
    if (!currentPw) {
      setError('请输入当前密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      await verifyPassword(currentPw)
      setStep('edit')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const validate = (): string | null => {
    if (mode === 'username') {
      const u = username.trim()
      if (!u) return '请输入新账号'
      if (u === currentUsername) return '新账号不能与当前账号相同'
      if (u.length < 2 || u.length > 30) return '账号需 2-30 字符'
      return null
    }
    if (!newPw) return '请输入新密码'
    if (newPw.length < 4) return '新密码至少 4 字符'
    if (newPw !== confirmPw) return '两次输入的新密码不一致'
    if (newPw === currentPw) return '新密码不能与当前密码相同'
    return null
  }

  // 按钮点击：先校验，通过后进入二次确认态（避免误点直接强制重登）。
  // 不用 ConfirmDialog：本表单在 settings 模态框内，弹窗叠弹窗有 ESC 顺序/遮罩叠暗问题。
  const handleSubmit = () => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    confirmShownAtRef.current = Date.now()
    setConfirming(true)
  }

  // 二次确认通过 -> 实际提交（updatePassword + 保留当前会话）
  const handleConfirm = async () => {
    // 防连按回车：确认按钮 autoFocus 后，第二次回车会直接触发提交、确认界面一闪而过。
    // 进入确认态 500ms 内的激活忽略，让用户先看到提示。
    if (Date.now() - confirmShownAtRef.current < 500) return
    setConfirming(false)
    setBusy(true)
    try {
      const data = await updatePassword({
        currentPassword: currentPw, // 已验证时效内可为空，后端凭会话时效放行
        newPassword: mode === 'password' ? newPw : undefined, // 只改账号时不传新密码
        username: mode === 'username' ? username.trim() : undefined,
      })
      setToken(data.token) // 替换为新版本 token：当前会话保留，其他设备旧 token 已失效
      qc.invalidateQueries({ queryKey: ['auth-username'] })
      toast.success(mode === 'username' ? '账号已更新' : '密码已更新')
      onSubView(null)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      if (msg.includes('请先验证')) setStep('verify') // 时效过期兜底：回到验证步骤
      setBusy(false)
    }
  }

  if (statusLoading) return null

  return (
    <div className={cn(SECTION_CLASS, 'gap-4')}>
      {/* fieldset disabled：busy 期间禁用整个表单，防重复提交导致按钮文字反复跳 */}
      <fieldset disabled={busy} className="m-0 p-0 border-0 min-w-0 space-y-4">
        {/* 隐藏 username decoy：吸收浏览器密码管理器的 username 填充，防止溢出到页面其他输入框（主搜索框）。
            Chromium 官方建议 change-password form 即使 username 显而易见也要带一个 username 字段给密码管理器；
            autoComplete="off" Chrome 会故意忽略，唯一可靠解法是给 username 一个明确落点。 */}
        <input type="text" autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
        {step === 'verify' ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="verify-cur-pw">当前密码</Label>
              <PasswordInput
                id="verify-cur-pw"
                ref={inputRef}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                disabled={busy}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void handleVerify()
                }}
              />
              <p className="text-xs text-(--text-muted)">为保障安全，请先验证当前密码（验证后 10 分钟内无需重复输入）</p>
            </div>
            {error && (
              <p role="alert" className="text-xs text-(--destructive)">
                {error}
              </p>
            )}
            <Button onClick={handleVerify} disabled={busy} className="transition-none">
              验证并继续
            </Button>
          </>
        ) : (
          <>
            {mode === 'username' ? (
              <div className="space-y-2">
                <Label htmlFor="edit-username">新账号</Label>
                <Input
                  id="edit-username"
                  ref={inputRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={currentUsername ? `当前：${currentUsername}` : '2-30 字符'}
                  maxLength={30}
                  autoComplete="off"
                  data-1p-ignore=""
                  data-lpignore="true"
                  disabled={busy || confirming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) void handleSubmit()
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <Label htmlFor="edit-new-pw">新密码</Label>
                  <PasswordInput
                    id="edit-new-pw"
                    ref={inputRef}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    disabled={busy || confirming}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy) {
                        // 确认框为空：回车跳到确认框；两框都有内容：回车直接提交
                        if (!confirmPw) {
                          e.preventDefault()
                          confirmRef.current?.focus()
                        } else {
                          void handleSubmit()
                        }
                      }
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-confirm-pw">确认新密码</Label>
                  <PasswordInput
                    id="edit-confirm-pw"
                    ref={confirmRef}
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    disabled={busy || confirming}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy) void handleSubmit()
                    }}
                  />
                </div>
                <p className="text-xs text-(--text-muted)">至少 4 个字符</p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-(--destructive)">
                {error}
              </p>
            )}
            {confirming ? (
              <>
                <p className="text-xs text-(--destructive)">
                  确认提交？修改后其他设备将被强制退出，当前设备保持登录。
                </p>
                <div className="flex gap-2">
                  <Button onClick={handleConfirm} disabled={busy} variant="destructive" autoFocus>
                    确认提交
                  </Button>
                  <Button onClick={() => setConfirming(false)} disabled={busy} variant="outline">
                    取消
                  </Button>
                </div>
              </>
            ) : (
              <Button onClick={handleSubmit} disabled={busy} className="transition-none">
                提交
              </Button>
            )}
          </>
        )}
      </fieldset>
    </div>
  )
}
