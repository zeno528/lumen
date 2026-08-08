import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

// 模块增强：让 useNavigate / Link 等获得全项目路由类型
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
