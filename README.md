# Lumen

<p align="left">
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Go-1.26-00ADD8?style=flat&logo=go&logoColor=white" alt="Go" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/React-19-20232A?style=flat&logo=react&logoColor=61DAFB" alt="React" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/TypeScript-7.x-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat&logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" /></a>
  <a href="https://github.com/zeno528/lumen"><img src="https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite" /></a>
  <a href="https://github.com/zeno528/lumen/actions/workflows/deploy.yml"><img src="https://github.com/zeno528/lumen/actions/workflows/deploy.yml/badge.svg?branch=main" alt="CI" /></a>
</p>

> 保存链接，AI 帮你补全；随时用搜索和 API 找回它。

**Lumen 是一个自托管的 AI 书签工作台**，支持多模型接入、API Token、实时同步与本地数据存储。它不替你决定收藏什么，而是让每一条链接在需要时都能被快速找到和使用。

## 预览

<p>
  <img width="49%" alt="Lumen 浅色主题书签列表" src="docs/images/lumen-light.png" />
  <img width="49%" alt="Lumen 深色主题书签列表" src="docs/images/lumen-dark.png" />
</p>

## 用 Lumen 做什么

| 你的需求 | Lumen 如何完成 |
| --- | --- |
| **快速收集** | 粘贴网址即可新建书签；可自动获取标题、描述和网站图标，并识别重复链接。 |
| **清晰而轻量的图标** | 不只抓网站 favicon：先从两套品牌 SVG 图标库匹配域名及主域，优先拿到清晰的矢量图标；未命中再读取站点声明与常见路径，并由 6 个图标源并发兜底。大图会压到 64 × 64 后随书签保存，列表无需反复请求，清晰也轻量。 |
| **整理而不堆积** | 用分类、标签和收藏组织内容，支持拖拽排序、批量移动、批量加标签和批量删除。 |
| **更快找回** | 支持标题、网址和 ID 搜索；分类、收藏与未分类视图让常用内容始终可达。 |
| **让 AI 做整理工作** | 根据网址智能补全标题、描述、分类和标签；配置多个模型后可随时测试、切换和复用。 |
| **接入自己的工作流** | 创建 API Token，通过 Bearer 认证调用书签、分类与 AI 配置接口；内置受认证保护的 OpenAPI 说明。 |
| **掌控自己的数据** | 数据存于 SQLite，支持 JSON 导入导出；浏览器标签页与设备间通过 WebSocket 同步更新。 |

## AI，不绑定单一模型

Lumen 预置 **DeepSeek、智谱 GLM、MiniMax、硅基流动与 Anthropic**，也支持填写兼容 OpenAI 或 Anthropic 格式的自定义服务地址。一个 Provider 可保存多份模型配置，顶栏可快速切换当前模型。

AI 用于补全书签元数据，而不是替代你的收藏判断：输入网址后，可让它生成标题、描述、分类和标签。可选的 Serper 配置可在直连抓取失败时作为搜索兜底。

## API 与自动化

- 在设置中创建 `msk_` API Token；明文只在创建时显示一次。
- 使用 `Authorization: Bearer <API_TOKEN>` 访问受支持的接口。
- `/openapi.json` 提供 OpenAPI 3.0 描述，需要 JWT 或 API Token 认证。
- Token 的创建、改名、撤销仅允许账号 JWT 执行，避免 API Token 自行扩大权限。

## 快速开始

### 前置条件

- Go 1.26
- Node.js 24（与 CI 一致）
- pnpm 11
- [Air](https://github.com/air-verse/air)（Go 开发热重载）

```bash
git clone https://github.com/zeno528/lumen.git
cd lumen

# 仅首次安装 Air
go install github.com/air-verse/air@latest

# 创建本地开发配置
cp .env.example .env.dev

# 安装依赖并同时启动 Go 后端与 Vite 前端
pnpm -C web install
pnpm -C web dev
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env.dev
```

打开 [http://localhost:5173](http://localhost:5173)。首次启动时，`.env.dev` 中的 `APP_PASSWORD` 会初始化登录密码；请先替换成自己的开发密码。

## 部署要求

Lumen 是 **单一 Go 二进制 + 静态前端 + SQLite**：构建后只需部署 `lumen` 二进制和 `static/` 目录，不依赖 Docker、Node.js、外部数据库或本地大模型运行时。

**512 MB 内存、1 vCPU 的小型 服务器即可运行。** 在实际生产节点的空闲采样中，Lumen 进程 RSS 约 **19 MiB**；AI 请求由你配置的远程 Provider 执行，服务器只处理书签 API、SQLite、静态文件和 WebSocket 同步。

> 以上是实际运行参考；书签量、Favicon 数据、并发访问和保留的部署副本会增加磁盘与内存占用。

## 生产部署

先构建前端与后端：

```bash
pnpm -C web build
go build -o lumen ./server
```

将 `web/dist` 的内容放入 `STATIC_DIR` 指向的目录（默认 `./static`），然后以 `APP_ENV=production` 启动 `lumen`。生产环境必须配置长期稳定且非默认的 `JWT_SECRET` 与强 `APP_PASSWORD`；`JWT_SECRET` 同时用于加密已保存的 AI / 搜索服务密钥，部署后不要随意更换。

仓库已配置 GitHub Actions：推送到 `main` 会依次执行前端类型检查、前端构建、Go 检查与测试，再部署。部署前需要在仓库 Secrets 中配置 `DEPLOY_SERVERS` 和 `VPS_SSH_KEY`。

## 配置与安全

从 [`.env.example`](.env.example) 复制出 `.env.dev` 作为本地配置。常用变量如下：

| 变量 | 说明 |
| --- | --- |
| `APP_ENV` | `development` 或 `production`；未设置时按生产环境严格校验。 |
| `PORT` | 后端端口；本地开发使用 `8081`。 |
| `DB_PATH` | SQLite 数据库文件路径。 |
| `STATIC_DIR` | 构建后的前端静态文件目录；默认 `./static`。 |
| `JWT_SECRET` | JWT 签名与敏感配置加密密钥；生产环境必须替换默认值。 |
| `APP_PASSWORD` | 空数据库首次启动时的初始登录密码。 |
| `TRUSTED_PROXY_CIDR` | 可信反向代理 CIDR；未设置时不信任 `X-Forwarded-For`。 |

> 请勿提交 `.env.dev`、数据库、日志或 API 密钥。它们已被 `.gitignore` 排除，但提交前仍应检查差异。

## 开发验证

```bash
pnpm -C web typecheck
pnpm -C web build
go vet ./...
go test ./...
```

## 项目结构

```text
server/        Go API、SQLite、鉴权、OpenAPI 与 WebSocket
web/           React 前端与响应式界面
docs/images/   README 效果图
.github/       CI 与部署工作流
```

## 参与贡献

欢迎通过 Issue 反馈问题或提出功能想法；准备提交较大改动前，建议先说明使用场景和预期行为，方便一起确认方向。

## 许可证

Lumen 以 [MIT License](LICENSE) 开源。