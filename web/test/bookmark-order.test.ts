import assert from 'node:assert/strict'
import test from 'node:test'
import { getBookmarkDropPosition, moveBookmarkInList } from '../src/lib/bookmark-order.ts'

test('classifies bookmark drops by the target card midpoint', () => {
  const rect = { left: 100, width: 200 } as DOMRect
  assert.equal(getBookmarkDropPosition(199, rect), 'before')
  assert.equal(getBookmarkDropPosition(201, rect), 'after')
})

test('moves the persisted bookmark order without mutating the source list', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(moveBookmarkInList(items, 1, 3, 'after').map((item) => item.id), [2, 3, 1])
  assert.deepEqual(items.map((item) => item.id), [1, 2, 3])
})
