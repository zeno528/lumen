package main

import (
	"encoding/json"
	"net/http"
	"time"

	"lumen/server/ws"
)

// handleWSTicket GET /api/ws/ticket
// 用主 JWT 换取 5s 有效期的 WebSocket 一次性 ticket（Issuer=lumen-ws）。
// 前端拿到 ticket 后立即用 ?ticket=xxx 连 /api/ws；5s + TokenVersion 校验保证一次性 + 改密码立失效。
func (s *Server) handleWSTicket(w http.ResponseWriter, _ *http.Request) {
	ticket, err := GenerateWSTicket(s.config.JWTSecret, s.GetTokenVersion())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "生成 ticket 失败"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ticket": ticket})
}

// broadcastInvalidated 非阻塞广播「资源失效」信号给所有已连接 WS 客户端。
// 调用时机：每个 CRUD handler 在写库 / tx.Commit 成功后、writeJSON 前一行。
// 设计要点：
//   - hub==nil 直接 return：测试 / 启动早期尚未初始化 hub 时也能安全调用
//   - json.Marshal 失败静默丢弃（不该发生，Message 字段都是基础类型）
//   - 投递 hub.Broadcast 用 select-default 非阻塞：绝不能阻塞写库 handler
//     （hub.Broadcast 缓冲 256，且 Hub goroutine 持续消费，正常情况不会满）
//   - 广播无 user_id 维度：当前为单用户部署，所有连接同属一账号；未来开放多用户时
//     需在 Message 加 UserID + per-user room，否则 A 改数据会触发 B 前端 invalidate
func (s *Server) broadcastInvalidated(resources ...string) {
	if s.hub == nil {
		return
	}
	payload, err := json.Marshal(ws.Message{
		Type:      ws.MessageTypeInvalidate,
		Resources: resources,
		TS:        time.Now().UnixMilli(),
	})
	if err != nil {
		return
	}
	select {
	case s.hub.Broadcast() <- payload:
	default:
	}
}
