# 首次部署指南

面向「AI agent / 运维脚本执行」的完整首次部署 runbook：从 GitHub Releases 下载预编译包，配置 systemd 常驻与 nginx 反向代理（含 WebSocket），最后逐项验证。每步都给出命令与预期输出，按顺序执行即可。

> 升级已有安装见 [README「升级到新版本」](../README.md#升级到新版本)；全部环境变量见 [README 配置表](../README.md#配置)。

## 前置条件

- 一台 linux/amd64 VPS（512 MB 内存即可），能以 root 执行命令
- 一个已解析到该 VPS 的域名（TLS 用）
- 80 / 443 留给 nginx；8080 本机空闲（Lumen 监听）

## 1. 下载并解压

```bash
mkdir -p /opt/lumen
curl -fsSL https://github.com/zeno528/lumen/releases/latest/download/lumen-linux-amd64.tar.gz | tar -xz -C /opt/lumen
ls /opt/lumen
# 预期: lumen  static/
```

## 2. 写配置文件 `/opt/lumen/.env`

```bash
openssl rand -hex 32   # 先执行一次，把输出填进下方 JWT_SECRET
```

```bash
cat > /opt/lumen/.env <<'EOF'
APP_ENV=production
JWT_SECRET=<替换为上面 openssl 生成的值>
APP_PASSWORD=<替换为你的登录密码>
TRUSTED_PROXY_CIDR=127.0.0.1/32
EOF
chmod 600 /opt/lumen/.env
```

说明：

- `JWT_SECRET` 同时派生 AES 密钥加密设置页保存的 AI / Serper 密钥，**首次确定后不可更改**（改了等于换主钥匙，已保存的密钥全部失效）
- `TRUSTED_PROXY_CIDR=127.0.0.1/32` 声明本机 nginx 为可信代理（必须带 `/32`，裸 IP 会被 CIDR 解析静默跳过），保证限速与客户端 IP 判断正确
- `APP_PASSWORD` 仅在数据库为空的首次启动用于初始化登录密码，之后可在设置中心修改
- 生产模式（`APP_ENV` 非 `development`）下 `JWT_SECRET` 缺失或为默认值、`APP_PASSWORD` 为空会**拒绝启动**（fail-closed）

## 3. systemd 常驻

```ini
# /etc/systemd/system/lumen.service
[Unit]
Description=Lumen
After=network.target

[Service]
WorkingDirectory=/opt/lumen
EnvironmentFile=/opt/lumen/.env
ExecStart=/opt/lumen/lumen
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now lumen
```

## 4. 本机健康检查（先于 nginx）

```bash
curl -fsS http://127.0.0.1:8080/api/health
# 预期: {"openapi":"/openapi.json","status":"ok","version":"x.y.z"}
# 失败排查: journalctl -u lumen -n 30 --no-pager
```

## 5. nginx 反向代理（含 WebSocket）

```nginx
# /etc/nginx/sites-available/lumen （Debian/Ubuntu；CentOS/RHEL 放 /etc/nginx/conf.d/lumen.conf）
server {
    listen 80;
    server_name your.domain;   # 替换为你的域名

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        client_max_body_size 20m;   # JSON 备份导入可能超过 nginx 默认 1m
    }
}
```

```bash
ln -s /etc/nginx/sites-available/lumen /etc/nginx/sites-enabled/lumen
nginx -t && systemctl reload nginx
```

TLS 用 certbot 一条命令补齐（自动改写 server 块加 443 并配置自动续期）：

```bash
apt install -y certbot python3-certbot-nginx   # 已装可跳过
certbot --nginx -d your.domain
```

## 6. 端到端验证

```bash
# HTTPS 健康检查
curl -fsS https://your.domain/api/health

# WebSocket 升级路径（多端实时同步依赖，必须验证）
curl -s -o /dev/null -w "%{http_code}\n" --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://your.domain/api/ws
# 401 或 101 = nginx 正确转发 upgrade；426 等 = 漏配 WS，回查第 5 步两行 proxy_set_header
```

浏览器打开 `https://your.domain`，用 `APP_PASSWORD` 登录，添加一条书签确认保存正常。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 服务起不来 | `journalctl -u lumen -n 30 --no-pager`；生产下最常见是 `JWT_SECRET` 缺失/为默认值（fail-closed 拒绝启动） |
| `/api/ws` 返回 426 | nginx 漏配 `Upgrade` / `Connection "upgrade"` 两行头，多端实时同步会失效 |
| 导入备份返回 413 | nginx `client_max_body_size` 太小，调大后 reload |
| 日志里出现限速误伤 / 客户端 IP 全是 127.0.0.1 | `TRUSTED_PROXY_CIDR` 未设或格式不对（需 CIDR 如 `127.0.0.1/32`，逗号分隔可多值） |
