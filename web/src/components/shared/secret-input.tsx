import { forwardRef, useState, type ComponentPropsWithoutRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * 敏感密钥输入（API Key / Token 等）—— 封装 show toggle + 掩码，复用 PasswordInput 的交互模式。
 *
 * 和 PasswordInput 的区别仅在掩码机制：
 * - PasswordInput 用 type=password（真实账号密码，应触发浏览器密码管理器帮用户保存登录凭据）
 * - SecretInput 用 type="text" + -webkit-text-security 掩码，规避浏览器把 API Key 误当登录密码
 *   （Chrome 自 2014 起故意忽略密码字段 autocomplete，type=password 必触发密码管理器；
 *   autocomplete="new-password" 只挡自动填充挡不住建议条，data-1p-ignore/lpignore 只对
 *   1Password/LastPass 扩展有效。详见 effects.css .secret-mask）
 *
 * 默认属性：
 * - pr-10 给右侧 toggle 让位
 * - autoComplete="off"（密钥不是密码，off 比 new-password 语义更准）
 * - data-1p-ignore / data-lpignore（屏蔽 1Password / LastPass 自动填）
 * - 掩码态挂 .secret-mask（effects.css），显隐切换加/去该 class（而非切 type）
 *
 * 用法：<SecretInput id="x" value={v} onChange={(e) => setV(e.target.value)} placeholder="..." />
 */
export const SecretInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, 'type'>
>(function SecretInput({ className, ...props }, ref) {
  const [show, setShow] = useState(false)
  // 小眼睛仅在有输入时显示（避免空输入框上的视觉噪音），pr-10 同步让位
  const hasValue = !!props.value
  return (
    <div className="relative">
      <Input
        ref={ref}
        type="text"
        autoComplete="off"
        data-1p-ignore=""
        data-lpignore="true"
        className={cn(hasValue && 'pr-10', !show && 'secret-mask', className)}
        {...props}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted) hover:text-(--text-primary) transition-colors"
          aria-label={show ? '隐藏密钥' : '显示密钥'}
          title={show ? '隐藏密钥' : '显示密钥'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  )
})
