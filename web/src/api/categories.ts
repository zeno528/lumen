import { api } from './client'
import type { Category, CategoriesResponse, CategoryInput } from '@/types'

/** GET /api/categories —— 全部分类（按 sort_order）*/
export function getCategories(): Promise<CategoriesResponse> {
  return api('/categories')
}

/** POST /api/categories —— 新建分类，返回后端创建的完整对象 */
export async function createCategory(input: CategoryInput): Promise<Category> {
  const res = await api<{ category: Category }>('/categories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.category
}

/** PUT /api/categories/{id} —— 改 name/icon/color */
export function updateCategory(
  id: number,
  input: CategoryInput,
): Promise<{ ok: boolean }> {
  return api(`/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** DELETE /api/categories/{id} —— 关联书签由后端 ON DELETE SET NULL 自动变未分类 */
export function deleteCategory(id: number): Promise<{ ok: boolean }> {
  return api(`/categories/${id}`, { method: 'DELETE' })
}

/** DELETE /api/categories/batch -- 批量删除分类，书签变未分类（ON DELETE SET NULL）*/
export function batchDeleteCategories(ids: number[]): Promise<{ ok: boolean; deleted: number }> {
  return api('/categories/batch', { method: 'DELETE', body: JSON.stringify({ ids }) })
}

/** 重排分类顺序（PUT /api/categories/reorder，body {order:[ids]}，categories.go:250）*/
export function reorderCategories(order: number[]): Promise<{ ok: boolean }> {
  return api('/categories/reorder', { method: 'PUT', body: JSON.stringify({ order }) })
}
