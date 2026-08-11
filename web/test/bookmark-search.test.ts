import assert from 'node:assert/strict'
import test from 'node:test'
import { bookmarkMatchesSearch, getIdFromQuery } from '../src/lib/bookmark-search.ts'

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

test('bookmark search splits CJK/Latin keywords without spaces', () => {
  const mixed = {
    ...bookmark,
    title: 'GitHub 下载加速',
    description: '',
    url: 'https://example.com',
    tags: [],
  }
  assert.equal(bookmarkMatchesSearch(mixed, undefined, 'github下载', false), true)
  assert.equal(bookmarkMatchesSearch(mixed, undefined, '下载github', false), true)
  assert.equal(bookmarkMatchesSearch(mixed, undefined, 'github部署', false), false)
  // 版本号等带点的连续串保持为一个词，不被误拆
  const versioned = { ...mixed, title: 'React18.2 指南' }
  assert.equal(bookmarkMatchesSearch(versioned, undefined, 'react18.2指南', false), true)
})

test('bookmark search preserves digit and #ID exact matching', () => {
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '42', true), true)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '4', true), false)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '#42', false), true)
  assert.equal(bookmarkMatchesSearch(bookmark, 'Engineering', '#4', false), false)
})

test('getIdFromQuery parses ID targets for Enter-to-open', () => {
  assert.equal(getIdFromQuery('253', true), 253)
  assert.equal(getIdFromQuery('#253', false), 253)
  assert.equal(getIdFromQuery('253', false), null)
  assert.equal(getIdFromQuery('git', true), null)
  assert.equal(getIdFromQuery('', true), null)
})
