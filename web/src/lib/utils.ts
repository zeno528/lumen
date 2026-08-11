import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui 标准的 className 合并工具：clsx（条件类）+ tailwind-merge（去冲突）*/
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 新标签页安全打开外链（noopener+noreferrer 防反向 tabnabbing） */
export function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
