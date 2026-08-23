import assert from 'node:assert/strict'
import test from 'node:test'
import { getCategoryDropAction } from '../src/lib/category-order.ts'

test('classifies category drops by the target card zones', () => {
  assert.equal(getCategoryDropAction(10, 100, true), 'before')
  assert.equal(getCategoryDropAction(50, 100, true), 'inside')
  assert.equal(getCategoryDropAction(90, 100, true), 'after')
  assert.equal(getCategoryDropAction(50, 100, false), 'after')
})
