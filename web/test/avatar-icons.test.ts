import assert from 'node:assert/strict'
import test from 'node:test'
import * as avatarUpload from '../src/lib/avatar-upload.ts'
import { getCustomAvatarUrl, isCustomAvatar } from '../src/lib/avatar-upload.ts'

test('only uploaded avatars are treated as custom images', () => {
  const uploaded = 'data:image/webp;base64,UklGRgAAAABXRUJQ'
  assert.equal(isCustomAvatar('custom:upload'), true)
  assert.equal(isCustomAvatar('custom:default.webp'), false)
  assert.equal(isCustomAvatar('custom-duck.webp'), false)
  assert.equal(getCustomAvatarUrl('custom:upload', uploaded), uploaded)
  assert.equal(getCustomAvatarUrl('custom:upload', 'data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(getCustomAvatarUrl('custom:default.webp'), null)
})

test('PNG fallback retries smaller avatar dimensions', () => {
  assert.deepEqual(avatarUpload.AVATAR_UPLOAD_SIZES, [128, 112, 96, 80, 64])
})

test('avatar predecode starts without waiting for decoding', () => {
  let started = false
  const OriginalImage = globalThis.Image
  class PendingImage {
    set src(_: string) {}
    decode() {
      started = true
      return new Promise<void>(() => {})
    }
  }
  globalThis.Image = PendingImage as unknown as typeof Image
  try {
    assert.equal(avatarUpload.preloadAvatarImage('data:image/png;base64,iVBORw0KGgo='), undefined)
    assert.equal(started, true)
  } finally {
    globalThis.Image = OriginalImage
  }
})
