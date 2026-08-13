import test from 'node:test'
import assert from 'node:assert/strict'
import { getCategoryDropAction, getDragId, hasDragType, setDragId } from '../src/lib/category-dnd.ts'

test('category drop uses card edges for reorder and its center for nesting', () => {
  assert.deepEqual(getCategoryDropAction(4, 40, true), { kind: 'reorder', position: 'before' })
  assert.deepEqual(getCategoryDropAction(20, 40, true), { kind: 'make-child' })
  assert.deepEqual(getCategoryDropAction(36, 40, true), { kind: 'reorder', position: 'after' })
})

test('categories with children keep the whole card as reorder-only', () => {
  assert.deepEqual(getCategoryDropAction(20, 40, false), { kind: 'reorder', position: 'after' })
})

test('drag payload keeps its dedicated MIME type with a plain-text fallback', () => {
  const values = new Map<string, string>()
  const dataTransfer = {
    effectAllowed: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
  } as unknown as DataTransfer
  setDragId(dataTransfer, 'application/x-category-id', 7)
  assert.equal(getDragId(dataTransfer, 'application/x-category-id'), 7)
  assert.equal(dataTransfer.getData('text/plain'), '7')
})

test('bookmark drag remains distinguishable when it shares a plain-text fallback with categories', () => {
  const types = ['application/x-bookmark-id', 'text/plain']
  assert.equal(hasDragType(types, 'application/x-bookmark-id'), true)
  assert.equal(hasDragType(types, 'application/x-category-id'), false)
})
