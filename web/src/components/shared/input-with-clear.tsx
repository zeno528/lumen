import * as React from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** 带清空按钮的输入框（right 追加额外右侧元素，hideClear 用于指示器占位场景）。 */
const InputWithClear = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    right?: React.ReactNode
    hideClear?: boolean
    inputClassName?: string
  }
>(function InputWithClear(
  { value, onChange, right, hideClear, inputClassName, ...props },
  ref,
) {
  return (
    <div className="relative">
      <Input
        ref={ref}
        value={value}
        onChange={onChange}
        className={cn('pr-8', inputClassName)}
        {...props}
      />
      {/* hideClear：AI 回填指示器占用清除按钮位置时隐藏清除按钮 */}
      {value && !hideClear && (
        <button
          type="button"
          className="input-icon-btn absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-xs"
          onClick={() => onChange?.({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>)}
          title="清空"
        >
          <X size={14} />
        </button>
      )}
      {right}
    </div>
  )
})

export { InputWithClear }
