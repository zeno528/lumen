import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// 版本号真值源 = 本文件同级的 package.json "version"（全项目仅此一处），
// 构建时注入全局常量 __APP_VERSION__（头像菜单展示）。
// 递增命令：web/ 下 `pnpm version patch|minor|major` —— 只改这一个文件即全量生效。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// 插件顺序敏感：tanstackRouter 必须先于 react()（路由类型生成要先于编译）。
// React Compiler 经 @rolldown/plugin-babel + reactCompilerPreset 接入（plugin-react v6 不再用 react({babel})）。
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // ws:true 让 dev 的 ws://localhost:5173/api/ws 代理到 8081（与生产同源同路径）
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        ws: true,
      },
      '/openapi.json': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
        ws: true,
      },
      '/openapi.json': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
})
