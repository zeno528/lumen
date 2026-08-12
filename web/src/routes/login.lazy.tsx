import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import { getBookmarks } from '@/api/bookmarks'
import { getCategories } from '@/api/categories'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { toast } from '@/components/ui/toast'
import { useAuthStore } from '@/stores/auth'
import '@/styles/auth.css'

export const Route = createLazyFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const [showPwd, setShowPwd] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [blink, setBlink] = useState(false)
  const [logoMood, setLogoMood] = useState<'idle' | 'angry' | 'happy'>('idle')
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const flashMood = (mood: 'angry' | 'happy') => {
    setLogoMood('idle')
    requestAnimationFrame(() => setLogoMood(mood))
  }

  const triggerShake = () => {
    setShake(false)
    requestAnimationFrame(() => setShake(true))
  }

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setBlink(true), 1000)
    return () => window.clearTimeout(timer)
  }, [])

  const submit = async () => {
    if (loading) return
    if (!username.trim() || !password) {
      setError('请输入账号和密码')
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
      flashMood('happy')
      const prefetch = Promise.all([
        qc.prefetchQuery({ queryKey: ['bookmarks'], queryFn: getBookmarks }),
        qc.prefetchQuery({ queryKey: ['categories'], queryFn: getCategories }),
      ])
      await Promise.race([prefetch, new Promise((resolve) => setTimeout(resolve, 5000))])
      navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请重试')
      triggerShake()
      flashMood('angry')
      window.setTimeout(() => setLogoMood('idle'), 500)
      setLoading(false)
    }
  }

  const handleEnter = (from: 'username' | 'password') => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (from === 'username' && !password) passwordRef.current?.focus()
    else void submit()
  }

  return (
    <div className="auth-screen">
      <ThemeToggle className="auth-theme-toggle" />

      <div className="auth-blob auth-blob-3" />
      <div className="auth-blob auth-blob-4" />
      <div className="auth-blob auth-blob-5" />
      <div className="auth-orbit">
        <OrbitDot className="auth-orbit-dot" style={{ width: '6px', height: '6px', background: 'var(--accent)', top: '12%', left: '8%', '--dur': '5s', '--delay': '0s', '--tx': '20px', '--ty': '-15px', '--opa': '0.5' }} />
        <OrbitDot className="auth-orbit-dot" style={{ width: '4px', height: '4px', background: '#8b5cf6', top: '25%', right: '12%', '--dur': '7s', '--delay': '0.5s', '--tx': '-15px', '--ty': '20px', '--opa': '0.45' }} />
        <OrbitDot className="auth-orbit-dot" style={{ width: '5px', height: '5px', background: '#06b6d4', bottom: '30%', left: '15%', '--dur': '6s', '--delay': '1s', '--tx': '25px', '--ty': '-18px', '--opa': '0.5' }} />
        <OrbitDot className="auth-orbit-dot" style={{ width: '3px', height: '3px', background: '#f59e0b', top: '18%', right: '25%', '--dur': '8s', '--delay': '0.3s', '--tx': '-12px', '--ty': '22px', '--opa': '0.4' }} />
        <OrbitDot className="auth-orbit-dot" style={{ width: '7px', height: '7px', background: '#f43f5e', bottom: '20%', right: '10%', '--dur': '6.5s', '--delay': '1.5s', '--tx': '18px', '--ty': '-10px', '--opa': '0.4' }} />
        <OrbitDot className="auth-orbit-dot" style={{ width: '4px', height: '4px', background: 'var(--accent)', top: '60%', left: '6%', '--dur': '7.5s', '--delay': '0.8s', '--tx': '14px', '--ty': '16px', '--opa': '0.35' }} />
        <OrbitDot className="auth-orbit-cross" style={{ top: '8%', left: '35%', '--col': 'var(--accent)', '--dur': '7s', '--delay': '0.8s', '--tx': '12px', '--ty': '18px', '--opa': '0.3' }} />
        <OrbitDot className="auth-orbit-cross" style={{ bottom: '15%', left: '25%', '--col': '#06b6d4', '--dur': '8s', '--delay': '2s', '--tx': '-18px', '--ty': '-12px', '--opa': '0.25' }} />
        <OrbitDot className="auth-orbit-tri" style={{ top: '22%', right: '8%', '--col': '#f59e0b', '--dur': '6s', '--delay': '0.2s', '--tx': '16px', '--ty': '14px', '--opa': '0.35' }} />
        <OrbitDot className="auth-orbit-tri" style={{ bottom: '25%', right: '20%', '--col': '#8b5cf6', '--dur': '7.5s', '--delay': '1.2s', '--tx': '-14px', '--ty': '-16px', '--opa': '0.3' }} />
        <OrbitDot className="auth-orbit-ring" style={{ width: '10px', height: '10px', top: '35%', left: '5%', '--col': 'var(--accent)', '--dur': '9s', '--delay': '0.6s', '--tx': '10px', '--ty': '-14px', '--opa': '0.25' }} />
        <OrbitDot className="auth-orbit-ring" style={{ width: '8px', height: '8px', bottom: '35%', right: '6%', '--col': '#f43f5e', '--dur': '7s', '--delay': '1.8s', '--tx': '-16px', '--ty': '12px', '--opa': '0.2' }} />
        <OrbitDot className="auth-orbit-ring" style={{ width: '12px', height: '12px', top: '70%', right: '15%', '--col': '#f59e0b', '--dur': '10s', '--delay': '0.4s', '--tx': '8px', '--ty': '-10px', '--opa': '0.2' }} />
        <OrbitDot className="auth-orbit-cross auth-orbit-spin" style={{ top: '15%', left: '55%', '--col': '#8b5cf6', '--dur': '10s', '--delay': '0s', '--tx': '8px', '--ty': '10px', '--opa': '0.2', '--spin': '12s' }} />
        <OrbitDot className="auth-orbit-ring auth-orbit-spin" style={{ width: '14px', height: '14px', bottom: '12%', left: '40%', '--col': '#06b6d4', '--dur': '8s', '--delay': '1s', '--tx': '-10px', '--ty': '-8px', '--opa': '0.18', '--spin': '15s' }} />
      </div>

      <div className="auth-card liquid-glass">
        <div className="auth-logo">
          <div className={`logo-mood ${logoMood === 'idle' ? '' : logoMood}`.trim()}>
            <svg className="logo-animated" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <g transform="translate(472,76)"><path className="logo-face" d="M0,0 L26,0 L44,4 L71,12 L101,22 L130,31 L155,39 L192,51 L207,56 L240,67 L271,77 L293,84 L314,90 L352,103 L369,108 L388,116 L402,125 L414,136 L423,146 L431,162 L436,176 L439,195 L439,263 L437,644 L436,661 L431,681 L422,702 L412,716 L400,728 L385,738 L319,771 L299,780 L283,788 L262,798 L246,806 L227,815 L208,825 L194,832 L166,845 L143,856 L119,867 L102,872 L91,874 L72,874 L58,871 L40,866 L2,852 L-24,843 L-58,831 L-115,810 L-134,803 L-153,796 L-196,781 L-204,778 L-232,768 L-252,761 L-281,750 L-293,746 L-306,740 L-317,734 L-330,723 L-340,711 L-348,697 L-353,685 L-357,672 L-359,658 L-360,608 L-360,223 L-358,199 L-353,180 L-345,164 L-337,153 L-327,143 L-316,135 L-307,130 L-291,122 L-254,105 L-242,100 L-205,84 L-189,77 L-162,65 L-128,49 L-110,41 L-94,34 L-60,19 L-53,16 L-43,12 L-33,7 L-13,2 Z" fill="#1C1C1A" /></g>
              <g transform="translate(167,280)"><path className="logo-face" d="M0,0 L14,0 L31,5 L61,15 L104,29 L139,41 L160,47 L183,54 L204,61 L239,72 L274,84 L294,90 L330,102 L349,109 L358,115 L364,120 L370,128 L376,143 L378,154 L378,390 L377,588 L373,604 L367,612 L360,618 L352,621 L340,621 L324,616 L309,611 L286,603 L261,594 L245,588 L233,584 L204,573 L184,566 L169,560 L151,554 L115,541 L94,534 L69,525 L17,506 L3,499 L-5,492 L-5,490 L-7,490 L-15,479 L-19,471 L-23,455 L-23,28 L-19,16 L-15,10 L-7,3 Z" fill="#FFFFFF" /></g>
              <g transform="translate(252,408)"><path className={`logo-eye logo-eye-left${blink ? ' blink' : ''}`} d="M0,0 L11,1 L18,7 L25,17 L30,28 L36,49 L38,62 L39,74 L39,90 L38,105 L34,124 L29,137 L23,147 L14,153 L5,153 L-1,149 L-6,145 L-14,132 L-21,111 L-24,95 L-26,72 L-25,53 L-22,34 L-17,18 L-11,8 L-3,1 Z" fill="#1C1C1A" /></g>
              <g transform="translate(420,454)"><path className={`logo-eye logo-eye-right${blink ? ' blink' : ''}`} d="M0,0 L9,2 L15,7 L22,17 L28,31 L32,47 L35,73 L35,89 L33,109 L29,126 L22,142 L14,151 L8,154 L-2,153 L-12,144 L-18,134 L-23,121 L-27,104 L-29,88 L-30,67 L-27,43 L-23,27 L-17,13 L-9,4 L-4,1 Z" fill="#1C1C1A" /></g>
            </svg>
          </div>
          <h3>Lumen</h3>
          <p className="auth-subtitle">知识库 · 笔记 · 书签</p>
        </div>
        <p className="auth-welcome">👋 欢迎回来！</p>
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className={`auth-input-wrapper${shake ? ' shake' : ''}`}>
            <User className="auth-input-icon" size={14} />
            <input ref={usernameRef} type="text" placeholder="账号" autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} onKeyDown={handleEnter('username')} />
          </div>
          <div className={`auth-input-wrapper${shake ? ' shake' : ''}`}>
            <Lock className="auth-input-icon" size={14} />
            <input ref={passwordRef} type={showPwd ? 'text' : 'password'} placeholder="密码" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={handleEnter('password')} />
            <button type="button" className="auth-input-toggle" onClick={() => setShowPwd((value) => !value)} title={showPwd ? '隐藏密码' : '显示密码'}>
              {showPwd ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>
          {error && <p className="text-(--destructive) text-[0.8rem] mb-2 text-center">{error}</p>}
          <button type="submit" className="auth-btn" disabled={loading}>{loading ? '登录中…' : '登 录'}</button>
        </form>
      </div>
      <div className="auth-footer"><span>© 2026</span><span className="footer-dot" /><span>Powered by Lumen</span></div>
    </div>
  )
}

type OrbitStyle = React.CSSProperties & Record<`--${string}`, string | number>

function OrbitDot({ className, style }: { className: string; style: OrbitStyle }) {
  return <span className={className} style={style} />
}
