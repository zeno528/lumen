import assert from 'node:assert/strict'
import test from 'node:test'
import { THEME_OPTIONS, parseThemePreference, resolveTheme } from '../src/lib/theme.ts'

test('theme pickers expose the three explicit choices with system first', () => {
  assert.deepEqual(
    THEME_OPTIONS.map(({ value, label }) => [value, label]),
    [
      ['system', '跟随系统'],
      ['light', '浅色'],
      ['notion-dark', '深色'],
    ],
  )
})

test('theme preference keeps explicit choices and migrates the legacy dark value', () => {
  assert.equal(parseThemePreference('light'), 'light')
  assert.equal(parseThemePreference('notion-dark'), 'notion-dark')
  assert.equal(parseThemePreference('system'), 'system')
  assert.equal(parseThemePreference('dark'), 'notion-dark')
  assert.equal(parseThemePreference('unknown'), 'light')
})

test('system preference resolves to the current operating-system appearance', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('notion-dark', false), 'notion-dark')
  assert.equal(resolveTheme('system', true), 'notion-dark')
  assert.equal(resolveTheme('system', false), 'light')
})
