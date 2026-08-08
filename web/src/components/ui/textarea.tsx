import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-[10px] border border-(--border) bg-(--bg-input) px-3.5 py-2.5',
        'text-base text-(--text-primary) placeholder:text-(--text-muted)',
        'transition-all duration-200 resize-none',
        'focus:border-(--accent) focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_15%,transparent)] focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea }
