import assert from 'node:assert/strict'
import test from 'node:test'
import { getCategoryDropAction, moveCategoryToIndex } from '../src/lib/category-order.ts'

test('classifies flat category drops by the target card midpoint', () => {
  assert.equal(getCategoryDropAction(10, 100), 'before')
  assert.equal(getCategoryDropAction(50, 100), 'after')
  assert.equal(getCategoryDropAction(90, 100), 'after')
})

test('moves a category to the projected sortable index', () => {
  const categories = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  assert.deepEqual(moveCategoryToIndex(categories, 1, 3).map((category) => category.id), [2, 3, 4, 1])
})
