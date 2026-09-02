/// <reference types="vite/client" />

// 构建时由 vite.config define 注入（真值源 = web/package.json version）
declare const __APP_VERSION__: string

// CSS side-effect 包无类型声明（noUncheckedSideEffectImports 兼容）
declare module '@fontsource-variable/inter'
