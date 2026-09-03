import assert from 'node:assert/strict'
import test from 'node:test'
import { getBookmarkCategoryOptions, getCategoryCount, getParentCategoryOptions } from '../src/lib/category-tree.ts'

const bookmarks = [
  { id: 1, category_id: 1 },
  { id: 2, category_id: 1 },
  { id: 3, category_id: 2 },
  { id: 4, category_id: null },
]

test('category counts stay direct in the flat model', () => {
  assert.equal(getCategoryCount(bookmarks, 1), 2)
  assert.equal(getCategoryCount(bookmarks, 2), 1)
})

test('parent category options retain child context without making children selectable', () => {
  const options = getParentCategoryOptions([
    { id: 1, name: '服务器', icon: '', color: '', sort_order: 1, parent_id: null },
    { id: 2, name: '健康', icon: '', color: '', sort_order: 2, parent_id: 1 },
    { id: 3, name: '开发工具', icon: '', color: '', sort_order: 3, parent_id: null },
  ])

  assert.deepEqual(
    options.map(({ category, selectable, ...treePresentation }) => [
      category.name,
      selectable,
      Object.keys(treePresentation),
    ]),
    [
      ['服务器', true, []],
      ['健康', false, []],
      ['开发工具', true, []],
    ],
  )
})

test('bookmark category options indent selectable children while retaining their full path', () => {
  const options = getBookmarkCategoryOptions([
    { id: 1, name: '服务器', icon: '', color: '', sort_order: 1, parent_id: null },
    { id: 2, name: '健康', icon: '', color: '', sort_order: 2, parent_id: 1 },
  ])

  assert.deepEqual(
    options.map(({ category, label, displayLabel }) => [category.name, label, displayLabel]),
    [
      ['服务器', '服务器', '服务器'],
      ['健康', '服务器/健康', '　└ 健康'],
    ],
  )
})
