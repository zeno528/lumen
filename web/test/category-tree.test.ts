import assert from 'node:assert/strict'
import test from 'node:test'
import { getCategoryDescendantIds, filterBookmarksByCategory, getCategoryCount, hasCategoryChildren } from '../src/lib/category-tree.ts'

const categories = [
  { id: 1, name: '开发', icon: 'fa-folder', color: '', sort_order: 0, parent_id: null },
  { id: 2, name: '编辑器', icon: 'fa-folder', color: '', sort_order: 1, parent_id: 1 },
  { id: 3, name: '终端', icon: 'fa-folder', color: '', sort_order: 2, parent_id: 1 },
  { id: 4, name: '设计', icon: 'fa-folder', color: '', sort_order: 3, parent_id: null },
]

const bookmarks = [
  { id: 1, category_id: 1 },
  { id: 2, category_id: 2 },
  { id: 3, category_id: 3 },
  { id: 4, category_id: 4 },
  { id: 5, category_id: null },
]

test('parent category descendants include only its direct children', () => {
  assert.deepEqual(getCategoryDescendantIds(categories, 1), [2, 3])
  assert.deepEqual(getCategoryDescendantIds(categories, 4), [])
})

test('parent view aggregates direct and child bookmarks while child view stays direct', () => {
  assert.deepEqual(filterBookmarksByCategory(bookmarks, categories, 1).map((b) => b.id), [1, 2, 3])
  assert.deepEqual(filterBookmarksByCategory(bookmarks, categories, 2).map((b) => b.id), [2])
})

test('parent count includes direct and child bookmarks', () => {
  assert.equal(getCategoryCount(bookmarks, categories, 1), 3)
  assert.equal(getCategoryCount(bookmarks, categories, 2), 1)
})

test('only parent categories report child categories', () => {
  assert.equal(hasCategoryChildren(categories, 1), true)
  assert.equal(hasCategoryChildren(categories, 2), false)
})
