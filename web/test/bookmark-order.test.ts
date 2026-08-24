import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBookmarkDropPosition,
  moveBookmarkToIndex,
} from '../src/lib/bookmark-order.ts'

test('classifies bookmark drops by the target card midpoint', () => {
  const rect = { left: 100, width: 200 } as DOMRect
  assert.equal(getBookmarkDropPosition(199, rect), 'before')
  assert.equal(getBookmarkDropPosition(201, rect), 'after')
})

test('moves a bookmark to the projected sortable index within its category', () => {
  const items = [
    { id: 1, category_id: 9 },
    { id: 2, category_id: 8 },
    { id: 3, category_id: 9 },
  ]
  assert.deepEqual(
    moveBookmarkToIndex(items, 9, 1, 1).map((item) => item.id),
    [3, 2, 1],
  )
})
