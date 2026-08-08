# Favicon 写入规范（外部 Agent API）

> 给外部 agent（如 Claude Code、脚本等）用 **API Token 认证**抓取网站图标并写入 Lumen 数据库的接口规范。照此文档操作即可，无需读源码。

## 1. 认证：API Token

项目同时支持 JWT（浏览器登录）和 API Token（程序调用），agent 走 Token 通道。

- **格式**：`msk_` 前缀（例 `msk_3f8a9b2c1d...`）
- **用法**：HTTP header
  ```
  Authorization: Bearer msk_xxxxx
  ```
- 中间件识别 `msk_` 前缀走 token 通道，SHA-256 哈希比对 `api_tokens` 表（[middleware.go AuthMiddleware](../server/middleware.go)）。

### 创建 Token（明文仅返回一次）

```
POST /api/tokens
Authorization: Bearer <JWT>      # 创建 token 需用浏览器登录的 JWT，不能用 token 创建 token
Content-Type: application/json

{"name":"图标抓取 agent"}
```

响应：
```json
{ "token": "msk_xxxxxxxxx...", ... }
```

⚠️ **明文 token 仅此一次返回**，立刻保存。DB 只存 SHA-256 哈希，丢失后只能重建。

- 管理：`GET /api/tokens` 列表 / `DELETE /api/tokens/{id}` 删除

---

## 2. 推荐工作流

```
[1] agent 调  GET /api/favicon?url=https://<域名>      (带 Bearer token)
         │  后端多阶段降级抓取（见 §3）
         ↓  返回图片字节流（Content-Type: image/* 或 image/svg+xml）
[2] agent 把字节转成 dataURI（≤64KB，建议 64×64 压缩 + 空白过滤）
         ↓
[3] agent 调  PUT /api/bookmarks/{id}   body {"favicon":"<dataURI>"}   (带 Bearer token)
         │  后端直接存 dataURI，updated_at 自动刷新
         ↓
[4] 前端 ?v=updatedAt 缓存自动失效，新图标立即生效（agent 无需管前端缓存）
```

**核心**：agent 自己转 dataURI 写入最干净。也可偷懒传 http URL 让后端转（见陷阱 §6）。

---

## 3. 图标源与降级优先级（GET /api/favicon 内部机制）

后端 `GET /api/favicon` 的抓取链路（[utils.go handleFavicon](../server/utils.go)）：**多阶段降级 + 主域名回退 + 第三方并发兜底**，命中即停。

### 3.1 图标源清单

| 阶段 | 源 | URL | 需 key | 说明 |
|:---|:---|:---|:---|:---|
| 0a | **theSVG（首选）** | `https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/{slug}/default.svg` | 否 | 6,419+ 品牌 SVG，registry 精准域名映射（`npmjs.com` -> `npm`） |
| 0b | Simple Icons（备选） | `https://cdn.simpleicons.org/{slug}` | 否 | ~3,000+ 品牌 SVG，theSVG miss 时兜底 |
| 1 | 目标站 `<link>` 解析 | 目标站自身 | 否 | 直连目标页 HTML，按优先级解析 `<link>` 标签 |
| 2 | 目标站常见路径 | 目标站自身 | 否 | `/favicon.ico` 等 5 个常见路径逐个试 |
| 3 | Google S2 | `https://www.google.com/s2/favicons?domain={d}&sz=64` | 否 | 业内覆盖率最高，限流未公开 |
| 3 | DuckDuckGo | `https://icons.duckduckgo.com/ip3/{d}.ico` | 否 | 隐私优先，限流未公开 |
| 3 | favicone.com | `https://favicone.com/{d}?s=64` | 否 | 第三方 favicon 服务，64px |
| 3 | favicon.im | `https://favicon.im/{d}` | 否 | Cloudflare 边缘缓存，24h |
| 3 | icon.horse | `https://icon.horse/icon/{d}` | 否 | 第三方 favicon 服务 |

> 所有源**均无需 API key**，走匿名免费额度。第三方服务限流未公开，仅作兜底 + 依赖超时和缓存，不大规模裸依赖。

### 3.2 降级优先级（命中即停）

```
[1] 原始域名精确获取  tryFetchExact(原始 target)
     ├─ 阶段0a: theSVG（首选，registry 精准映射 npmjs.com -> npm）
     ├─ 阶段0b: Simple Icons（备选，slug 推导兜底）
     ├─ 阶段1: 直连目标页解析 <link> 标签
     └─ 阶段2: 常见路径 /favicon.ico 等
            ↓ 全失败
[2] 主域名回退  stripSubdomain（如 my.feishu.cn -> feishu.cn）
     └─ tryFetchExact(主域名) 重跑阶段0a/0b/1/2
            ↓ 全失败
[3] 原始域名第三方并发兜底  tryFetchThirdParty(原始)
     5 家并发，取首个成功（6s 总超时，cancel 其余）
     ├─ Google S2
     ├─ DuckDuckGo
     ├─ favicone.com
     ├─ favicon.im
     └─ icon.horse
            ↓ 全失败
[4] 主域名第三方兜底  tryFetchThirdParty(主域名)
     └─ 5 家并发重试
            ↓ 全失败
[5] 404（图标未找到）
```

### 3.3 `<link>` 标签解析优先级（阶段 1 内部）

解析目标页 HTML 的 `<link>` 标签，按以下顺序取首个：

1. `<link rel="icon" type="image/svg+xml">` -- **矢量优先**
2. `<link rel="icon">` -- 任意 type
3. `<link rel="shortcut icon">`
4. `<link rel="apple-touch-icon">` -- 高分辨率兜底

### 3.4 常见路径尝试顺序（阶段 2 内部）

依次尝试目标站以下路径（要求 200 + `Content-Type: image/*`）：

1. `/favicon.ico`
2. `/favicon.svg`
3. `/apple-touch-icon.png`
4. `/assets/favicon.ico`
5. `/static/favicon.ico`

### 3.5 主域名回退规则（stripSubdomain）

- 3 段及以上才剥：`my.feishu.cn` -> `feishu.cn`
- 双段后缀（`.co.uk` / `.com.cn`）倒数第二段 ≤3 字符则保留：`xxx.feishu.cn` -> `feishu.cn`，但 `feishu.cn` 本身不剥
- 单级域名原样返回

### 3.6 超时与并发

- 阶段 0/1/2：`httpClient` 单请求 **10s 超时**，顺序执行
- 阶段 3 第三方：**5 家并发**，`context` **6s 总超时**，取首个成功即返回（cancel 其余 + 异步关闭连接防泄漏）
- 整个请求受 chi 中间件 **30s 总超时**兜底（[main.go](../server/main.go)）
- 实际命中通常 <3s，失败场景由 6s 第三方超时控制

### 3.7 SSRF 防护

- 内网 IP 黑名单（`10/8`、`172.16/12`、`192.168/16`、`127/8`、`::1`、`fc00::/7`）拒绝抓取
- agent 调 `/api/favicon?url=` 时后端按 hostname 抓取，已做防护，无法用于探测内网

### 3.8 域名 -> slug 精准映射（theSVG registry）

阶段 0a 用 theSVG registry 精准映射，解决"域名去 TLD 第一段"slug 推导不准的问题：

| 域名 | 旧 slug 推导 | 新链路（三级匹配） |
|:---|:---|:---|
| `npmjs.com` | `npmjs`（错，miss） | 域名映射 -> `npm` ✅ |
| `outlook.live.com` | `outlook`（错，theSVG slug 是 `microsoft-outlook`） | 品牌词索引 outlook -> `microsoft-outlook` ✅ |
| `github.com` | `github`（碰巧对） | `github`（一致） |

**机制**（[utils.go loadTheSvgRegistry](../server/utils.go) + `fetchTheSvg`）：启动时异步拉 `registry.json`，建两个索引，`fetchTheSvg` 三级匹配：

1. **域名映射** `map[域名]slug`（从 `url` 提取域名）：`npmjs.com` -> `npm`
2. **品牌词索引** `map[词]slug`（slug 按连字符拆词）：`outlook` -> `microsoft-outlook`（冲突时优先该词是 slug 最后词的，如 `microsoft-outlook` > `outlook-calendar`）-- 解决"品牌官网域名 ≠ 用户子域"（Outlook 官网 microsoft.com，用户访问 outlook.live.com，域名映射建不到）
3. 回退域名第一段直接作 slug

miss 后走 Simple Icons 备选 -> 阶段 1/2/3。加载失败/未就绪：索引为空，走 slug 推导 + Simple Icons，不影响现有链路。

**对书签习惯的针对性**（基于 163 条样本分析）：
- npm 包页面（`npmjs.com/package/...`）：域名映射精准命中 `npm`
- Outlook 等品牌子域（`outlook.live.com`）：品牌词索引命中 `microsoft-outlook`（官网 microsoft.com 与用户子域不同，靠词索引补）
- 知名品牌（GitHub/YouTube/Notion 等）：theSVG 全覆盖
- 自建服务（自有域名子域）：品牌库覆盖不到，靠阶段 1/2 直连抓子域自身 favicon
- 中国 AI 品牌（百炼/智谱/minimax）：theSVG/Simple Icons 多半没有，靠阶段 1/2/3 + 第三方兜底

---

## 4. 接口规范

| 接口 | 方法 | 鉴权 | 用途 | favicon 处理 |
|:---|:---|:---|:---|:---|
| `/api/favicon?url=` | GET | ✅ token | **抓图标字节** | 多阶段降级（见 §3），返回字节流 |
| `/api/bookmarks/{id}` | PUT | ✅ token | **写图标（推荐）** | dataURI 直接存；http URL 后端 `resolveFavicon` 下载转 dataURI |
| `/api/bookmarks` | POST | ✅ token | 创建书签带图标 | **直接存，不转 dataURI** |
| `/api/bookmarks/{id}/favicon?v=` | GET | ❌ 公开 | 读图标 | 按需取，1 年强缓存 |

### GET /api/favicon（抓图标）

```
GET /api/favicon?url=https://github.com
Authorization: Bearer msk_xxx
```

- `url` 参数：传 `https://<域名>`（后端按 hostname 抓取）
- 返回：`200` + 图片字节（`Content-Type: image/png` / `image/svg+xml` 等），或 `404`（全失败）

### PUT /api/bookmarks/{id}（写图标，推荐）

```
PUT /api/bookmarks/123
Authorization: Bearer msk_xxx
Content-Type: application/json

{"favicon":"data:image/png;base64,iVBORw0KGgo..."}
```

- **部分更新**：只传 `favicon` 字段即可，其他字段不传则保留原值
- 处理：
  - `data:` 开头 -> 直接存
  - `http` 开头 -> 后端 `resolveFavicon` 下载转 dataURI（10s 超时 + SSRF 防护）
  - 超 64KB -> 保留原值（不丢已有图标）
- 成功后 `updated_at = CURRENT_TIMESTAMP`，前端 `?v=updatedAt` 自动失效

---

## 5. favicon 字段格式约束

### dataURI 格式（强烈推荐）

| 类型 | 格式 | 示例 |
|:---|:---|:---|
| PNG/ICO/WEBP | base64 | `data:image/png;base64,iVBORw0KGgo...` |
| SVG | URL 编码（不要 base64，更小） | `data:image/svg+xml,%3Csvg...%3E` |

### 大小限制

- **≤ 65536 字节（64KB）**，超限不写入
- agent 应自己压缩：缩放到 64×64 PNG 通常 <10KB
- 列表 API 不返回 dataURI（`'' AS favicon`），DB 不会膨胀，可放心存

### 空白图标过滤

agent 端应过滤纯白/透明图标（避免存无意义图标）。参考检测：缩放后取像素平均亮度，>245 视为空白丢弃。

---

## 6. 必读陷阱

1. **创建书签(POST)传 http URL 不会转 dataURI**
   - `POST /api/bookmarks` 直接存原值，不调 `resolveFavicon`
   - 要存 dataURI：agent 自己转，或先 POST 创建再 PUT 更新

2. **更新书签(PUT)传 http URL 会触发后端下载**
   - 走 `resolveFavicon`，受 10s 超时 + SSRF 内网 IP 防护
   - 慢站/内网 URL 会失败，失败保留原值

3. **超 64KB 行为：创建清空 / 更新保留原值**
   - 所以 **用 PUT 更新更安全**（失败不丢原图标）

---

## 7. dataURI 转换参考（agent 实现参考前端 favicon.ts）

agent 把 `GET /api/favicon` 返回的字节转成 dataURI，可参考前端 [favicon.ts](../web/src/lib/favicon.ts) 的策略：

```
按 Content-Type 分流：
- SVG（<25600 字符）-> 'data:image/svg+xml,' + encodeURIComponent(svgText)
- 小图 <20KB        -> 'data:image/png;base64,' + base64(bytes)
- 大图 ≥20KB        -> canvas 缩放到 64×64 PNG + 空白检测（亮度>245 丢弃）
```

agent 用任意语言实现等价逻辑即可。关键：**输出 ≤64KB 的 dataURI**。

---

## 8. curl 示例

```bash
TOKEN="msk_xxxxx"
BASE="https://你的域名"

# [1] 抓图标字节
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/favicon?url=https://github.com" \
  -o icon.bin

# [2] agent 内部把 icon.bin 转成 dataURI（≤64KB），假设得到 $DATAURI

# [3] 写入书签 123 的图标
curl -X PUT "$BASE/api/bookmarks/123" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"favicon\":\"$DATAURI\"}"
```

---

## 9. 一句话总结

**`msk_` token 认证 -> 调 `GET /api/favicon` 抓字节 -> agent 转成 ≤64KB 的 dataURI -> `PUT /api/bookmarks/{id}` 写入（只传 favicon 字段）-> updated_at 自动刷新前端缓存。**

核心要点：
- 用 **PUT 更新**（不是 POST 创建）
- 传 **dataURI**（不是 http URL）
- **≤64KB**，过滤空白图标
