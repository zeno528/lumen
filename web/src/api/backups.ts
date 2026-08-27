import { api } from './client'

export interface BackupSettings {
  interval_hours: number
  max_count: number
  last_run_at?: string
  next_run_at?: string
  last_error?: string
}

export interface BackupFile {
  id: string
  display_name: string
  size_bytes: number
  source: 'manual' | 'auto'
  created_at: string
}

export interface BackupPreview {
  bookmarks: number
  categories: number
}

/** 备份设置只在设置页备份 Tab 挂载后调用，不参与首屏请求。 */
export function getBackupSettings(): Promise<BackupSettings> {
  return api('/backups/settings')
}

export function updateBackupSettings(input: {
  interval_hours: number
  max_count: number
}): Promise<BackupSettings> {
  return api('/backups/settings', { method: 'PUT', body: JSON.stringify(input) })
}

export function listBackups(): Promise<{ backups: BackupFile[] }> {
  return api('/backups')
}

export function runBackup(): Promise<BackupFile> {
  return api('/backups/run', { method: 'POST' })
}

export function renameBackup(
  id: string,
  display_name: string,
): Promise<{ ok: boolean; display_name: string }> {
  return api<{ ok: boolean; display_name: string }>(`/backups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name }),
  })
}

export function deleteBackup(id: string): Promise<void> {
  return api(`/backups/${id}`, { method: 'DELETE' })
}

/** 恢复确认面板专用：点击恢复后才加载，不参与首屏请求。 */
export function previewBackup(id: string): Promise<BackupPreview> {
  return api(`/backups/${id}/preview`)
}

export function restoreBackup(id: string): Promise<{ ok: boolean; restored_bookmarks: number }> {
  return api(`/backups/${id}/restore`, { method: 'POST' })
}
