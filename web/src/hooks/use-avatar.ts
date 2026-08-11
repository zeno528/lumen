import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAvatar, updateAvatar, type AvatarSettings } from '@/api/settings'
import { saveAvatarCache } from '@/lib/avatar-cache'

const AVATAR_KEY = ['auth-avatar'] as const

/** 当前用户头像（GET /api/auth/avatar） */
export function useAvatar() {
  return useQuery({
    queryKey: AVATAR_KEY,
    queryFn: async () => {
      const avatar = await getAvatar()
      // 其他终端经 WS 刷新的结果也落盘，避免下次刷新仍从旧头像起步。
      saveAvatarCache(avatar)
      return avatar
    },
  })
}

/** 修改头像（PUT /api/auth/avatar） */
export function useUpdateAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AvatarSettings) => updateAvatar(body),
    onSuccess: (data) => {
      saveAvatarCache(data)
      qc.invalidateQueries({ queryKey: AVATAR_KEY })
    },
  })
}
