import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBookmarkSearch } from '../src/lib/bookmark-route.ts'

test('bookmark route accepts a positive category ID', () => {
  assert.deepEqual(parseBookmarkSearch({ category: '573' }), { category: 573 })
})

test('bookmark route accepts supported virtual views only', () => {
  assert.deepEqual(parseBookmarkSearch({ view: 'favorites' }), { view: 'favorites' })
  assert.deepEqual(parseBookmarkSearch({ view: 'uncategorized' }), { view: 'uncategorized' })
  assert.deepEqual(parseBookmarkSearch({ view: 'unknown' }), {})
})

test('bookmark route ignores invalid category IDs', () => {
  assert.deepEqual(parseBookmarkSearch({ category: '0' }), {})
  assert.deepEqual(parseBookmarkSearch({ category: '5.5' }), {})
  assert.deepEqual(parseBookmarkSearch({ category: 'abc' }), {})
})
