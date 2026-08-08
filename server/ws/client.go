package ws

import (
	"context"
	"time"

	"github.com/coder/websocket"
)

// Client 封装单条 WebSocket 连接及其发送队列。
// 仅服务端→客户端单向广播：用 coder/websocket 的 CloseRead 模式，无需 readPump。
type Client struct {
	conn *websocket.Conn
	send chan []byte // Hub 投递的已序列化 payload；close 即退出 writePump
}

// newClient 创建 Client，send channel 用 sendBuf 缓冲。
func newClient(conn *websocket.Conn) *Client {
	return &Client{
		conn: conn,
		send: make(chan []byte, sendBuf),
	}
}

// writePump 是 client 的写循环，由 handler.go 在注册后阻塞调用。
// 流程（coder/websocket 推荐的 CloseRead 模式）：
//  1. CloseRead 启动内置 goroutine 处理 ping/close 控制帧，返回 ctx（连接断开时 cancel）
//  2. ping ticker 周期性主动 ping（保持代理/防火墙不掐连接）
//  3. select 三事件：ctx.Done（连接断开）、ticker（发 ping）、send 收到 payload（写消息）
//  4. 退出时 CloseNow 释放连接
func (c *Client) writePump() {
	defer c.conn.CloseNow()

	// CloseRead：声明不再读 data 消息，库内部处理 ping/pong/close 控制帧，
	// 返回的 ctx 在连接关闭或收到 data message 时 cancel —— 作为 writePump 主退出信号。
	ctx := c.conn.CloseRead(context.Background())

	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// 客户端断开或发来 data message（协议不允许），退出
			return

		case <-ticker.C:
			// 主动 ping：context.WithTimeout 防止写阻塞超过 pingTimeout
			pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}

		case payload, ok := <-c.send:
			if !ok {
				// send channel 被 Hub close（注销/踢除/优雅关闭）→ 退出
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, pingTimeout)
			err := c.conn.Write(writeCtx, websocket.MessageText, payload)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// closeConn 关闭底层连接（仅 Hub goroutine 在踢除/优雅关闭时调用）。
// 用 StatusGoingAway 让前端 onclose 拿到「服务端主动关闭」语义，触发指数退避重连。
func (c *Client) closeConn() {
	_ = c.conn.Close(websocket.StatusGoingAway, "server shutdown")
}
