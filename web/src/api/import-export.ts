
/**
 * 导入导出 —— 后端 server/import_export.go。
 * - GET /api/export → 返回 JSON（Content-Disposition 触发下载，api 客户端返回文本，调用方 blob 化下载）
 * - POST /api/import?mode=merge|overwrite，multipart/form-data 上传 file
 */

function getToken(): string {
  try {
    return JSON.parse(localStorage.getItem('lumen-auth') || '{}')?.state?.token || ''
  } catch {
    return ''
  }
}

/** 导入文件 */
export async function importBookmarks(
  file: File,
  mode: 'merge' | 'overwrite' = 'merge',
): Promise<{ ok: boolean; imported?: number; skipped?: number; imported_ids?: number[]; imported_categories?: string[]; skipped_categories?: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/import?mode=${mode}`, {
    method: 'POST',
    body: form,
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    let msg = `导入失败 (${res.status})`
    try {
      const data = await res.json()
      msg = data.error ?? msg
    } catch {
      /* 忽略 */
    }
    throw new Error(msg)
  }
  return res.json()
}

