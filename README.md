# Lumen

<p align="left">
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Go-1.26-00ADD8?style=flat&logo=go&logoColor=white" alt="Go" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/TypeScript-7.x-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/React-19-20232A?style=flat&logo=react&logoColor=61DAFB" alt="React" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat&logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite" /></a>
</p>
<p align="left">
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/TanStack_Router-1.x-FF4154?style=flat&logo=reactrouter&logoColor=white" alt="TanStack Router" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/TanStack_Query-5-FF4154?style=flat&logo=reactquery&logoColor=white" alt="TanStack Query" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Zustand-5-433E38?style=flat&logo=react&logoColor=white" alt="Zustand" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Radix_UI-1.x-161618?style=flat&logo=radixui&logoColor=white" alt="Radix UI" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/chi-5.2.1-0099E5?style=flat&logo=go&logoColor=white" alt="chi" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/WebSocket-1.8.15-FE6E36?style=flat&logo=websocket&logoColor=white" alt="coder/websocket" /></a>
</p>

## 项目结构

```
Lumen/
├── server/                       # Go 后端
│   ├── main.go                   # 入口
│   ├── config.go                 # 环境变量 / 配置载入(JWT fail-closed 校验)
│   ├── models.go                 # 数据模型
│   ├── auth.go                   # 登录 / 改密 / 账号 / 昵称 / 头像
│   ├── auth_github.go            # GitHub OAuth 登录
│   ├── bookmarks.go              # 书签 CRUD
│   ├── categories.go             # 分类 CRUD
│   ├── import_export.go          # 书签导入 / 导出
│   ├── ai.go / ai_settings.go    # AI 摘要与设置
│   ├── ai_provider_configs.go    # AI provider 配置
│   ├── serper.go                 # Serper 搜索集成
│   ├── crypto.go                 # AES-256-GCM + SHA-256 工具
│   ├── tokens.go                 # JWT 生成与校验(token hash)
│   ├── middleware.go             # 鉴权 / CORS / 限速
│   ├── ws_broadcast.go           # WS 广播
│   ├── utils.go                  # 通用辅助
│   ├── ws/                       # WebSocket hub / handler / client
│   ├── db/                       # SQLite 初始化 + migrations
│   ├── data/                     # SQLite 数据库文件(运行时生成,git ignored)
│   └── logs/                     # 运行日志(运行时生成,git ignored)
│
├── web/                          # React 前端
│   ├── src/
│   │   ├── api/                  # 统一 API 客户端 + 资源模块
│   │   ├── components/           # 业务组件(desktop / mobile / settings / shared / ui)
│   │   ├── hooks/                # TanStack Query 封装 + 通用 hooks
│   │   ├── routes/               # TanStack Router 路由(login / _authed)
│   │   ├── stores/               # Zustand 状态(auth / ui)
│   │   ├── styles/               # CSS(Tailwind v4 + token / layout / effects)
│   │   ├── lib/                  # 工具(cn、icon-map、URL、AI provider…)
│   │   ├── main.tsx              # 入口
│   │   └── routeTree.gen.ts      # 路由代码生成产物(@tanstack/router-plugin)
│   ├── public/                   # 静态资源(头像等)
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── docs/                         # 规范 / 设计文档
├── work/                         # 工作区草稿 / 演示页(非产品代码)
├── data/                         # 默认 SQLite 数据库目录(可被 DB_PATH 覆盖)
├── .github/workflows/            # CI(deploy.yml)
└── go.mod / go.sum
```

## 技术栈

**后端**
- Go 1.26
- `go-chi/chi` HTTP 路由
- `modernc.org/sqlite` 纯 Go SQLite(无 cgo)
- `golang-jwt/jwt` JWT 鉴权 + HttpOnly Cookie
- `coder/websocket` 实时同步
- `sha256("lumen-salt" + pwd)` 密码哈希
- `AES-256-GCM` 敏感字段加密(密钥从 `JWT_SECRET` 派生)
- 路由注册、鉴权、CORS、限速统一在 `middleware.go`

**前端**
- React 19 + TypeScript 7.x
- Vite 8
  - `@vitejs/plugin-react` v6(不再吃 `react({babel})`,编译通过 `reactCompilerPreset`)
  - `@rolldown/plugin-babel` + `babel-plugin-react-compiler` 1.0(自动 memo)
  - `@tanstack/router-plugin` 代码生成 `src/routeTree.gen.ts`(plugin 顺序:router 先于 react)
- TanStack Router + TanStack Query(`@tanstack/query-persist-client-core` 做本地缓存)
- Zustand 5(客户端状态 + 持久化)
- Tailwind CSS v4(`@tailwindcss/vite`),CSS token 走 `src/styles/theme.css` 双主题块
- Radix UI(`radix-ui`)原始包 + shadcn 风格组件 + Lucide 图标
- 主题切换走属性选择器 `[data-theme='notion-dark']`(自定义 dark 变体,不走 OS `prefers-color-scheme`)

**数据流**
- 服务端状态 → TanStack Query;客户端状态 → Zustand;组件通信 → props / context
- 渲染:`state → JSX → className`,无命令式 DOM
- 全局配置:`/api` 在 dev / preview 都代理到 `localhost:8081`,WS 走同源 `/api/ws`

## 环境变量

| 变量 | 说明 |
|:-----|:-----|
| `APP_ENV` | `development` / `production`。**缺失或非 `development` 一律按生产严格对待**。本地开发走 `.env.dev`(`.env.example` 为模板,air 自动加载) |
| `PORT` | 监听端口。开发固定 `8081`(Vite proxy 写死) |
| `DB_PATH` | SQLite 路径,默认 `data/bookmarks.db` |
| `JWT_SECRET` | JWT 签名密钥,**同时派生 AES 密钥加密 AI/Serper key,首次确定后不可改**。`development` 允许默认值;`production` 必须是强随机值,**默认/空值会拒绝启动** |
| `APP_PASSWORD` | 仅首次启动(DB 无 `password_hash`)初始化密码用一次。`development` 留空回退 `admin`;`production` **禁止空或 `admin`,否则拒绝启动**。已有密码的库忽略此项 |
| `TRUSTED_PROXY_CIDR` | 可信反代 CIDR,空 = 不信任 XFF(防伪造绕过限速) |

> 生产安全默认(fail-closed):未显式声明 `APP_ENV=development` 时,服务对危险默认值**拒绝启动** —— 默认 JWT_SECRET、空密码或 `admin` 初始化都会直接报错退出,避免带着公开仓库里人人可见的默认凭据上线。

## 重置密码

后端密码以 `SHA-256("lumen-salt" + password)` 形式存储在 SQLite 的 `settings` 表 `password_hash` 字段中;账号哈希存在 `username_hash`。如忘记密码,有两种重置方式:

### 方式一:有旧密码(推荐)

登录后在 `设置 → 账号 / 密码` 修改,或直接调 API:

```bash
curl -X PUT https://<host>/api/auth/password \
  -H "Content-Type: application/json" \
  -H "Cookie: token=<登录态>" \
  -d '{"currentPassword":"<旧密码>","newPassword":"<新密码>"}'
```

成功后服务端会**递增**内存里的 `token_version` 并写回数据库,所有旧 token 立即失效。

### 方式二:忘记密码 / 改密失败兜底

直接改 SQLite 数据库。数据库默认在 `./data/bookmarks.db`(`DB_PATH` 可改):

```bash
# 1) 停服
systemctl stop lumen       # 或 kill 掉 lumen-server 进程

# 2) 计算新密码哈希(SHA-256("lumen-salt" + 新密码)的 hex)
NEW_HASH=$(printf 'lumen-salt%s' '你的新密码' | sha256sum | awk '{print $1}')

# 3) 写入数据库
sqlite3 ./data/bookmarks.db <<SQL
INSERT INTO settings (key, value) VALUES ('password_hash', '$NEW_HASH')
ON CONFLICT(key) DO UPDATE SET value = '$NEW_HASH';
-- 顺手重置 token 版本,把所有旧登录态作废
INSERT INTO settings (key, value) VALUES ('token_version', '0')
ON CONFLICT(key) DO UPDATE SET value = '0';
SQL

# 4) 重新启动
systemctl start lumen
```

如果是首装、数据库里**还没有** `password_hash` 记录,用环境变量 `APP_PASSWORD=你的强密码` 启动一次即可初始化(由 `server/config.go` 读取)。**生产环境**(`APP_ENV=production` 或未设)下,`APP_PASSWORD` 留空或为 `admin` 会被**拒绝启动**,必须设强密码;`development` 留空则回退 `admin`。详见上方「环境变量」。

## 快捷键

注册点:`web/src/hooks/use-hotkeys.ts`,挂在 desktop `app-shell.tsx:118` 与 mobile `mobile-shell.tsx:70`。下表只列**全局 hotkey 系统注册**的 7 条快捷键;dialog/form 内的 `Enter` / `Esc` / `Tab` 不在本表。

> `meta` = `Ctrl`(Windows/Linux)或 `Cmd`(macOS)。`useHotkeys` 用 `e.ctrlKey || e.metaKey` 自动兼容。

| 快捷键 | 行为 | 备注 |
|:-------|:-----|:----|
| `Ctrl/Cmd + K` | 聚焦搜索框 | desktop / mobile 都生效 |
| `Ctrl/Cmd + I` | 打开新建书签 dialog | |
| `Ctrl/Cmd + Shift + I` | 打开新建分类 dialog | ⚠ 占用浏览器 DevTools,开发时改 F12 |
| `Ctrl/Cmd + B` | 切换书签批量模式 | 再按一次或 `Esc` 退出 |
| `Ctrl/Cmd + Shift + B` | 切换分类批量模式 | 再按一次或 `Esc` 退出 |
| `Ctrl/Cmd + Enter` | 保存当前 dialog | 根据打开的 dialog 类型自动派发 submit |
| `Esc` | 关闭 dialog → 退出批量 → 清空搜索 | 优先级:Dialog 自管 > 批量模式 > 搜索 |

### 未注册但常见的快捷键

- `Ctrl/Cmd + ,`(设置)─ 仅顶栏齿轮 / 头像菜单入口
- `Ctrl/Cmd + F`(查找)─ 仅清搜索,不接管浏览器原生查找
- `Ctrl/Cmd + D`(添加当前页书签)─ 未实现
- `Ctrl/Cmd + /`(快捷键面板)─ 仅侧栏 → 帮助页(`/help` 的"快捷键"章节)
