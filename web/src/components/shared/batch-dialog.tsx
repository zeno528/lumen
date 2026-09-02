import { useEffect, useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { DEFAULT_COLOR } from '@/components/shared/category-dialog'
import { useCategories, useCreateCategory } from '@/hooks/useCategories'
import {
  useBatchMove,
  useBatchAddTags,
  useBookmarks,
} from '@/hooks/useBookmarks'
import { useUIStore } from '@/stores/ui'
import { parseTags } from '@/lib/bookmark-utils'
import type { Category } from '@/types'
import { buildCategoryTree, getAggregatedCount, getCategoryCount } from '@/lib/category-tree'
import { resolveCategoryIcon } from '@/lib/icon-map'

/**
 * 批量操作对话框 —— 移动分类 / 加标签 / 移除已有标签。
 *
 * 产品契约：批量移动 / 加标签 / 移除标签；已有标签 = 选中书签交集。
 * 实现走新架构：Dialog + Label + Combobox + Input + Button 统一组件。
 */
export function BatchDialog({
  open,
  mode,
  ids,
  onClose,
  onToast,
}: {
  open: boolean
  mode: 'move' | 'tags'
  ids: number[]
  onClose: () => void
  onToast: (msg: string, type?: 'success' | 'error' | 'warning') => void
}) {
  const { data: catData } = useCategories()
  const { data: bmData } = useBookmarks()
  const batchMove = useBatchMove()
  const createCat = useCreateCategory()
  const clearSelection = useUIStore((s) => s.clearSelection)
  const batchTags = useBatchAddTags()
  const categories = catData?.categories ?? []
  const [categoryId, setCategoryId] = useState<string>('')
  const [tagsStr, setTagsStr] = useState('')
  // 「移到新分类」：内嵌展开名称输入（不另开 Dialog，避免模态框堆叠引发 ESC/遮罩层级 bug）
  const [newCatInline, setNewCatInline] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  // 打开时重置输入态（组件常驻 mount，避免上次展开状态/输入残留到下次打开）
  useEffect(() => {
    if (!open) return
    setNewCatInline(false)
    setNewCatName('')
    setTagsStr('')
  }, [open])

  // 批量加标签模式：弹窗打开后自动聚焦到标签输入框。autoFocus 在 createPortal+350ms
  // 入场动画下不稳（mount 时元素 transform: scale(0)，focus call 时机易失效），
  // 改用 ref + 100ms 延迟 focus 给模态层挂载 + active 类加完留缓冲；仅在 tags 模式下触发
  const tagsInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open || mode !== 'tags') return
    const t = window.setTimeout(() => tagsInputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [open, mode])

  const submit = async () => {
    // 批量移动：乐观更新（useBatchMove 已在 onMutate 同步改缓存，卡片秒移到目标分类）。
    // 立即关 + 立即弹，后台 PUT；失败 hook onError 回滚缓存 + 这里补错误通知。
    if (mode === 'move') {
      onClose()
      onToast(`已移动 ${ids.length} 个书签`, 'success')
      try {
        await batchMove.mutateAsync({
          ids,
          categoryId: categoryId ? Number(categoryId) : null,
        })
        // 移动成功后清掉这批选中（批量模式保留，方便继续选下一批）；失败不清，留着重试
        clearSelection()
      } catch (e) {
        onToast('操作失败: ' + (e as Error).message, 'error')
      }
      return
    }
    // 批量加标签：useBatchAddTags 已乐观（onMutate 给 ids 并集加标签，UI 秒变）。
    // 立即关 + 立即弹，后台 POST；失败 hook onError 回滚 + 这里补错误通知。
    const tags = parseTags(tagsStr)
    if (tags.length === 0) {
      onToast('请输入标签', 'warning')
      return
    }
    onClose()
    onToast(`已为 ${ids.length} 个书签添加标签`, 'success')
    try {
      await batchTags.mutateAsync({ ids, tags })
    } catch (e) {
      onToast('操作失败: ' + (e as Error).message, 'error')
    }
  }

  // 「移到新分类」：内嵌输入名称 -> 创建分类（默认图标/颜色）-> 直接把这批书签移过去（一步到位，免再选）。
  // 与 submit 同模式：先关弹窗 + 立即弹通知，后台 创建+移动；失败补错误通知。
  const createAndMove = async () => {
    const trimmed = newCatName.trim()
    if (!trimmed) {
      onToast('请输入分类名称', 'warning')
      return
    }
    onClose()
    onToast(`已移动 ${ids.length} 个书签到新分类`, 'success')
    try {
      const cat = await createCat.mutateAsync({
        name: trimmed,
        color: DEFAULT_COLOR,
      })
      await batchMove.mutateAsync({ ids, categoryId: cat.id })
      clearSelection()
    } catch (e) {
      onToast('操作失败: ' + (e as Error).message, 'error')
    }
  }

  const saving =
    batchMove.isPending ||
    batchTags.isPending ||
    createCat.isPending

  /* Ctrl+Enter 快捷键保存（通过 uiStore token 触发）*/
  const submitRef = useRef(submit)
  useEffect(() => {
    submitRef.current = submit
  }, [submit])
  const batchDialogSubmitToken = useUIStore((s) => s.batchDialogSubmitToken)
  useEffect(() => {
    if (!open || batchDialogSubmitToken === 0) return
    submitRef.current()
  }, [open, batchDialogSubmitToken])

  // 树形选项：子分类缩进挂在父分类下（前缀标层级），父分类计数聚合（自身 + 子分类）。
  // 图标 / 颜色与 sidebar / category-dialog 父分类下拉一致（lucide icon + 分类色）
  const bookmarks = bmData?.bookmarks ?? []
  const tree = buildCategoryTree(categories)
  const withIcon = (c: Category) => {
    const Icon = resolveCategoryIcon(c.icon)
    return {
      icon: <Icon size={14} style={{ color: c.color || 'var(--default-category-color)' }} />,
    }
  }
  const moveOptions = [
    { value: '', label: '移除分类（不归类）' },
    ...tree.roots.flatMap((parent) => [
      {
        value: String(parent.id),
        label: `${parent.name}（${getAggregatedCount(bookmarks, parent.id, tree.childIds(parent.id))}）`,
        ...withIcon(parent),
      },
      ...tree.childrenOf(parent.id).map((child) => ({
        value: String(child.id),
        label: `　└ ${child.name}（${getCategoryCount(bookmarks, child.id)}）`,
        ...withIcon(child),
      })),
    ]),
  ]

  // 选中书签的来源分类分布（category_id=null 归「未分类」）：让用户看清这批书签
  // 现在都在哪些分类，避免又移回原分类
  const selectedIdSet = new Set(ids)
  const sourceCounts = new Map<number | null, number>()
  for (const b of bookmarks) {
    if (!selectedIdSet.has(b.id)) continue
    sourceCounts.set(b.category_id, (sourceCounts.get(b.category_id) ?? 0) + 1)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'move' ? '移动到分类' : '批量标签'}
      footer={
        <>
          {mode === 'move' && (
            <Button
              variant={newCatInline ? 'soft' : 'outline'}
              className="mr-auto"
              onClick={() => setNewCatInline((v) => !v)}
              disabled={saving}
            >
              <FolderPlus size={14} /> 移到新分类
            </Button>
          )}
          <Button variant="soft" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={saving || (mode === 'tags' && ids.length === 0)}
          >
            {saving ? '处理中…' : '确定'}
          </Button>
        </>
      }
    >
      {mode === 'move' ? (
        <div className="flex flex-col gap-1.5">
          {/* 来源分类分布：中性胶囊（图标带分类色，计数弱化）。
              不复用 .bookmark-tag：其 unlayered display:inline-block 会压掉 utility 的
              inline-flex，图标+文字的多子元素胶囊必须真 flex 才不叠字。 */}
          <Label>当前所在分类</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {[...sourceCounts.entries()].map(([catId, count]) => {
              const cat = catId != null ? categories.find((c) => c.id === catId) : undefined
              const Icon = cat ? resolveCategoryIcon(cat.icon) : null
              return (
                <span
                  key={catId ?? 'none'}
                  className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-(--bg-secondary) border border-(--border) text-[0.72rem] font-medium text-(--text-secondary)"
                >
                  {Icon && (
                    <Icon
                      size={12}
                      style={{ color: cat?.color || 'var(--default-category-color)' }}
                    />
                  )}
                  {cat?.name ?? '未分类'}
                  <span className="text-(--text-muted)">× {count}</span>
                </span>
              )
            })}
          </div>
          <Label>目标分类（共 {ids.length} 个书签）</Label>
          {/* 全局 Combobox（readOnly，与分类父分类框/备份间隔同一套下拉视觉）。
              Combobox 以 label 为值：显示用 moveOptions 里按 id 反查的 label，
              选回后按 label 反查 option 拿回 id（moveOptions 含「移除分类」哨兵，映射总成立）。 */}
          <Combobox
            readOnly
            value={moveOptions.find((o) => o.value === categoryId)?.label ?? ''}
            onChange={(label) =>
              setCategoryId(moveOptions.find((o) => o.label === label)?.value ?? '')
            }
            options={moveOptions}
            listMaxHeight={360}
          />
          {newCatInline && (
            <div className="flex flex-col gap-1.5 p-2.5 rounded-md border border-(--border) bg-(--bg-secondary)">
              <Label htmlFor="new-cat-name">新建分类并移动</Label>
              <div className="flex gap-1.5">
                <Input
                  id="new-cat-name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="输入新分类名称"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault()
                      createAndMove()
                    }
                  }}
                />
                <Button
                  className="h-auto"
                  onClick={createAndMove}
                  disabled={!newCatName.trim() || saving}
                >
                  创建并移动
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batch-tags">添加新标签（Tab 追加逗号）</Label>
            <Input
              id="batch-tags"
              ref={tagsInputRef}
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="工具, 开发, 学习"
              onKeyDown={(e) => {
                // Enter 保存（Ctrl/Cmd+Enter 由全局快捷键处理）
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  submitRef.current()
                  return
                }
                // Tab 追加英文逗号分隔标签（回车让给保存；Tab 不是字符键、IME 不处理，preventDefault 安全）
                if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault()
                  if (!tagsStr.trimEnd().endsWith(',')) {
                    setTagsStr((prev) => prev.trimEnd() + ', ')
                  }
                }
              }}
            />
          </div>
        </div>
      )}
    </Dialog>
  )
}
