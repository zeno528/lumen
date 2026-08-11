import assert from 'node:assert/strict'
import test from 'node:test'
import { saveAvatarCache } from '../src/lib/avatar-cache.ts'

test('avatar cache replaces the previous avatar with the server result', () => {
  const originalStorage = globalThis.localStorage
  const values = new Map([['avatar', JSON.stringify({ avatar: 'fa-cat', avatarColor: '#111111' })]])
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })

  try {
    saveAvatarCache({ avatar: 'fa-piggy-bank', avatarColor: '#f59e0b' })
    assert.deepEqual(JSON.parse(values.get('avatar')!), {
      avatar: 'fa-piggy-bank',
      avatarColor: '#f59e0b',
    })
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
  }
})
