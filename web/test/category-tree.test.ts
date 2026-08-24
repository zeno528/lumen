import assert from 'node:assert/strict'
import test from 'node:test'
import { getCategoryCount } from '../src/lib/category-tree.ts'

const bookmarks = [
  { id: 1, category_id: 1 },
  { id: 2, category_id: 1 },
  { id: 3, category_id: 2 },
  { id: 4, category_id: null },
]

test('category counts stay direct in the flat model', () => {
  assert.equal(getCategoryCount(bookmarks, 1), 2)
  assert.equal(getCategoryCount(bookmarks, 2), 1)
})
