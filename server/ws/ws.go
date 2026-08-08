// Package ws 提供 WebSocket 实时同步能力：单向广播（server→client）的 Hub 模式实现。
//
// 业务流程：CRUD handler 写库成功后调用 broadcastInvalidated(resources...) →
// 序列化 ws.Message 投递到 hub.Broadcast channel → Hub goroutine 扇出给所有 client
// 的 send channel → 各 client 的 writePump 通过 coder/websocket conn.Write 写出。
package ws

import "time"

// Message 是服务端→客户端的 WebSocket 消息体。
// 当前仅用于「失效通知」，客户端收到后按 resources 映射到 query key 调 invalidateQueries。
type Message struct {
	Type      string   `json:"type"`      // 消息类型，目前固定 "invalidate"
	Resources []string `json:"resources"` // 失效的资源名（bookmarks/categories/auth-nickname/...）
	TS        int64    `json:"ts"`        // 服务端发送时间戳（UnixMilli），客户端调试/去重用
}

// 消息类型常量
const MessageTypeInvalidate = "invalidate"

// Hub channel 缓冲大小：Register/Unregister/Broadcast 三队列容量。
// 256 足够吸收突发注册/广播，慢消费者由 Hub.Run 的 select-default 兜底踢除。
const broadcastBuf = 256

// 单连接 send channel 缓冲：客户端慢时 hub 会踢掉该 client 而不是阻塞广播 goroutine。
const sendBuf = 64

// 心跳间隔：服务端每 pingInterval 向客户端发一次 ping（由 coder/websocket 库内部处理）。
// plan 要求的 30s 与 pingTimeout 常量在这里声明，库的 CloseRead 自动处理控制帧。
const (
	pingInterval = 30 * time.Second // 心跳间隔
	pingTimeout  = 5 * time.Second  // 单次 ping 写超时
)
