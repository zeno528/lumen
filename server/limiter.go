package main

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

// ipRateLimiter IP 维度滑动窗口限速器。
// 与登录失败锁定（isLoginLocked，防密码暴力破解）互补：本限速器防已认证/公开端点的请求频率滥用
// （/ai-test 刷外部 AI 配额、/import 大请求体轰炸、/api/auth/github/callback 匿名刷 OAuth）。
// 每个 IP 维护窗口内时间戳切片，allow 时惰性剔除过期时间戳，超 limit 拒绝；后台定期清空 entry 防泄漏。
type ipRateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	limit  int
	window time.Duration
}

// newIPRateLimiter 创建限速器并启动后台清理 goroutine。
func newIPRateLimiter(limit int, window time.Duration) *ipRateLimiter {
	l := &ipRateLimiter{
		hits:   make(map[string][]time.Time),
		limit:  limit,
		window: window,
	}
	go l.cleanupLoop()
	return l
}

// allow 返回该 IP 是否仍可在当前窗口内再发一次请求；false 表示超限需 429。
func (l *ipRateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	hits := l.hits[ip]
	// 惰性剔除窗口外时间戳（复用底层数组 hits[:0] 省分配）
	kept := hits[:0]
	for _, h := range hits {
		if h.After(cutoff) {
			kept = append(kept, h)
		}
	}
	if len(kept) >= l.limit {
		l.hits[ip] = kept
		return false
	}
	l.hits[ip] = append(kept, now)
	return true
}

// cleanupLoop 后台定期清窗口已无命中的 IP entry，防 map 无限增长。
func (l *ipRateLimiter) cleanupLoop() {
	ticker := time.NewTicker(l.window)
	defer ticker.Stop()
	for range ticker.C {
		l.mu.Lock()
		cutoff := time.Now().Add(-l.window)
		for ip, hits := range l.hits {
			if len(hits) == 0 || !hits[len(hits)-1].After(cutoff) {
				delete(l.hits, ip)
			}
		}
		l.mu.Unlock()
	}
}

// rateLimit 返回 chi middleware：按客户端 IP 滑动窗口限速，超限返回 429 + Retry-After。
// 相同 (limit, window) 配置复用同一 limiter 实例（计数状态共享）；不同配置各自独立 limiter。
func (s *Server) rateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	key := strconv.Itoa(limit) + ":" + strconv.FormatInt(int64(window.Seconds()), 10)
	s.rateLimitersMu.Lock()
	l, exists := s.rateLimiters[key]
	if !exists {
		l = newIPRateLimiter(limit, window)
		s.rateLimiters[key] = l
	}
	s.rateLimitersMu.Unlock()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.allow(s.getClientIP(r)) {
				w.Header().Set("Retry-After", strconv.Itoa(max(int(window.Seconds()), 1)))
				writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "请求过于频繁，请稍后再试"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
