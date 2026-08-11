export const UPLOADED_AVATAR_KEY = 'custom:upload'
export const AVATAR_UPLOAD_SIZES = [128, 112, 96, 80, 64] as const

export function isCustomAvatar(raw?: string | null): boolean {
  return raw === UPLOADED_AVATAR_KEY
}

export function getCustomAvatarUrl(raw?: string | null, uploadedImage?: string): string | null {
  return isCustomAvatar(raw) && (
    uploadedImage?.startsWith('data:image/webp;base64,') || uploadedImage?.startsWith('data:image/png;base64,')
  ) ? uploadedImage : null
}

export function preloadAvatarImage(url: string | null): void {
  if (!url) return
  const image = new Image()
  image.src = url
  try {
    void image.decode().catch(() => {})
  } catch {
    // 不支持 decode 时让 <img> 自己处理。
  }
}
