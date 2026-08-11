import {
  Dog,
  PawPrint,
  Bone,
  Shield,
  PiggyBank,
  Cat,
  Bird,
  Beef,
  User,
  UserX,
  GraduationCap,
  Stethoscope,
  Bot,
  Cpu,
  Rocket,
  Gamepad2,
  Ghost,
  Wand2,
  Skull,
  type LucideIcon,
} from 'lucide-react'
import { isCustomAvatar } from './avatar-upload'

export { UPLOADED_AVATAR_KEY, isCustomAvatar, getCustomAvatarUrl } from './avatar-upload'

/**
 * 头像图标映射 -- Font Awesome 类名映射到 Lucide。
 * 分组和语义，未命中时兜底 Cat。
 */
const AVATAR_ICON_MAP: Record<string, LucideIcon> = {
  // 萌宠
  'fa-dog': Dog,
  'fa-paw': PawPrint,
  'fa-bone': Bone,
  'fa-shield-dog': Shield,
  'fa-piggy-bank': PiggyBank,
  'fa-shield-cat': Cat,
  'fa-hippo': Cat,
  'fa-kiwi-bird': Bird,
  'fa-cow': Beef,
  // 人物
  'fa-user': User,
  'fa-user-ninja': User,
  'fa-user-secret': UserX,
  'fa-user-graduate': GraduationCap,
  'fa-user-tie': User,
  'fa-user-doctor': Stethoscope,
  'fa-user-shield': Shield,
  // 科技
  'fa-robot': Bot,
  'fa-microchip': Cpu,
  'fa-rocket': Rocket,
  'fa-gamepad': Gamepad2,
  'fa-ghost': Ghost,
  'fa-hat-wizard': Wand2,
  'fa-skull': Skull,
}

export const AVATAR_COLORS = [
  '#8b5cf6',
  '#6366f1',
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
]

export const AVATAR_ICON_GROUPS: { title: string; icons: { key: string; Icon: LucideIcon }[] }[] =
  [
    {
      title: '萌宠',
      icons: [
        { key: 'fa-dog', Icon: Dog },
        { key: 'fa-paw', Icon: PawPrint },
        { key: 'fa-bone', Icon: Bone },
        { key: 'fa-piggy-bank', Icon: PiggyBank },
        { key: 'fa-shield-cat', Icon: Cat },
        { key: 'fa-kiwi-bird', Icon: Bird },
        { key: 'fa-cow', Icon: Beef },
      ],
    },
    {
      title: '人物',
      icons: [
        { key: 'fa-user', Icon: User },
        { key: 'fa-user-ninja', Icon: User },
        { key: 'fa-user-secret', Icon: UserX },
        { key: 'fa-user-graduate', Icon: GraduationCap },
        { key: 'fa-user-tie', Icon: User },
        { key: 'fa-user-doctor', Icon: Stethoscope },
        { key: 'fa-user-shield', Icon: Shield },
      ],
    },
    {
      title: '科技',
      icons: [
        { key: 'fa-robot', Icon: Bot },
        { key: 'fa-microchip', Icon: Cpu },
        { key: 'fa-rocket', Icon: Rocket },
        { key: 'fa-gamepad', Icon: Gamepad2 },
        { key: 'fa-ghost', Icon: Ghost },
        { key: 'fa-hat-wizard', Icon: Wand2 },
        { key: 'fa-skull', Icon: Skull },
      ],
    },
  ]

/** 把后端头像名解析成 Lucide 图标组件；自定义图片头像返回 null */
export function resolveAvatarIcon(raw?: string | null): LucideIcon | null {
  if (!raw || isCustomAvatar(raw)) return null
  return AVATAR_ICON_MAP[raw] ?? AVATAR_ICON_MAP[raw.toLowerCase()] ?? Cat
}
