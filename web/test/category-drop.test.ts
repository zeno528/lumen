import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getCategoryDropAction,
  makeDragId,
} from '../src/lib/category-dnd.ts'

test('category drop uses card edges for reorder and its center for nesting', () => {
  assert.deepEqual(getCategoryDropAction(4, 40, true), { kind: 'reorder', position: 'before' })
  assert.deepEqual(getCategoryDropAction(20, 40, true), { kind: 'make-child' })
  assert.deepEqual(getCategoryDropAction(36, 40, true), { kind: 'reorder', position: 'after' })
})

test('categories with children keep the whole card as reorder-only', () => {
  assert.deepEqual(getCategoryDropAction(20, 40, false), { kind: 'reorder', position: 'after' })
})

test('dnd-kit ids preserve the entity kind without DataTransfer', () => {
  assert.equal(makeDragId('bookmark', 7), 'bookmark:7')
  assert.equal(makeDragId('category', 9), 'category:9')
})
