import assert from 'node:assert/strict'
import test from 'node:test'
import { getCustomAvatarUrl, isCustomAvatar } from '../src/lib/avatar-icons.ts'

test('only uploaded avatars are treated as custom images', () => {
  const uploaded = 'data:image/webp;base64,UklGRgAAAABXRUJQ'
  assert.equal(isCustomAvatar('custom:upload'), true)
  assert.equal(isCustomAvatar('custom:default.webp'), false)
  assert.equal(isCustomAvatar('custom-duck.webp'), false)
  assert.equal(getCustomAvatarUrl('custom:upload', uploaded), uploaded)
  assert.equal(getCustomAvatarUrl('custom:default.webp'), null)
})
