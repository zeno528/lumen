import assert from 'node:assert/strict'
import test from 'node:test'
import * as hotkeys from '../src/lib/hotkeys.ts'

test('Ctrl plus comma opens settings without accepting modifier variants', () => {
  assert.equal('isSettingsShortcut' in hotkeys && hotkeys.isSettingsShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: 'Comma' }), true)
  assert.equal('isSettingsShortcut' in hotkeys && hotkeys.isSettingsShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, code: 'Unidentified', key: '，' }), true)
  assert.equal('isSettingsShortcut' in hotkeys && hotkeys.isSettingsShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, code: 'Comma' }), true)
  assert.equal('isSettingsShortcut' in hotkeys && hotkeys.isSettingsShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, code: 'Comma' }), false)
})
