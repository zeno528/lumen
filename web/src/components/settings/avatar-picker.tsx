import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUpdateAvatar } from '@/hooks/use-avatar'
import {
  AVATAR_COLORS,
  AVATAR_ICON_GROUPS,
  resolveAvatarIcon,
  CUSTOM_AVATAR_KEY,
  CUSTOM_AVATAR_FILES,
  isCustomAvatar,
} from '@/lib/avatar-icons'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { SECTION_CLASS } from './section-styles'

function parseCurrentAvatar(currentAvatar: string): { isCustom: boolean; icon: string; customFile: string } {
  if (isCustomAvatar(currentAvatar)) {
    const file = currentAvatar === CUSTOM_AVATAR_KEY
      ? CUSTOM_AVATAR_FILES[0]
      : currentAvatar.slice(CUSTOM_AVATAR_KEY.length + 1)
    return { isCustom: true, icon: 'fa-piggy-bank', customFile: file || CUSTOM_AVATAR_FILES[0] }
  }
  return { isCustom: false, icon: currentAvatar || 'fa-piggy-bank', customFile: CUSTOM_AVATAR_FILES[0] }
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
  onDone,
}: {
  currentAvatar: string
  currentColor: string
  onDone: () => void
}) {
  const updateAvatar = useUpdateAvatar()
  const initial = parseCurrentAvatar(currentAvatar)
  const [icon, setIcon] = useState(initial.icon)
  const [color, setColor] = useState(currentColor)
  const [isCustom, setIsCustom] = useState(initial.isCustom)
  const [customFile, setCustomFile] = useState(initial.customFile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const PreviewIcon = resolveAvatarIcon(icon)
  const previewUrl = `/avatars/${customFile}`

  const handleConfirm = async () => {
    if (saving) return
    setError('')
    setSaving(true)
    try {
      await updateAvatar.mutateAsync({
        avatar: isCustom ? `${CUSTOM_AVATAR_KEY}:${customFile}` : icon || 'fa-piggy-bank',
        avatarColor: color || '#f59e0b',
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

      {/* 自定义头像选项 */}
      <div className="flex flex-col items-center gap-2 w-full">
        <div className="text-[0.65rem] font-semibold text-(--text-muted) tracking-[0.5px]">自定义</div>
        <div className="flex flex-wrap justify-center gap-2">
          {CUSTOM_AVATAR_FILES.map((file) => (
            <button
              key={file}
              type="button"
              className={cn(
                'w-11 h-11 rounded-xl border p-0 cursor-pointer transition-all overflow-hidden bg-(--bg-secondary)',
                isCustom && customFile === file
                  ? 'border-(--accent) ring-2 ring-(--accent)'
                  : 'border-(--border) hover:border-(--accent)',
              )}
              onClick={() => { setIsCustom(true); setCustomFile(file) }}
              title={file}
              aria-label={`自定义头像 ${file}`}
              disabled={saving}
            >
              <img src={`/avatars/${file}`} alt={file} className="w-full h-full object-cover" width={44} height={44} />
            </button>
          ))}
        </div>
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
                  onClick={() => { setIsCustom(false); setIcon(key) }}
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
          '确认'
        )}
      </Button>
    </div>
  )
}
