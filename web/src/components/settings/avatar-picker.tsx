import { useRef, useState } from 'react'
import { ImageUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUpdateAvatar } from '@/hooks/use-avatar'
import {
  AVATAR_COLORS,
  AVATAR_ICON_GROUPS,
  resolveAvatarIcon,
  UPLOADED_AVATAR_KEY,
  getCustomAvatarUrl,
  isCustomAvatar,
} from '@/lib/avatar-icons'
import { AVATAR_UPLOAD_SIZES } from '@/lib/avatar-upload'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { SECTION_CLASS } from './section-styles'

const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_AVATAR_IMAGE_BYTES = 48 * 1024
const ACCEPTED_AVATAR_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function parseCurrentAvatar(currentAvatar: string): { isCustom: boolean; icon: string } {
  if (isCustomAvatar(currentAvatar)) {
    return { isCustom: true, icon: 'fa-piggy-bank' }
  }
  return { isCustom: false, icon: currentAvatar || 'fa-piggy-bank' }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

async function compressAvatarImage(file: File): Promise<string> {
  if (!ACCEPTED_AVATAR_IMAGE_TYPES.has(file.type) || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('请选择 5 MB 以内的 JPG、PNG 或 WebP 图片')
  }
  const sourceURL = URL.createObjectURL(file)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('无法读取图片'))
      image.src = sourceURL
    })
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context || side === 0) throw new Error('无法处理图片')
    for (const size of AVATAR_UPLOAD_SIZES) {
      canvas.width = size
      canvas.height = size
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size)
      for (const quality of [0.82, 0.68, 0.54]) {
        const blob = await canvasToBlob(canvas, quality)
        if (blob && blob.size <= MAX_AVATAR_IMAGE_BYTES) return readAsDataURL(blob)
        // Canvas 回退 PNG 时 quality 无效，直接缩小尺寸后再试。
        if (blob?.type === 'image/png') break
      }
    }
    throw new Error('图片压缩后仍过大，请换一张图片')
  } finally {
    URL.revokeObjectURL(sourceURL)
  }
}

/** AVATAR_COLORS 颜色名（屏幕阅读器可读，避免直接读 hex 字符串） */
const COLOR_NAMES: Record<string, string> = {
  '#a855f7': '紫色',
  '#ec4899': '粉色',
  '#3b82f6': '蓝色',
  '#06b6d4': '青色',
  '#10b981': '绿色',
  '#f59e0b': '橙色',
  '#ef4444': '红色',
  '#8b5cf6': '紫色',
  '#6366f1': '蓝紫色',
}

function colorName(hex: string): string {
  return COLOR_NAMES[hex.toLowerCase()] || hex
}

/**
 * 头像选择器 -- 从 AvatarModal 提取（去 Dialog 外壳），供 SettingsDialog 右内容区
 * Master-Detail 切换渲染。自包含 useUpdateAvatar，提交成功 onDone 返回 section。
 *
 * 返回/取消由 SettingsDialog 子视图头部统一处理，本组件只管选择 + 提交。
 */
export function AvatarPicker({
  currentAvatar,
  currentColor,
  currentAvatarImage,
  onDone,
}: {
  currentAvatar: string
  currentColor: string
  currentAvatarImage?: string
  onDone: () => void
}) {
  const updateAvatar = useUpdateAvatar()
  const initial = parseCurrentAvatar(currentAvatar)
  const [icon, setIcon] = useState(initial.icon)
  const [color, setColor] = useState(currentColor)
  const [isCustom, setIsCustom] = useState(initial.isCustom)
  const [customImage, setCustomImage] = useState(currentAvatarImage || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const PreviewIcon = resolveAvatarIcon(icon)
  const previewUrl = customImage || getCustomAvatarUrl(currentAvatar) || undefined

  const handleImageUpload = async (file?: File) => {
    if (!file || saving) return
    setError('')
    try {
      setCustomImage(await compressAvatarImage(file))
      setIsCustom(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleConfirm = async () => {
    if (saving) return
    setError('')
    setSaving(true)
    try {
      await updateAvatar.mutateAsync({
        avatar: isCustom && customImage ? UPLOADED_AVATAR_KEY : isCustom ? currentAvatar : icon || 'fa-piggy-bank',
        avatarColor: color || '#f59e0b',
        avatarImage: isCustom && customImage ? customImage : undefined,
      })
      toast.success('头像已更新')
      onDone()
    } catch (e) {
      // 失败不返回，让用户修改后重试
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn(SECTION_CLASS, 'gap-4', 'items-center')}>
      {/* 预览 */}
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center transition-colors overflow-hidden"
        style={isCustom ? undefined : { background: color }}
      >
        {isCustom ? (
          <img src={previewUrl} alt="头像" className="w-full h-full object-cover" width={64} height={64} />
        ) : (
          PreviewIcon && <PreviewIcon size={28} className="text-white" />
        )}
      </div>

      {/* 自定义头像上传：只在设置弹窗加载时本地压缩，不进入首屏路径 */}
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="text-[0.65rem] font-semibold text-(--text-muted) tracking-[0.5px]">自定义</div>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            void handleImageUpload(event.target.files?.[0])
            event.target.value = ''
          }}
          disabled={saving}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => uploadInputRef.current?.click()} disabled={saving}>
          <ImageUp size={14} />
          上传图片
        </Button>
        <p className="text-xs text-(--text-muted)">支持 JPG、PNG、WebP，最大 5 MB</p>
      </div>

      {/* 色板 -- 仅图标模式可用 */}
      {!isCustom && (
        <div className="flex flex-wrap justify-center gap-2">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                'w-7 h-7 rounded-full border-2 cursor-pointer transition-all hover:scale-110',
                color.toLowerCase() === c.toLowerCase()
                  ? 'border-white shadow-[0_0_0_2px_currentColor]'
                  : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              aria-label={colorName(c)}
              disabled={saving}
            />
          ))}
        </div>
      )}

      {/* 图标网格 -- 点击任意图标切回图标模式 */}
      <div className="w-full max-h-[220px] overflow-y-auto flex flex-col gap-3">
        {AVATAR_ICON_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-center gap-2 w-full">
              <div className="w-10 h-px" style={{ background: 'linear-gradient(to right, transparent, var(--border))' }} />
              <span className="text-[0.65rem] font-semibold text-(--text-muted) tracking-[0.5px] whitespace-nowrap">
                {group.title}
              </span>
              <div className="w-10 h-px" style={{ background: 'linear-gradient(to left, transparent, var(--border))' }} />
            </div>
            <div className="grid gap-2 p-1 justify-center" style={{ gridTemplateColumns: 'repeat(auto-fit, 44px)' }}>
              {group.icons.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'flex items-center justify-center w-11 h-11 rounded-xl border border-(--border) p-0 cursor-pointer transition-all duration-150 bg-(--bg-secondary) text-(--text-secondary) hover:border-(--accent) hover:scale-108',
                    !isCustom && icon === key && '!border-current',
                  )}
                  style={!isCustom && icon === key ? { background: color + '22', color } : undefined}
              onClick={() => { setIsCustom(false); setCustomImage(''); setIcon(key) }}
                  title={key}
                  disabled={saving}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-xs text-(--destructive) text-center">{error}</p>
      )}

      <Button onClick={handleConfirm} disabled={saving} className="self-end">
        {saving ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            保存中…
          </>
        ) : (
          '保存'
        )}
      </Button>
    </div>
  )
}
