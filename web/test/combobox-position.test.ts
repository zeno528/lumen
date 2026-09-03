import assert from 'node:assert/strict'
import test from 'node:test'
import { getDropdownPlacement } from '../src/lib/combobox-position.ts'

test('dropdown opens upward when the requested height does not fit below', () => {
  assert.deepEqual(
    getDropdownPlacement({ top: 700, bottom: 744 }, 800, 320),
    { top: 376, maxHeight: 320 },
  )
})

test('dropdown uses the available upper space when neither side fits', () => {
  assert.deepEqual(
    getDropdownPlacement({ top: 300, bottom: 344 }, 500, 320),
    { top: 8, maxHeight: 288 },
  )
})
