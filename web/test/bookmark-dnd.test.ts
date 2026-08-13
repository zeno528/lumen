import test from 'node:test'
import assert from 'node:assert/strict'
import { getBookmarkDropPosition, getDraggedBookmarkIds, moveBookmarkInList } from '../src/lib/bookmark-dnd.ts'
import { getAutoScrollDelta } from '../src/lib/bookmark-auto-scroll.ts'
import type { Bookmark } from '../src/types.ts'

const bookmarks = [1, 2, 3].map((id) => ({ id, category_id: id === 3 ? 2 : 1 })) as Bookmark[]

test('bookmark drop uses horizontal card halves', () => {
  const rect = { left: 100, width: 300 } as DOMRect
  assert.equal(getBookmarkDropPosition(249, rect), 'before')
  assert.equal(getBookmarkDropPosition(250, rect), 'after')
})

test('multi-bookmark drag keeps visible order', () => {
  assert.deepEqual(getDraggedBookmarkIds(bookmarks, new Set([3, 1]), 3), { ids: [1, 3], isBatch: true })
  assert.deepEqual(getDraggedBookmarkIds(bookmarks, new Set([1, 3]), 2), { ids: [2], isBatch: false })
})

test('reorder honors the before/after drop side', () => {
  assert.deepEqual(moveBookmarkInList(bookmarks, 1, 3, 'before').map((b) => b.id), [2, 1, 3])
  assert.deepEqual(moveBookmarkInList(bookmarks, 1, 3, 'after').map((b) => b.id), [2, 3, 1])
  assert.deepEqual(moveBookmarkInList(bookmarks, 3, 1, 'before').map((b) => b.id), [3, 1, 2])
  assert.deepEqual(moveBookmarkInList(bookmarks, 3, 1, 'after').map((b) => b.id), [1, 3, 2])
  assert.equal(moveBookmarkInList(bookmarks, 1, 1, 'after'), bookmarks)
  assert.equal(moveBookmarkInList(bookmarks, 9, 1, 'before'), bookmarks)
})

test('auto-scroll accelerates toward the active edge only', () => {
  const rect = { top: 100, bottom: 700 } as DOMRect
  assert.equal(getAutoScrollDelta(400, rect, 400), 0)
  assert.ok(getAutoScrollDelta(105, rect, 400) < 0)
  assert.ok(getAutoScrollDelta(695, rect, 400) > 0)
  assert.ok(Math.abs(getAutoScrollDelta(695, rect, 400)) > Math.abs(getAutoScrollDelta(650, rect, 400)))
})
