import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/shared/password-input'
import { updatePassword } from '@/api/settings'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { SECTION_CLASS } from './section-styles'

/**
 * 修改账号/密码表单（合并）-- 新账号 / 新密码留空不改，支持单独改账号 / 单独改密码 / 全部改。
 * 一次提交只触发一次 tokenVersion+1，只退出重登一次（解决新部署后改账号+密码要重登两次的痛点）。
 * 提交成功强制重登（后端 IncrementTokenVersion）。
 *
 * 后端 handleChangePassword 强制 newPassword 必填，不改密码时用当前密码占位（后端不校验新旧一致）。
 */
export function ChangeCredentialsForm({ currentUsername }: { currentUsername: string }) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const [username, setUsername] = useState('')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  // 子视图 mount 后兜底 focus（autoFocus 在 Portal/条件渲染时时机不对）
  useEffect(() => {
    const t = window.setTimeout(() => firstInputRef.current?.focus(), 100)
    return () => window.clearTimeout(t)
  }, [])

  const validate = (): string | null => {
    if (!currentPw) return '请输入当前密码'
    const u = username.trim()
    const hasUsername = u !== '' && u !== currentUsername
    const hasPassword = newPw !== ''
    if (!hasUsername && !hasPassword) return '请至少修改账号或密码一项'
    if (hasUsername && (u.length < 2 || u.length > 30)) return '账号需 2-30 字符'
    if (hasPassword) {
      if (newPw.length < 4) return '新密码至少 4 字符'
      if (newPw !== confirmPw) return '两次输入的新密码不一致'
      if (newPw === currentPw) return '新密码不能与当前密码相同'
    }
    return null
  }

  // 按钮点击：先校验，通过后进入二次确认态（避免误点直接强制重登）。
  // 不用 ConfirmDialog：本表单在 settings 模态框内，弹窗叠弹窗有 ESC 顺序/遮罩叠暗问题（见 memory）。
  const handleSubmit = () => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setConfirming(true)
  }
  // 二次确认通过 -> 实际提交（updatePassword + 强制重登）
  const handleConfirm = async () => {
    setConfirming(false)
    setSubmitting(true)
    try {
      const u = username.trim()
      const hasUsername = u !== '' && u !== currentUsername
      await updatePassword({
        currentPassword: currentPw,
        newPassword: newPw || currentPw, // 不改密码用当前密码占位（后端必填）
        username: hasUsername ? u : undefined,
      })
      toast.success('账号/密码已更新，请重新登录')
      logout()
      navigate({ to: '/login' })
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div className={cn(SECTION_CLASS, 'gap-4')}>
      {/* fieldset disabled：submitting 期间禁用整个表单，防重复提交导致按钮文字反复跳 */}
      <fieldset disabled={submitting} className="m-0 p-0 border-0 min-w-0 space-y-4">
        {/* 验证身份（必填）*/}
        <div className="space-y-2">
          <div className="text-xs font-medium text-(--text-primary) pl-2 border-l-2 border-(--accent)">验证身份</div>
          <div>
            <Label htmlFor="change-cred-cur">当前密码 *</Label>
            <PasswordInput
              id="change-cred-cur"
              ref={firstInputRef}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              disabled={submitting || confirming}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) void handleSubmit()
              }}
            />
          </div>
        </div>

        {/* 修改账号（可选，留空不改）*/}
        <div className="space-y-2">
          <div className="text-xs font-medium text-(--text-primary) pl-2 border-l-2 border-(--accent)">修改账号（留空不改）</div>
          <div>
            <Label htmlFor="change-cred-username">新账号</Label>
            <Input
              id="change-cred-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={currentUsername ? `当前：${currentUsername}` : '2-30 字符'}
              maxLength={30}
              autoComplete="off"
              data-1p-ignore=""
              data-lpignore="true"
              disabled={submitting || confirming}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) void handleSubmit()
              }}
            />
          </div>
        </div>

        {/* 修改密码（可选，留空不改）*/}
        <div className="space-y-2">
          <div className="text-xs font-medium text-(--text-primary) pl-2 border-l-2 border-(--accent)">修改密码（留空不改，≥ 4 字符）</div>
          <div>
            <Label htmlFor="change-cred-new">新密码</Label>
            <PasswordInput
              id="change-cred-new"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={submitting || confirming}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) void handleSubmit()
              }}
            />
          </div>
          <div>
            <Label htmlFor="change-cred-confirm">确认新密码</Label>
            <PasswordInput
              id="change-cred-confirm"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              disabled={submitting || confirming}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) void handleSubmit()
              }}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs text-(--destructive)">
            {error}
          </p>
        )}
        {confirming ? (
          <p className="text-xs text-(--destructive)">
            确认提交？修改后所有设备会强制退出，需重新登录。
          </p>
        ) : (
          <p className="text-xs text-(--text-muted)">
            修改后将强制重新登录，所有设备会退出。
          </p>
        )}
        {confirming ? (
          <div className="flex gap-2">
            <Button onClick={handleConfirm} disabled={submitting} variant="destructive">
              确认提交
            </Button>
            <Button onClick={() => setConfirming(false)} disabled={submitting} variant="outline">
              取消
            </Button>
          </div>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting} className="transition-none">
            提交
          </Button>
        )}
      </fieldset>
    </div>
  )
}
