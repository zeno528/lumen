/** Ctrl/Cmd + ,：兼容物理键位及中文输入法传来的全角逗号。 */
export function isSettingsShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'key'>) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'Comma' || e.key === ',' || e.key === '，')
}
