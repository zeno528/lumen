import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAvatar, updateAvatar, type AvatarSettings } from '@/api/settings'

const AVATAR_KEY = ['auth-avatar'] as const

/** 当前用户头像（GET /api/auth/avatar） */
export function useAvatar() {
  return useQuery({
    queryKey: AVATAR_KEY,
    queryFn: getAvatar,
  })
}

/** 修改头像（PUT /api/auth/avatar） */
export function useUpdateAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AvatarSettings) => updateAvatar(body),
    onSuccess: (_data, body) => {
      // 同步写 localStorage，供下次首屏 hydration 用（避免头像闪烁）
      try {
        localStorage.setItem('avatar', JSON.stringify(body))
      } catch { /* quota 等不影响功能 */ }
      qc.invalidateQueries({ queryKey: AVATAR_KEY })
    },
  })
}
