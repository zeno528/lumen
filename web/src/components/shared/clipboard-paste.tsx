import { Clipboard } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

/** 读剪贴板文本（空/无权限给 toast），返回文本或 null */
export async function pasteClipboardText(): Promise<string | null> {
  try {
    const text = (await navigator.clipboard.readText()).trim()
    if (!text) {
      toast.warning('剪贴板为空')
      return null
    }
    return text
  } catch {
    toast.error('无法读取剪贴板（浏览器需要权限）')
    return null
  }
}

/** 输入框内粘贴按钮（空态显示，复用 input-icon-btn 输入框内按钮样式） */
export function PasteButton({
  onPaste,
  className,
}: {
  onPaste: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPaste}
      className={cn(
        'input-icon-btn p-1',
        className,
      )}
      aria-label="粘贴剪贴板链接"
      title="粘贴剪贴板链接"
    >
      <Clipboard size={16} />
    </button>
  )
}
