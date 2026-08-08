import { createFileRoute, redirect } from '@tanstack/react-router'

/** 根路径 → 重定向到书签页（受 _authed 守卫保护）*/
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/bookmarks' })
  },
})
