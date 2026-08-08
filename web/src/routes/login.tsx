import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { User, Lock, Eye, EyeOff } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { getBookmarks } from '@/api/bookmarks'
import { getCategories } from '@/api/categories'
import { useAuthStore } from '@/stores/auth'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { toast } from '@/components/ui/toast'

/**
 * 登录页 -- 接 POST /api/auth/login。
 * SVG Logo（4 path）+ 3 光晕 + 15 装饰微粒 + 毛玻璃卡片 + 胶囊输入。
 */
export const Route = createFileRoute('/login')({
  head: () => ({ meta: [{ title: 'Lumen · 登录' }] }),
  component: LoginPage,
})

function LoginPage() {
  const [showPwd, setShowPwd] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // shake 动画：登录失败时输入框左右晃动。state 驱动 className，triggerShake 重启动画
  const [shake, setShake] = useState(false)
  // Logo 眼睛入场结束（≈0.85s）后置 true，给 .logo-eye 加 .blink class 触发持续眨眼
  const [blink, setBlink] = useState(false)
  // 输错 -> angry（摇头），输对 -> happy（蹦跳）
  const [logoMood, setLogoMood] = useState<'idle' | 'angry' | 'happy'>('idle')
  // 复触发：先 reset 到 idle，下一帧再设目标 mood，让 CSS 动画从头跑
  const flashMood = (mood: 'angry' | 'happy') => {
    setLogoMood('idle')
    requestAnimationFrame(() => setLogoMood(mood))
  }
  // 重启 shake 动画：先 false 再下一帧 true，让 CSS animation 从头跑
  const triggerShake = () => {
    setShake(false)
    requestAnimationFrame(() => setShake(true))
  }
  // 两个 input 的 ref -- 用于 Enter 键聚焦跳转
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()
  const qc = useQueryClient()

  // 页面加载自动聚焦账号输入框（autoFocus 在 Portal/条件渲染时可能不触发，useEffect 兜底）
  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  // 入场动画结束（眼睛右眼延迟 0.5s + 持续 0.35s ≈ 0.85s）后，缓冲 1s 触发持续眨眼
  useEffect(() => {
    const t = setTimeout(() => setBlink(true), 1000)
    return () => clearTimeout(t)
  }, [])

  /**
   * 账号框 Enter：密码非空 -> 直接登录；密码为空 -> 聚焦密码框
   * 密码框 Enter：直接登录
   */
  const handleEnter = (from: 'username' | 'password') => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (from === 'username') {
      if (password) submit()
      else passwordRef.current?.focus()
    } else {
      submit()
    }
  }

  /**
   * 内部提交函数（不绑 form 事件），form 的 onSubmit 和 Enter 键都走它。
   * 这样 Enter 触发时无需伪造 FormEvent，避免 TS 类型污染。
   */
  const submit = async () => {
    // 登录中拒绝重复提交（按钮已 disabled，这里挡 Enter 键绕过按钮的情况）
    if (loading) return
    // 前端拦截空字段，避免消耗后端登录限速次数（5次/10分钟/IP）
    if (!username.trim() || !password) {
      setError('请输入账号和密码')
      // 空字段时把光标定位到第一个空输入框
      if (!username.trim()) usernameRef.current?.focus()
      else passwordRef.current?.focus()
      return
    }
    setError(null)
    setLoading(true)
    try {
      const data = await api<{ token: string; ok: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setToken(data.token)
      toast.success('登录成功，欢迎回来！', <span style={{ fontSize: 16 }}>👋</span>)
      // Logo 蹦跳作为「正在进入」的加载提示，等待预取期间持续播放
      flashMood('happy')
      // 数据驱动跳转：并发预取书签 + 分类，数据就绪即跳，书签页 mount 时缓存命中秒出。
      // 最多等 5s 兜底：网络异常预取迟迟不回也强制跳走，交由书签页自身显示加载，避免卡在登录页。
      const prefetch = Promise.all([
        qc.prefetchQuery({ queryKey: ['bookmarks'], queryFn: getBookmarks }),
        qc.prefetchQuery({ queryKey: ['categories'], queryFn: getCategories }),
      ])
      await Promise.race([prefetch, new Promise((resolve) => setTimeout(resolve, 5000))])
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请重试')
      // 触发输入框左右晃动
      triggerShake()
      // Logo 联动：摇头拒绝
      flashMood('angry')
      setTimeout(() => setLogoMood('idle'), 500)
      // 失败才解除 loading；成功路径保持「登录中…」直到 navigate 跳走，避免按钮闪回「登录」
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      {/* 右上角主题切换按钮（绝对定位，毛玻璃胶囊样式见 auth.css .auth-theme-toggle） */}
      <ThemeToggle className="auth-theme-toggle" />

      <div className="auth-blob auth-blob-3" />
      <div className="auth-blob auth-blob-4" />
      <div className="auth-blob auth-blob-5" />

      <div className="auth-orbit">
        <span className="auth-orbit-dot" style={{ width: '6px', height: '6px', background: 'var(--accent)', top: '12%', left: '8%', '--dur': '5s', '--delay': '0s', '--tx': '20px', '--ty': '-15px', '--opa': '0.5' } as React.CSSProperties} />
        <span className="auth-orbit-dot" style={{ width: '4px', height: '4px', background: '#8b5cf6', top: '25%', right: '12%', '--dur': '7s', '--delay': '0.5s', '--tx': '-15px', '--ty': '20px', '--opa': '0.45' } as React.CSSProperties} />
        <span className="auth-orbit-dot" style={{ width: '5px', height: '5px', background: '#06b6d4', bottom: '30%', left: '15%', '--dur': '6s', '--delay': '1s', '--tx': '25px', '--ty': '-18px', '--opa': '0.5' } as React.CSSProperties} />
        <span className="auth-orbit-dot" style={{ width: '3px', height: '3px', background: '#f59e0b', top: '18%', right: '25%', '--dur': '8s', '--delay': '0.3s', '--tx': '-12px', '--ty': '22px', '--opa': '0.4' } as React.CSSProperties} />
        <span className="auth-orbit-dot" style={{ width: '7px', height: '7px', background: '#f43f5e', bottom: '20%', right: '10%', '--dur': '6.5s', '--delay': '1.5s', '--tx': '18px', '--ty': '-10px', '--opa': '0.4' } as React.CSSProperties} />
        <span className="auth-orbit-dot" style={{ width: '4px', height: '4px', background: 'var(--accent)', top: '60%', left: '6%', '--dur': '7.5s', '--delay': '0.8s', '--tx': '14px', '--ty': '16px', '--opa': '0.35' } as React.CSSProperties} />
        <span className="auth-orbit-cross" style={{ top: '8%', left: '35%', '--col': 'var(--accent)', '--dur': '7s', '--delay': '0.8s', '--tx': '12px', '--ty': '18px', '--opa': '0.3' } as React.CSSProperties} />
        <span className="auth-orbit-cross" style={{ bottom: '15%', left: '25%', '--col': '#06b6d4', '--dur': '8s', '--delay': '2s', '--tx': '-18px', '--ty': '-12px', '--opa': '0.25' } as React.CSSProperties} />
        <span className="auth-orbit-tri" style={{ top: '22%', right: '8%', '--col': '#f59e0b', '--dur': '6s', '--delay': '0.2s', '--tx': '16px', '--ty': '14px', '--opa': '0.35' } as React.CSSProperties} />
        <span className="auth-orbit-tri" style={{ bottom: '25%', right: '20%', '--col': '#8b5cf6', '--dur': '7.5s', '--delay': '1.2s', '--tx': '-14px', '--ty': '-16px', '--opa': '0.3' } as React.CSSProperties} />
        <span className="auth-orbit-ring" style={{ width: '10px', height: '10px', top: '35%', left: '5%', '--col': 'var(--accent)', '--dur': '9s', '--delay': '0.6s', '--tx': '10px', '--ty': '-14px', '--opa': '0.25' } as React.CSSProperties} />
        <span className="auth-orbit-ring" style={{ width: '8px', height: '8px', bottom: '35%', right: '6%', '--col': '#f43f5e', '--dur': '7s', '--delay': '1.8s', '--tx': '-16px', '--ty': '12px', '--opa': '0.2' } as React.CSSProperties} />
        <span className="auth-orbit-ring" style={{ width: '12px', height: '12px', top: '70%', right: '15%', '--col': '#f59e0b', '--dur': '10s', '--delay': '0.4s', '--tx': '8px', '--ty': '-10px', '--opa': '0.2' } as React.CSSProperties} />
        <span className="auth-orbit-cross auth-orbit-spin" style={{ top: '15%', left: '55%', '--col': '#8b5cf6', '--dur': '10s', '--delay': '0s', '--tx': '8px', '--ty': '10px', '--opa': '0.2', '--spin': '12s' } as React.CSSProperties} />
        <span className="auth-orbit-ring auth-orbit-spin" style={{ width: '14px', height: '14px', bottom: '12%', left: '40%', '--col': '#06b6d4', '--dur': '8s', '--delay': '1s', '--tx': '-10px', '--ty': '-8px', '--opa': '0.18', '--spin': '15s' } as React.CSSProperties} />
      </div>

      <div className="auth-card liquid-glass">
        <div className="auth-logo">
          <div className={`logo-mood ${logoMood === 'idle' ? '' : logoMood}`.trim()}>
          <svg className="logo-animated" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(472,76)">
              <path className="logo-face" d="M0,0 L26,0 L44,4 L71,12 L101,22 L130,31 L155,39 L192,51 L207,56 L240,67 L271,77 L293,84 L314,90 L352,103 L369,108 L388,116 L402,125 L414,136 L423,146 L431,162 L436,176 L439,195 L439,263 L437,644 L436,661 L431,681 L422,702 L412,716 L400,728 L385,738 L319,771 L299,780 L283,788 L262,798 L246,806 L227,815 L208,825 L194,832 L166,845 L143,856 L119,867 L102,872 L91,874 L72,874 L58,871 L40,866 L2,852 L-24,843 L-58,831 L-115,810 L-134,803 L-153,796 L-196,781 L-204,778 L-232,768 L-252,761 L-281,750 L-293,746 L-306,740 L-317,734 L-330,723 L-340,711 L-348,697 L-353,685 L-357,672 L-359,658 L-360,608 L-360,223 L-358,199 L-353,180 L-345,164 L-337,153 L-327,143 L-316,135 L-307,130 L-291,122 L-254,105 L-242,100 L-205,84 L-189,77 L-162,65 L-128,49 L-110,41 L-94,34 L-60,19 L-53,16 L-43,12 L-33,7 L-13,2 Z" fill="#1C1C1A" />
            </g>
            <g transform="translate(167,280)">
              <path className="logo-face" d="M0,0 L14,0 L31,5 L61,15 L104,29 L139,41 L160,47 L183,54 L204,61 L239,72 L274,84 L294,90 L330,102 L349,109 L358,115 L364,120 L370,128 L376,143 L378,154 L378,390 L377,588 L373,604 L367,612 L360,618 L352,621 L340,621 L324,616 L309,611 L286,603 L261,594 L245,588 L233,584 L204,573 L184,566 L169,560 L151,554 L115,541 L94,534 L69,525 L17,506 L3,499 L-5,492 L-5,490 L-7,490 L-15,479 L-19,471 L-23,455 L-23,28 L-19,16 L-15,10 L-7,3 Z" fill="#FFFFFF" />
            </g>
            <g transform="translate(252,408)">
              <path
                className={`logo-eye logo-eye-left${blink ? ' blink' : ''}`}
                d="M0,0 L11,1 L18,7 L25,17 L30,28 L36,49 L38,62 L39,74 L39,90 L38,105 L34,124 L29,137 L23,147 L14,153 L5,153 L-1,149 L-6,145 L-14,132 L-21,111 L-24,95 L-26,72 L-25,53 L-22,34 L-17,18 L-11,8 L-3,1 Z"
                fill="#1C1C1A"
              />
            </g>
            <g transform="translate(420,454)">
              <path
                className={`logo-eye logo-eye-right${blink ? ' blink' : ''}`}
                d="M0,0 L9,2 L15,7 L22,17 L28,31 L32,47 L35,73 L35,89 L33,109 L29,126 L22,142 L14,151 L8,154 L-2,153 L-12,144 L-18,134 L-23,121 L-27,104 L-29,88 L-30,67 L-27,43 L-23,27 L-17,13 L-9,4 L-4,1 Z"
                fill="#1C1C1A"
              />
            </g>
          </svg>
        </div>

          <h3>Lumen</h3>
          <p className="auth-subtitle">知识库 · 笔记 · 书签</p>
        </div>

        <p className="auth-welcome">👋 欢迎回来！</p>

        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <div className={`auth-input-wrapper${shake ? ' shake' : ''}`}>
            <User className="auth-input-icon" size={14} />
            <input
              ref={usernameRef}
              type="text"
              placeholder="账号"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleEnter('username')}
            />
          </div>
          <div className={`auth-input-wrapper${shake ? ' shake' : ''}`}>
            <Lock className="auth-input-icon" size={14} />
            <input
              ref={passwordRef}
              type={showPwd ? 'text' : 'password'}
              placeholder="密码"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleEnter('password')}
            />
            <button
              type="button"
              className="auth-input-toggle"
              onClick={() => setShowPwd((v) => !v)}
              title={showPwd ? '隐藏密码' : '显示密码'}
            >
              {showPwd ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>

          {error && (
            <p className="text-(--destructive) text-[0.8rem] mb-2 text-center">
              {error}
            </p>
          )}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? '登录中…' : '登 录'}
          </button>
        </form>
      </div>

      <div className="auth-footer">
        <span>© 2026</span>
        <span className="footer-dot" />
        <span>Powered by Lumen</span>
      </div>
    </div>
  )
}
