export type Theme = 'light' | 'notion-dark' | 'system'
export type ResolvedTheme = Exclude<Theme, 'system'>

export const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'notion-dark', label: '深色' },
] as const satisfies readonly { value: Theme; label: string }[]

export const THEME_CHANGE_EVENT = 'lumen:theme-change'

export function parseThemePreference(value: string | null): Theme {
  if (value === 'dark') return 'notion-dark'
  return value === 'notion-dark' || value === 'system' ? value : 'light'
}

export function getSavedTheme(): Theme {
  return parseThemePreference(localStorage.getItem('theme'))
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  return theme === 'system' ? (prefersDark ? 'notion-dark' : 'light') : theme
}

function applyResolvedTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolveTheme(
    theme,
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
}

let stopSystemListener: (() => void) | undefined

/** 应用并持久化主题偏好；system 时同步系统深浅变化。 */
export function applyTheme(theme: Theme) {
  localStorage.setItem('theme', theme)
  applyResolvedTheme(theme)
  stopSystemListener?.()
  stopSystemListener = undefined

  if (theme === 'system') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      applyResolvedTheme('system')
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
    }
    media.addEventListener('change', onChange)
    stopSystemListener = () => media.removeEventListener('change', onChange)
  }

  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}
