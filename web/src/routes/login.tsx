import { createFileRoute } from '@tanstack/react-router'

// 登录页组件与专属样式在 login.lazy.tsx 中按路由加载，书签首屏无需下载。
export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Lumen · 登录' }] }),
})
