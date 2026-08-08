import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] text-sm font-normal whitespace-nowrap transition-colors transition-shadow duration-150 outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-(--accent) text-white shadow-sm hover:bg-(--accent-hover)",
        destructive:
          "bg-gradient-to-br from-[var(--destructive)] to-[var(--destructive-dark)] text-white hover:opacity-90",
        outline:
          "border border-(--border) bg-(--bg-primary) text-(--text-primary) hover:bg-(--bg-card-hover) hover:border-(--border-hover)",
        secondary:
          "bg-(--bg-secondary) text-(--text-primary) hover:bg-(--bg-card-hover)",
        ghost:
          "text-(--text-secondary) hover:bg-(--bg-primary) hover:text-(--text-primary)",
        // footer 次级按钮：灰色实心契约
        soft: "bg-(--border) text-(--text-secondary) hover:bg-(--border-hover) hover:text-(--text-primary)",
        // AI 智能填充按钮：3 色粉紫蓝紫斜向渐变（HSL 330°→271°→239° 单调递减 91°）。
        // 3 色 = 渐变按钮黄金比例；走 token 体系（--ai-g-1/-2/-3）。
        // 文字白 + drop-shadow 补足浅色段对比度；悬停 saturate-125 + 单色辉光（紫）= 克制"AI 启动"感。
        // 不可用态由根 className disabled:opacity-50 处理。
        ai: "bg-[image:linear-gradient(135deg,var(--ai-g-1),var(--ai-g-2),var(--ai-g-3))] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:saturate-125 hover:shadow-[0_0_24px_color-mix(in_srgb,var(--ai-g-2)_45%,transparent)]",
        link: "text-(--accent) underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3 py-2",
        xs: "h-7 gap-1 rounded-lg px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-xl px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
