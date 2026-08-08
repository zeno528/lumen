import {
  Folder,
  Star,
  Heart,
  Bookmark,
  Tag,
  Link as LinkIcon,
  Bot,
  Brain,
  Code,
  Terminal,
  Cpu,
  Database,
  GitBranch,
  Bug,
  Globe,
  Cloud,
  Server,
  Wifi,
  SatelliteDish,
  Share2,
  Shield,
  Lock,
  Mail,
  MessageCircle,
  Bell,
  Send,
  Briefcase,
  GraduationCap,
  TrendingUp,
  ListChecks,
  Book,
  FlaskConical,
  Gamepad2,
  Music,
  Camera,
  ShoppingCart,
  CreditCard,
  Coffee,
  Palette,
  Atom,
  Apple,
  type LucideIcon,
} from 'lucide-react'

/**
 * 分类图标存的是 Font Awesome 类名（fa-xxx / fab fa-xxx）。
 * 此表运行时映射到 Lucide 组件，无需数据迁移、后端零改动。
 * Lucide 已移除商标图标（github/docker 等），品牌分类用近似通用图标。
 */
const FA_TO_LUCIDE: Record<string, LucideIcon> = {
  // 常用
  'fa-folder': Folder,
  'fa-star': Star,
  'fa-heart': Heart,
  'fa-bookmark': Bookmark,
  'fa-tag': Tag,
  'fa-link': LinkIcon,
  // AI & 编程
  'fa-robot': Bot,
  'fa-brain': Brain,
  'fa-code': Code,
  'fa-terminal': Terminal,
  'fa-microchip': Cpu,
  'fa-database': Database,
  'fa-code-branch': GitBranch,
  'fa-bug': Bug,
  // 网络 & 科技
  'fa-globe': Globe,
  'fa-cloud': Cloud,
  'fa-server': Server,
  'fa-wifi': Wifi,
  'fa-satellite-dish': SatelliteDish,
  'fa-network-wired': Share2,
  'fa-shield-alt': Shield,
  'fa-lock': Lock,
  // 品牌（商标图标已从 Lucide 移除，用近似通用替代）
  'fab fa-github': Code,
  'fab fa-chrome': Globe,
  'fab fa-docker': Database,
  'fab fa-python': Code,
  'fab fa-js': Code,
  'fab fa-react': Atom,
  'fab fa-linux': Terminal,
  'fab fa-apple': Apple,
  // 社交 & 通讯
  'fab fa-weixin': MessageCircle,
  'fab fa-qq': MessageCircle,
  'fab fa-discord': MessageCircle,
  'fab fa-telegram': Send,
  'fa-envelope': Mail,
  'fa-comment': MessageCircle,
  'fa-bell': Bell,
  // 工作 & 学习
  'fa-briefcase': Briefcase,
  'fa-graduation-cap': GraduationCap,
  'fa-chart-line': TrendingUp,
  'fa-tasks': ListChecks,
  'fa-book': Book,
  'fa-flask': FlaskConical,
  // 生活 & 其他
  'fa-gamepad': Gamepad2,
  'fa-music': Music,
  'fa-camera': Camera,
  'fa-shopping-cart': ShoppingCart,
  'fa-credit-card': CreditCard,
  'fa-coffee': Coffee,
  'fa-palette': Palette,
}

/** 把后端存的 FA 类名解析成 Lucide 图标组件，未命中兜底 Folder */
export function resolveCategoryIcon(raw?: string | null): LucideIcon {
  if (!raw) return Folder
  return FA_TO_LUCIDE[raw] ?? FA_TO_LUCIDE[raw.toLowerCase()] ?? Folder
}

/** 图标选择器用：旧 iconGroups 结构（Lucide 化），供分类新建/编辑选择 */
export const ICON_GROUPS: { title: string; icons: { key: string; Icon: LucideIcon }[] }[] = [
  {
    title: '常用',
    icons: [
      { key: 'fa-folder', Icon: Folder },
      { key: 'fa-star', Icon: Star },
      { key: 'fa-heart', Icon: Heart },
      { key: 'fa-bookmark', Icon: Bookmark },
      { key: 'fa-tag', Icon: Tag },
      { key: 'fa-link', Icon: LinkIcon },
    ],
  },
  {
    title: 'AI & 编程',
    icons: [
      { key: 'fa-robot', Icon: Bot },
      { key: 'fa-brain', Icon: Brain },
      { key: 'fa-code', Icon: Code },
      { key: 'fa-terminal', Icon: Terminal },
      { key: 'fa-microchip', Icon: Cpu },
      { key: 'fa-database', Icon: Database },
      { key: 'fa-code-branch', Icon: GitBranch },
      { key: 'fa-bug', Icon: Bug },
    ],
  },
  {
    title: '网络 & 科技',
    icons: [
      { key: 'fa-globe', Icon: Globe },
      { key: 'fa-cloud', Icon: Cloud },
      { key: 'fa-server', Icon: Server },
      { key: 'fa-wifi', Icon: Wifi },
      { key: 'fa-satellite-dish', Icon: SatelliteDish },
      { key: 'fa-network-wired', Icon: Share2 },
      { key: 'fa-shield-alt', Icon: Shield },
      { key: 'fa-lock', Icon: Lock },
    ],
  },
  {
    title: '工作 & 学习',
    icons: [
      { key: 'fa-briefcase', Icon: Briefcase },
      { key: 'fa-graduation-cap', Icon: GraduationCap },
      { key: 'fa-chart-line', Icon: TrendingUp },
      { key: 'fa-tasks', Icon: ListChecks },
      { key: 'fa-book', Icon: Book },
      { key: 'fa-flask', Icon: FlaskConical },
    ],
  },
  {
    title: '生活 & 其他',
    icons: [
      { key: 'fa-gamepad', Icon: Gamepad2 },
      { key: 'fa-music', Icon: Music },
      { key: 'fa-camera', Icon: Camera },
      { key: 'fa-shopping-cart', Icon: ShoppingCart },
      { key: 'fa-credit-card', Icon: CreditCard },
      { key: 'fa-coffee', Icon: Coffee },
      { key: 'fa-palette', Icon: Palette },
    ],
  },
]

export const PRESET_COLORS = [
  '#EF4444',
  '#F97316',
  '#F59E0B',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
]
