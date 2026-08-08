package ws

import (
	"encoding/json"
	"net/http"

	"github.com/coder/websocket"
)

// writeUnauthorized 是包内自备的 401 响应 helper。
// 不能 import package main 的 writeJSON（循环依赖），ws 包需要独立处理握手前的鉴权失败。
func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// WSHandler 返回 /api/ws 的 http.HandlerFunc，职责：
//  1. 从 query 参数提取 ticket，用 validateTicket 校验（失败 → 401 不升级）
//  2. websocket.Accept 升级连接（OriginPatterns 放宽兼容 dev 跨端口）
//  3. newClient → 投递到 hub.Register channel（Hub goroutine 异步注册）
//  4. 阻塞跑 client.writePump 直到连接断开
//  5. defer 投递到 hub.Unregister channel，让 Hub 回收 send channel 与连接
//
// validateTicket 由调用方（package main）注入：验 JWT 合法 + TokenVersion + Issuer=="lumen-ws"。
func WSHandler(hub *Hub, validateTicket func(ticket string) bool, allowedOrigins []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticket := r.URL.Query().Get("ticket")
		if ticket == "" || !validateTicket(ticket) {
			writeUnauthorized(w, "ticket 无效或已过期")
			return
		}

		// Origin 白名单：配了 CORS_ORIGINS 则限定（生产防恶意页面连 WS），未配则 "*"（dev 跨端口 5173→8081）
		originPatterns := []string{"*"}
		if len(allowedOrigins) > 0 {
			originPatterns = allowedOrigins
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: originPatterns,
		})
		if err != nil {
			// Accept 失败时 ResponseWriter 已经写过部分响应头，无法再写 401，仅记录返回
			return
		}

		client := newClient(conn)
		hub.Register() <- client

		// 阻塞至 writePump 退出（连接断开/慢消费者踢除/优雅关闭）
		client.writePump()

		// 注销：Hub 负责 close(client.send) 并从 clients map 移除
		// （若 client 因慢消费已被 Hub 踢除，此次 Unregister 是 no-op，Hub 用 map miss 容错）
		hub.Unregister() <- client
	}
}
