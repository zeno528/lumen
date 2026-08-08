import { createFileRoute } from '@tanstack/react-router'

// 帮助页路由配置：只保留 head（title meta），component 拆到 help.lazy.tsx 懒加载，
// 避免帮助页（用户偶尔用）的 12 个 section + 14 个 lucide 图标进首屏 bundle 劣化 LCP。
// createLazyFileRoute 不支持 head，所以 head 留这里（同步，体积可忽略）。
export const Route = createFileRoute('/_authed/help')({
  head: () => ({ meta: [{ title: 'Lumen · 使用指南' }] }),
})
