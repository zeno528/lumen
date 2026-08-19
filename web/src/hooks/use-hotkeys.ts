import { useEffect } from 'react'
import { useUIStore } from '@/stores/ui'
import { isSettingsShortcut } from '@/lib/hotkeys'

/**
 * 全局快捷键 hook —— 挂在 AppShell 层监听 document keydown。
 *
 * - Ctrl/Cmd + K → 聚焦全局搜索框（id="global-search"）
 * - Ctrl/Cmd + I → 打开添加书签 dialog
 * - Ctrl/Cmd + Shift + I → 打开新建分类 dialog（⚠ 占用浏览器 DevTools 键，开发时开 DevTools 请用 F12）
 * - Ctrl/Cmd + B -> 切换书签批量模式
 * - Ctrl/Cmd + Shift + B -> 切换分类批量模式
 * - Ctrl + , → 打开账号设置
 * - Ctrl/Cmd + Enter → 触发当前 dialog 保存
 * - Esc → Dialog 自管 > 退出批量模式 > 清空搜索
 */
export function useHotkeys({
  onFocusSearch,
}: { onFocusSearch?: () => void } = {}) {
  const {
    bookmarkDialog,
    categoryDialog,
    batchDialog,
    batchMode,
    categoryBatchMode,
    searchQuery,
    openCreateBookmark,
    openCreateCategory,
    toggleBatchMode,
    exitBatchMode,
    exitCategoryBatchMode,
    toggleCategoryBatchMode,
    setSearchQuery,
    submitBookmarkDialog,
    submitCategoryDialog,
    submitBatchDialog,
    setSettingsOpen,
    setSettingsTab,
  } = useUIStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey

      if (isSettingsShortcut(e)) {
        e.preventDefault()
        setSettingsTab('account')
        setSettingsOpen(true)
        return
      }

      if (e.key === 'Escape') {
        // 任何 Dialog 打开（导出/确认/编辑/分类等）→ 让 Dialog 自管 ESC，不退出批量/清搜索
        // 用 DOM 检查 .modal-overlay-active 覆盖所有 Dialog（dialog.tsx 打开时挂该 class），
        // 避免「导出模态框打开 + 批量模式」时 ESC 误退出批量模式
        if (document.querySelector('.modal-overlay-active')) return
        if (batchMode) {
          e.preventDefault()
          exitBatchMode()
          return
        }
        if (categoryBatchMode) {
          e.preventDefault()
          exitCategoryBatchMode()
          return
        }
        if (searchQuery) {
          e.preventDefault()
          setSearchQuery('')
          // 失焦后 ESC 清空：焦点回搜索框，清空后可直接继续输入（与 Ctrl+K 同路复用）
          if (onFocusSearch) onFocusSearch()
          else document.getElementById('global-search')?.focus()
          return
        }
        return
      }

      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (onFocusSearch) {
          onFocusSearch()
        } else {
          document.getElementById('global-search')?.focus()
        }
        return
      }

      if (meta && !e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        openCreateBookmark()
        return
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleCategoryBatchMode()
        return
      }
      if (meta && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleBatchMode()
        return
      }

      if (meta && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        openCreateCategory()
        return
      }

      if (meta && e.key === 'Enter') {
        e.preventDefault()
        if (bookmarkDialog) submitBookmarkDialog()
        else if (categoryDialog) submitCategoryDialog()
        else if (batchDialog) submitBatchDialog()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    bookmarkDialog,
    categoryDialog,
    batchDialog,
    batchMode,
    categoryBatchMode,
    searchQuery,
    openCreateBookmark,
    openCreateCategory,
    toggleBatchMode,
    exitBatchMode,
    exitCategoryBatchMode,
    toggleCategoryBatchMode,
    setSearchQuery,
    submitBookmarkDialog,
    submitCategoryDialog,
    submitBatchDialog,
    setSettingsOpen,
    setSettingsTab,
  ])
}
