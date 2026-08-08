package ws

import (
	"context"
	"log"
)

// Hub 维护所有已连接 client，负责把一条广播扇出给每个 client 的 send channel。
// 通过三个 buffered channel 解耦：handler 投递 → Hub 单 goroutine 处理 → client writePump 写出。
type Hub struct {
	clients    map[*Client]struct{} // 在线客户端集合（仅 Hub goroutine 访问，无需锁）
	register   chan *Client         // 新连接注册
	unregister chan *Client         // 断开注销
	broadcast  chan []byte          // 广播 payload（已序列化的 JSON）
}

// NewHub 构造 Hub，三 channel 均用 broadcastBuf 缓冲吸收突发流量。
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]struct{}),
		register:   make(chan *Client, broadcastBuf),
		unregister: make(chan *Client, broadcastBuf),
		broadcast:  make(chan []byte, broadcastBuf),
	}
}

// Register / Unregister / Broadcast 是导出的访问器，供 *Server 方法（package main）调用。
func (h *Hub) Register() chan<- *Client   { return h.register }
func (h *Hub) Unregister() chan<- *Client { return h.unregister }
func (h *Hub) Broadcast() chan<- []byte   { return h.broadcast }

// Run 是 Hub 的主循环，单 goroutine 串行处理三队列，保证 clients map 无并发访问。
// ctx.Done 时关闭所有连接实现优雅关闭（main.go 用 signal.NotifyContext 派生 ctx）。
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			// 关闭所有连接：客户端 writePump 会在 ctx.Done 后退出并 close 连接
			for c := range h.clients {
				c.closeConn()
			}
			h.clients = nil
			log.Printf("ws: hub stopped, %d connections force-closed on shutdown", len(h.clients))
			return

		case client := <-h.register:
			if h.clients != nil {
				h.clients[client] = struct{}{}
				log.Printf("ws: client registered, total=%d", len(h.clients))
			}

		case client := <-h.unregister:
			if h.clients != nil {
				if _, ok := h.clients[client]; ok {
					delete(h.clients, client)
					close(client.send) // 通知 writePump 退出
					log.Printf("ws: client unregistered, total=%d", len(h.clients))
				}
			}

		case payload := <-h.broadcast:
			if h.clients == nil || len(h.clients) == 0 {
				continue
			}
			// 扇出：对每个 client 非阻塞投递，send channel 满 = 慢消费者 → 踢除
			for client := range h.clients {
				select {
				case client.send <- payload:
				default:
					// 慢消费者：send channel 满，直接踢掉，避免阻塞 Hub 主循环
					log.Printf("ws: kicking slow client, send buffer full")
					delete(h.clients, client)
					close(client.send)
					client.closeConn()
				}
			}
		}
	}
}
