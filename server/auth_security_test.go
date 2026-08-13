package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"lumen/server/db"
)

func TestSessionCookieSecureOnlyOutsideDevelopment(t *testing.T) {
	cases := []struct {
		appEnv string
		secure bool
	}{
		{"development", false},
		{"production", true},
		{"", true}, // 未设 APP_ENV 按 fail-closed 生产对待
	}
	for _, tc := range cases {
		srv := newAuthTestServer(t, tc.appEnv, "p")
		rec := httptest.NewRecorder()
		srv.setSessionCookie(rec, "t", http.SameSiteStrictMode)
		cookies := rec.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("appEnv=%q: want 1 cookie, got %d", tc.appEnv, len(cookies))
		}
		if cookies[0].Secure != tc.secure {
			t.Fatalf("appEnv=%q: Secure=%v, want %v", tc.appEnv, cookies[0].Secure, tc.secure)
		}
	}
}

// newAuthTestServer 构造一个带全新临时 SQLite 库的 Server，仅用于密码初始化安全测试。
// 复用项目既有测试的 db.Connect + Migrate 初始化方式（见 api_integration_test.go）。
func newAuthTestServer(t *testing.T, appEnv, password string) *Server {
	t.Helper()
	database, err := db.Connect(filepath.Join(t.TempDir(), "lumen-test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}
	return &Server{
		db:     database,
		config: &Config{AppEnv: appEnv, Password: password, JWTSecret: "test-jwt-secret"},
	}
}

// passwordHashFromDB 读取 settings.password_hash（空串表示未写入）。
func passwordHashFromDB(srv *Server) string {
	var h string
	_ = srv.db.QueryRow("SELECT value FROM settings WHERE key = 'password_hash'").Scan(&h)
	return h
}

// seedPasswordHash 直接写入一个已知 bcrypt 哈希，模拟「已有密码的存量库」，返回写入值用于后续比对。
func seedPasswordHash(t *testing.T, srv *Server, pwd string) string {
	t.Helper()
	h, err := hashPasswordBcrypt(pwd)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := srv.db.Exec(`INSERT INTO settings (key, value) VALUES ('password_hash', ?)`, h); err != nil {
		t.Fatal(err)
	}
	return h
}

// TestResolveJWTSecret 覆盖 JWT 密钥解析的环境规范化与 fail-closed 边界：
//   - 缺失 APP_ENV 视为 production（未显式声明 development 即按生产严格对待）
//   - production 下空/默认 JWT 返回错误
//   - development 下允许开发默认值
func TestResolveJWTSecret(t *testing.T) {
	strong := "test-strong-random-secret-0123456789abcdef"
	tests := []struct {
		name       string
		appEnv     string
		jwt        string
		wantErr    bool
		wantEnv    string
		wantSecret string
	}{
		{"缺失环境视为生产且默认 JWT 拒绝", "", "", true, "production", ""},
		{"生产 + 默认 JWT 拒绝", "production", defaultJWTSecret, true, "production", ""},
		{"开发 + 空 JWT 允许默认值", "development", "", false, "development", defaultJWTSecret},
		{"生产 + 强 JWT 通过", "production", strong, false, "production", strong},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			secret, env, err := resolveJWTSecret(tc.appEnv, tc.jwt)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("期望返回错误，得到 nil（secret=%q env=%q）", secret, env)
				}
				if env != tc.wantEnv {
					t.Fatalf("错误路径 env=%q，want %q", env, tc.wantEnv)
				}
				return
			}
			if err != nil {
				t.Fatalf("未预期的错误: %v", err)
			}
			if env != tc.wantEnv {
				t.Fatalf("env=%q，want %q", env, tc.wantEnv)
			}
			if secret != tc.wantSecret {
				t.Fatalf("secret=%q，want %q", secret, tc.wantSecret)
			}
		})
	}
}

// TestInitPasswordIfNeeded 覆盖首次密码初始化的生产 fail-closed 与开发兼容边界：
//   - production 新库空密码/admin → 返回错误且不写库
//   - development 新库空密码 → 回退 admin 并写 bcrypt
//   - 已有 password_hash → 直接放行，不要求 APP_PASSWORD、不覆盖
func TestInitPasswordIfNeeded(t *testing.T) {
	t.Run("生产新库空密码拒绝且不写哈希", func(t *testing.T) {
		srv := newAuthTestServer(t, "production", "")
		if err := srv.initPasswordIfNeeded(); err == nil {
			t.Fatal("生产新库空密码应返回错误")
		}
		if h := passwordHashFromDB(srv); h != "" {
			t.Fatalf("拒绝路径不应写入哈希，得到 %q", h)
		}
	})

	t.Run("生产新库默认 admin 拒绝", func(t *testing.T) {
		srv := newAuthTestServer(t, "production", "admin")
		if err := srv.initPasswordIfNeeded(); err == nil {
			t.Fatal("生产新库 admin 密码应返回错误")
		}
	})

	t.Run("开发新库空密码回退 admin 并写 bcrypt", func(t *testing.T) {
		srv := newAuthTestServer(t, "development", "")
		if err := srv.initPasswordIfNeeded(); err != nil {
			t.Fatalf("开发空密码应允许初始化，得到错误: %v", err)
		}
		h := passwordHashFromDB(srv)
		if h == "" {
			t.Fatal("开发回退应写入 bcrypt 哈希")
		}
		if !isBcryptHash(h) {
			t.Fatalf("期望 bcrypt 哈希，得到 %q", h)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(h), []byte("admin")); err != nil {
			t.Fatalf("回退哈希应匹配 admin: %v", err)
		}
	})

	t.Run("生产存量库已有哈希时不要求 APP_PASSWORD", func(t *testing.T) {
		srv := newAuthTestServer(t, "production", "")
		seed := seedPasswordHash(t, srv, "existing-strong-password")
		if err := srv.initPasswordIfNeeded(); err != nil {
			t.Fatalf("已有哈希应直接放行，得到错误: %v", err)
		}
		if got := passwordHashFromDB(srv); got != seed {
			t.Fatal("已有哈希不应被覆盖")
		}
	})
}
