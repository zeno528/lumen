export const UPLOADED_AVATAR_KEY = 'custom:upload'

export function isCustomAvatar(raw?: string | null): boolean {
  return raw === UPLOADED_AVATAR_KEY
}

export function getCustomAvatarUrl(raw?: string | null, uploadedImage?: string): string | null {
  return isCustomAvatar(raw) && (
    uploadedImage?.startsWith('data:image/webp;base64,') || uploadedImage?.startsWith('data:image/png;base64,')
  ) ? uploadedImage : null
}
