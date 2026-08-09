import assert from 'node:assert/strict'
import test from 'node:test'
import { bookmarkMatchesSearch } from '../src/lib/bookmark-search.ts'

const bookmark = {
  id: 42,
  title: 'Release notes',
  description: 'Reliable deployment guide',
  url: 'https://example.com/docs/precision-search',
  tags: ['release', 'Go'],
}

test('bookmark search matches its category name', () => {
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', 'engineering', false), true)
})

test('bookmark search requires every whitespace term across searchable fields', () => {
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', 'release precision', false), true)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', 'release missing', false), false)
})

test('bookmark search preserves digit and #ID exact matching', () => {
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '42', true), true)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '4', true), false)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '#42', false), true)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '#4', false), false)
})
