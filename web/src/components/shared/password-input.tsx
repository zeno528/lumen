import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * 密码输入 —— 封装 show toggle + autoComplete="new-password" 防密码管理器把旧密码填进新密码框。
 *
 * 项目内"带显隐 toggle 的敏感输入"有两个并列组件，共享交互模式、掩码机制不同：
 * - PasswordInput（本组件）：type=password，真实账号密码（登录 / 改密码），应触发浏览器密码管理器
 * - SecretInput：type=text + -webkit-text-security 掩码，API Key / Token（规避浏览器把密钥
 *   误当登录密码触发密码管理器，详见 secret-input.tsx + effects.css .secret-mask）
 * 之前 account-section / login / ai-section 三处各自写 state + toggle，抽出来统一。
 *
 * 默认属性：
 * - pr-10 给右侧 toggle 让位
 * - autoComplete="new-password"（不提示浏览器保存，避免和当前密码混淆）
 * - data-1p-ignore / data-lpignore（屏蔽 1Password / LastPass 自动填）
 *
 * 用法：<PasswordInput id="x" value={v} onChange={(e) => setV(e.target.value)} />
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, 'type'>
>(function PasswordInput({ className, ...props }, ref) {
  const [show, setShow] = useState(false)
  // 小眼睛仅在有输入时显示（避免空输入框上的视觉噪音），pr-10 同步让位
  const hasValue = !!props.value
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        data-1p-ignore=""
        data-lpignore="true"
        className={cn(hasValue && 'pr-10', className)}
        {...props}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted) hover:text-(--text-primary) transition-colors"
          aria-label={show ? '隐藏密码' : '显示密码'}
          title={show ? '隐藏密码' : '显示密码'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  )
})
