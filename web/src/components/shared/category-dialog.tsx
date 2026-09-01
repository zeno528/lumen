import { Fragment, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { useCategories, useCreateCategory, useUpdateCategory } from '@/hooks/useCategories'
import { buildCategoryTree } from '@/lib/category-tree'
import { ICON_GROUPS, PRESET_COLORS, resolveCategoryIcon } from '@/lib/icon-map'
import { toast } from '@/components/ui/toast'
import { useUIStore } from '@/stores/ui'
import type { Category } from '@/types'
import { cn } from '@/lib/utils'

const LAST_COLOR_KEY = 'lastCategoryColor'
export const DEFAULT_COLOR = '#FFA344'

/**
 * 分类新增/编辑模态框。
 *
 * 实现走新架构：Dialog + Input + Label + Button 统一组件，
 * 图标网格和颜色板保持原有视觉逻辑。
 */
export function CategoryDialog({
  open,
  onClose,
  editingCategory,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  editingCategory?: Category | null
  onCreated?: (id: number) => void
}) {
  const createMut = useCreateCategory()
  const updateMut = useUpdateCategory()
  const { data: catData } = useCategories()
  const categories = catData?.categories ?? []
  const tree = buildCategoryTree(categories)
  // 右键「新建子分类」带来的预设父分类（仅 create 分支消费）
  const presetParentId = useUIStore((s) => s.categoryDialogParentId)

  const [name, setName] = useState('')
  const [icon, setIcon] = useState('fa-folder')
  const [color, setColor] = useState(DEFAULT_COLOR)
  // 父分类（'' = 顶级）。编辑含子分类的父分类时锁死为顶级（保持两级约束）
  const [parentId, setParentId] = useState('')
  const [idCopied, setIdCopied] = useState(false)

  const editingChildIds = editingCategory ? tree.childIds(editingCategory.id) : []
  const editingHasChildren = editingChildIds.length > 0
  // 父分类候选：全部顶级分类；编辑时排除自己。
  // 图标 / 颜色与 mobile-category-select / sidebar 一致（lucide icon + 分类色）
  const parentOptions = tree.roots
    .filter((c) => c.id !== editingCategory?.id)
    .map((c) => {
      const Icon = resolveCategoryIcon(c.icon)
      return {
        value: String(c.id),
        label: c.name,
        icon: <Icon size={14} style={{ color: c.color || 'var(--default-category-color)' }} />,
      }
    })

  useEffect(() => {
    if (!open) return
    if (editingCategory) {
      setName(editingCategory.name)
      setIcon(editingCategory.icon || 'fa-folder')
      setColor(editingCategory.color || DEFAULT_COLOR)
      setParentId(editingCategory.parent_id != null ? String(editingCategory.parent_id) : '')
    } else {
      setName('')
      setIcon('fa-folder')
      setColor(localStorage.getItem(LAST_COLOR_KEY) || DEFAULT_COLOR)
      setParentId(presetParentId != null ? String(presetParentId) : '')
    }
    setIdCopied(false)
  }, [open, editingCategory, presetParentId])

  // 打开时自动 focus 名称输入框
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('#category-name')
      if (el) {
        el.focus()
        if (editingCategory) el.select()
      }
    }, 50)
    return () => window.clearTimeout(t)
  }, [open, editingCategory])

  const pickColor = (c: string) => {
    setColor(c)
    localStorage.setItem(LAST_COLOR_KEY, c)
  }

  const copyId = () => {
    if (!editingCategory) return
    navigator.clipboard.writeText(`分类ID: ${editingCategory.id}`).then(() => {
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 1000)
    })
  }

  const saving = createMut.isPending || updateMut.isPending
  const PreviewIcon = resolveCategoryIcon(icon)
  const colorMatch = (c: string) => color.toUpperCase() === c.toUpperCase()
  // 防重入 + 弹窗关闭后不响应（与 bookmark-dialog 同模式）：submit 是 async +「先 onClose 再 await」乐观关闭，
  // onClose 后 re-render 使 editingCategory 变 null、open 变 false；弹窗退场期间 DOM 还在，此时按回车命中新
  // submit（editingCategory=null）会走错分支（编辑当新建）+ 重复通知。两道闸：① !open 拦退场期间 submit；
  // ② submittingRef 拦同一次 open 内并发。
  const submittingRef = useRef(false)

  const submit = async () => {
    if (!open || submittingRef.current) return
    submittingRef.current = true
    try {
      return await runSubmit()
    } finally {
      submittingRef.current = false
    }
  }

  const runSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.warning('请输入分类名称')
      return
    }
    // 父分类约束：编辑含子分类的父分类时不允许选父级（两级封顶，后端同样校验）
    if (editingCategory && editingHasChildren && parentId !== '') {
      toast.warning('该分类包含子分类，不能移到子级')
      return
    }
    const input = {
      name: trimmed,
      icon,
      color,
      parent_id: parentId === '' ? null : Number(parentId),
    }
    // 分类编辑：乐观更新（useUpdateCategory 已在 onMutate 同步改缓存，UI 秒变）。
    // 立即关弹窗 + 立即弹通知，后台 PUT；失败由 hook onError 回滚缓存 + 这里补错误通知。
    if (editingCategory) {
      onClose()
      toast.success('分类已更新')
      try {
        await updateMut.mutateAsync({ id: editingCategory.id, input })
      } catch (e) {
        toast.error('保存失败: ' + (e as Error).message)
      }
      return
    }
    // 分类添加：useCreateCategory 在 onSuccess 用后端真分类 append 到缓存（省掉 refetch 往返）。
    // 立即关弹窗 + 立即弹通知，await POST；响应到达时新分类入列 + onCreated 触发 pop-in。失败补错误通知。
    onClose()
    toast.success('分类已添加')
    try {
      const cat = await createMut.mutateAsync(input)
      onCreated?.(cat.id)
    } catch (e) {
      const msg = (e as Error).message
      toast.error('保存失败: ' + msg)
    }
  }

  /* Ctrl+Enter 快捷键保存（通过 uiStore token 触发） */
  const submitRef = useRef(submit)
  useEffect(() => {
    submitRef.current = submit
  }, [submit])
  const categoryDialogSubmitToken = useUIStore((s) => s.categoryDialogSubmitToken)
  useEffect(() => {
    if (!open || categoryDialogSubmitToken === 0) return
    submitRef.current()
  }, [open, categoryDialogSubmitToken])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editingCategory ? '编辑分类' : '添加分类'}
      headerExtra={
        editingCategory ? (
          <span
            className={cn(
              'inline-flex items-center gap-[3px] px-2.5 py-[3px] mt-0.5 rounded-md ' +
                'border border-(--border) bg-(--bg-secondary) shadow-sm ' +
                'text-(--text-secondary) font-mono text-xs font-medium tracking-[0.4px] ' +
                'cursor-pointer select-none transition-all duration-200 ' +
                'hover:border-(--accent) hover:text-(--accent) hover:bg-[var(--accent-soft-bg)]',
              idCopied && 'border-(--accent) bg-(--accent) text-white',
            )}
            onClick={(e) => {
              e.stopPropagation()
              copyId()
            }}
            title="点击复制 ID"
          >
            {idCopied ? '已复制' : <span>ID:{editingCategory.id}</span>}
          </span>
        ) : null
      }
      footer={
        <>
          <Button variant="soft" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                保存中…
              </>
            ) : (
              '保存'
            )}
          </Button>
        </>
      }
    >
      <div className="mb-5">
        <Label htmlFor="category-name">分类名称</Label>
        <Input
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：工作、学习、娱乐"
          autoFocus
          onKeyDown={(e) => {
            // Enter 保存（不含 Ctrl/Cmd，Ctrl+Enter 由全局快捷键处理
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              submitRef.current()
            }
          }}
        />
      </div>

      {/* 父分类（固定两级）：留空 = 顶级；编辑含子分类的父分类时锁死。
         用全局 Combobox（readOnly）替代旧 Select，trigger 显示分类名，下拉
         沿用 app 的下拉视觉（与书签分类/AI 模型/备份间隔统一）。值用 label
         作 id（同 backup-section 惯例）；同名冲突概率低且显示上等价。 */}
      <div className="mb-5">
        <Label htmlFor="category-parent">父分类（可选，最多两级）</Label>
        <Combobox
          id="category-parent"
          readOnly
          disabled={editingHasChildren}
          value={
            parentId === ''
              ? editingHasChildren
                ? '顶级（含子分类，不可改）'
                : '无（作为顶级分类）'
              : categories.find((c) => String(c.id) === parentId)?.name ?? ''
          }
          onChange={(label) => {
            if (
              label === '无（作为顶级分类）' ||
              label === '顶级（含子分类，不可改）'
            ) {
              setParentId('')
            } else {
              const cat = categories.find((c) => c.name === label)
              setParentId(cat ? String(cat.id) : '')
            }
          }}
          options={[
            { value: '', label: editingHasChildren ? '顶级（含子分类，不可改）' : '无（作为顶级分类）' },
            ...parentOptions,
          ]}
          inputClassName="h-11"
          listMaxHeight={360}
          onClear={() => setParentId('')}
        />
      </div>

      {/* 图标和颜色 */}
      <div className="mb-5">
        <Label>图标和颜色</Label>
        <div className="p-2.5 rounded-[10px] border border-(--border) bg-(--bg-primary)">
          {/* 预览 */}
          <div className="flex justify-center mb-2.5">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200"
              style={{ background: color + '22', color }}
            >
              <PreviewIcon size={22} />
            </div>
          </div>

          {/* 颜色：9 预设色点 + native picker 圆环（hex 输入已删除 — 减负 UI 密度） */}
          <div className="flex justify-between items-center gap-2 p-2.5 rounded-[10px] border border-(--border) bg-(--bg-secondary) mb-2.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'w-[26px] h-[26px] rounded-full border-2 border-white/15 cursor-pointer flex-shrink-0 p-0 transition-all duration-200 hover:scale-120',
                  // #64748B 灰在移动端色板塞不下时溢出，移动端隐藏（桌面 md+ 保留）
                  c === '#64748B' && 'hidden md:flex',
                  colorMatch(c) && '!border-white',
                )}
                style={{
                  backgroundColor: c,
                  ...(colorMatch(c) && {
                    boxShadow: `0 0 0 2px white, 0 0 0 4px ${c}, 0 3px 10px rgba(0, 0, 0, 0.18)`,
                  }),
                }}
                onClick={() => pickColor(c)}
                aria-label={c}
              />
            ))}
            <label
              className="w-[26px] h-[26px] rounded-full border-2 border-white/15 cursor-pointer flex-shrink-0 relative overflow-hidden"
              style={{
                background:
                  'conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444)',
              }}
              title="色环选色（浏览器原生，点击会弹 OS 级对话框，ESC 不一定响应）"
            >
              <input
                type="color"
                className="absolute inset-0 w-full h-full border-none p-0 bg-transparent cursor-pointer opacity-0"
                value={color}
                onChange={(e) => pickColor(e.target.value)}
              />
            </label>
          </div>

          {/* 图标网格 */}
          <div
            className="grid gap-[5px] p-1 max-h-[220px] overflow-y-auto"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))' }}
          >
            {ICON_GROUPS.map((group) => (
              <Fragment key={group.title}>
                <div className="col-span-full text-[0.65rem] font-semibold text-(--text-muted) tracking-[0.5px] pt-2 pb-[3px] px-0.5">
                  {group.title}
                </div>
                {group.icons.map(({ key, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'flex items-center justify-center w-10 h-10 rounded-lg border border-(--border) p-0 cursor-pointer transition-all duration-150 bg-(--bg-secondary) text-(--text-secondary) hover:border-(--accent) hover:scale-108',
                      icon === key && '!border-current',
                    )}
                    style={icon === key ? { background: color + '22', color } : undefined}
                    onClick={() => setIcon(key)}
                    title={key}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
