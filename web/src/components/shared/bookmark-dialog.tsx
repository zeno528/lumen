import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, ExternalLink, Type, FileText, X, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Combobox } from '@/components/ui/combobox'
import { InputWithClear } from './input-with-clear'
import { PasteButton, pasteClipboardText } from './clipboard-paste'
import { useBookmarks, useCreateBookmark, useUpdateBookmark } from '@/hooks/useBookmarks'
import { useCategories, useCreateCategory } from '@/hooks/useCategories'
import { fetchPageTitle, fetchAIMeta } from '@/api/utils'
import { fetchFaviconDataUri } from '@/lib/favicon'
import { setFavicon } from '@/lib/favicon-cache'
import { getAISettings } from '@/api/settings'
import { toast } from '@/components/ui/toast'
import { useUIStore } from '@/stores/ui'
import { normalizeUrl, requireUrl, findDuplicateBookmark, parseTags } from '@/lib/bookmark-utils'
import { resolveCategoryIcon } from '@/lib/icon-map'
import { AI_PRESETS } from '@/lib/ai-providers'
import type { Bookmark } from '@/types'
import { cn } from '@/lib/utils'
import { createTimeoutSignal } from '@/lib/abort'

/**
 * 书签新增/编辑模态框。
 *
 * 书签新增/编辑模态框。
 *
 * 实现走新架构：Dialog + Input + Textarea + Combobox + Button 统一组件。
 *
 * - URL 失焦 500ms 自动抓标题
 * - URL 归一化 + 本地去重拦截
 * - 分类可输入下拉框（Combobox，portal 到 body 脱离 modal-body overflow 裁剪）
 * - AI 智能填充
 * - 描述 textarea 自适应高度
 */

// AI 回填中的输入框内动态指示器：渐变弧（占清除按钮位置，填充期间清除按钮隐藏）
const FillIndicator = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('ai-fill-arc', className)} />
)

/* ---- 组件 ---------------------------------------------------- */

export function BookmarkDialog({
  open,
  onClose,
  editingBookmark,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  editingBookmark: Bookmark | null
  onCreated?: (id: number) => void
}) {
  const { data: bmData } = useBookmarks()
  const { data: catData } = useCategories()
  const { data: aiData } = useQuery({ queryKey: ['ai-settings'], queryFn: getAISettings })
  const activeProviderLogo =
    AI_PRESETS[aiData?.activeProvider ?? '']?.logo ?? null
  const createMut = useCreateBookmark()
  const updateMut = useUpdateBookmark()
  const createCategoryMut = useCreateCategory()
  const bookmarks = bmData?.bookmarks ?? []
  const categories = catData?.categories ?? []

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [tags, setTags] = useState('')
  const [urlDuplicate, setUrlDuplicate] = useState(false)
  const [duplicateBookmark, setDuplicateBookmark] = useState<Bookmark | null>(null)
  const [idCopied, setIdCopied] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [fetchingTitle, setFetchingTitle] = useState(false)
  const [fetchingDesc, setFetchingDesc] = useState(false)
  // AI 回填进行中的字段（title/desc/tags）-> 输入框内指示器
  const [aiFilling, setAiFilling] = useState<Record<string, boolean>>({})
  const titleTimer = useRef<number | null>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  // AI 填充 / 抓标题的 AbortController，Esc 中断用
  const aiAbortRef = useRef<AbortController | null>(null)
  const aiSaveRequestedRef = useRef(false)
  // AI 回填逐字段填充的定时器（关闭弹窗/Esc 中断时清掉）
  const aiFillTimers = useRef<number[]>([])
  const clearAiFillTimers = () => {
    aiFillTimers.current.forEach((t) => window.clearTimeout(t))
    aiFillTimers.current = []
  }
  // favicon 预获取：输入 URL 时后台抓，
  // 保存时写入，新书签保存后图标立即显示（不用等卡片渲染再取）
  const preFetchedFaviconRef = useRef<string | null>(null)
  const faviconAbortRef = useRef<AbortController | null>(null)
  // URL 输入框 ref（新增模式打开 dialog 时 focus 用，替代 document.querySelector）
  const urlInputRef = useRef<HTMLInputElement>(null)

  /* textarea 自适应高度 */
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [desc, open])

  // 打开时初始化
  const currentCategory = useUIStore((s) => s.currentCategory)
  const setCurrentCategory = useUIStore((s) => s.setCurrentCategory)
  const aiPrefill = useUIStore((s) => s.aiPrefill)
  const consumeAIPrefill = () => useUIStore.setState({ aiPrefill: null })
  useEffect(() => {
    if (!open) return
    aiSaveRequestedRef.current = false
    if (editingBookmark) {
      setUrl(editingBookmark.url)
      const cat = categories.find((c) => c.id === editingBookmark.category_id)
      setCategoryName(cat ? cat.name : '')
      // 如果是右键智能填充的入口：用 aiPrefill 覆盖 title/description/tags（外面入口流程）
      if (aiPrefill && aiPrefill.id === editingBookmark.id) {
        if (aiPrefill.title) setTitle(aiPrefill.title)
        else setTitle(editingBookmark.title)
        if (aiPrefill.description) setDesc(aiPrefill.description)
        else setDesc(editingBookmark.description ?? '')
        if (aiPrefill.tags) setTags(aiPrefill.tags)
        else setTags(editingBookmark.tags?.join(', ') ?? '')
        consumeAIPrefill()
      } else {
        setTitle(editingBookmark.title)
        setDesc(editingBookmark.description ?? '')
        setTags(editingBookmark.tags?.join(', ') ?? '')
      }
    } else {
      setUrl('')
      setTitle('')
      setDesc('')
      // 新增书签时继承当前选中分类（currentCategory≠'all' 时预填）
      const presetCat =
        typeof currentCategory === 'number'
          ? categories.find((c) => c.id === currentCategory)?.name ?? ''
          : ''
      setCategoryName(presetCat)
      setTags('')
    }
    setUrlDuplicate(false)
    setDuplicateBookmark(null)
    setIdCopied(false)
    // 重置 favicon 预获取状态（关闭重开 / 切编辑时清旧值 + 中断未完成的抓取）
    faviconAbortRef.current?.abort()
    faviconAbortRef.current = null
    preFetchedFaviconRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingBookmark])

  // 打开时自动 focus URL 输入框（仅新增模式）。
  // 编辑模式不 focus 任何输入框——用户需求：打开即静默，光标不落在任何字段，
  // 避免误触替换整段标题。用 setTimeout 跳过 Dialog 退场动画帧，确保 input 挂载后再 focus。
  useEffect(() => {
    if (!open) return
    if (editingBookmark) return
    const t = window.setTimeout(() => {
      urlInputRef.current?.focus()
    }, 50)
    return () => window.clearTimeout(t)
  }, [open, editingBookmark])

  /* URL 失焦 500ms 自动获取标题 + 后台预获取 favicon */
  const onUrlChange = (v: string) => {
    setUrl(v)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    setFetchingTitle(false)
    // 中断上一次 favicon 预获取 + 清空预获取值（URL 变了，旧值作废）
    faviconAbortRef.current?.abort()
    preFetchedFaviconRef.current = null
    const normalized = normalizeUrl(v)
    if (!normalized) return
    const dup = findDuplicateBookmark(bookmarks, normalized, editingBookmark?.id)
    setUrlDuplicate(!!dup)
    setDuplicateBookmark(dup)
    if (editingBookmark) return
    titleTimer.current = window.setTimeout(async () => {
      if (title.trim()) return
      aiAbortRef.current?.abort()
      const ac = new AbortController()
      aiAbortRef.current = ac
      setFetchingTitle(true)
      try {
        const res = await fetchPageTitle(normalized, ac.signal)
        if (res.title && !title.trim()) setTitle(res.title)
        if (res.description && !desc.trim()) setDesc(res.description)
      } catch {
        /* 静默（含 Esc 中断）*/
      } finally {
        setFetchingTitle(false)
        if (aiAbortRef.current === ac) aiAbortRef.current = null
      }
    }, 500)
    // favicon 预获取（后台并行）——
    // 保存时写入 preFetchedFaviconRef，新书签保存后图标立即显示
    const fac = new AbortController()
    faviconAbortRef.current = fac
    fetchFaviconDataUri(normalized, fac.signal)
      .then((dataUri) => {
        if (dataUri) preFetchedFaviconRef.current = dataUri
      })
      .catch(() => {
        /* Esc 中断，静默 */
      })
  }

  const saveAIResult = async (
    normalized: string,
    finalTitle: string,
    finalDesc: string,
    rawTags: string,
    selectedCategory: string,
    suggestedCategory: string,
  ) => {
    const category = selectedCategory || suggestedCategory
    let categoryId: number | null = null
    if (category && (selectedCategory || (category.length <= 20 && !/[,，]/.test(category)))) {
      const existing = categories.find(
        (c) => c.name.trim().toLowerCase() === category.toLowerCase(),
      )
      if (existing) categoryId = existing.id
      else {
        try {
          const created = await createCategoryMut.mutateAsync({ name: category })
          categoryId = created.id
        } catch {
          /* 分类创建失败不阻塞保存 */
        }
      }
    }

    const categoryNames = new Set(categories.map((c) => c.name.trim().toLowerCase()))
    if (categoryId != null && category) categoryNames.add(category.toLowerCase())
    const favicon =
      preFetchedFaviconRef.current || (await fetchFaviconDataUri(normalized).catch(() => null))
    const result = await createMut.mutateAsync({
      url: normalized,
      title: finalTitle || normalized,
      description: finalDesc || undefined,
      tags: parseTags(rawTags).filter((tag) => !categoryNames.has(tag.toLowerCase())),
      category_id: categoryId,
      favicon: favicon || undefined,
    })
    if (favicon && result.bookmark.updated_at) {
      setFavicon(result.bookmark.id, result.bookmark.updated_at, favicon)
    }

    const created = result.bookmark
    const visible =
      currentCategory === 'all' ||
      (currentCategory === '__favorites__' && created.is_favorite) ||
      (currentCategory === '__uncategorized__' && created.category_id == null) ||
      currentCategory === created.category_id
    if (!visible) setCurrentCategory(created.category_id ?? '__uncategorized__')
    onCreated?.(created.id)
    return categoryId != null && category ? `已添加「${category}」` : '已添加'
  }

  /* AI 智能填充：用户在分析中保存时，复用同一次结果直接创建书签。 */
  const handleAI = async (urlArg?: string) => {
    const rawUrl = urlArg ?? url
    const normalized = requireUrl(rawUrl)
    if (!normalized) return
    // 中断上一次 AI/抓标题请求
    aiAbortRef.current?.abort()
    // 竞态修复：重入时同时清掉上一次成功路径仍在排队的逐字段回填定时器，
    // 否则 600ms 窗口内二次点击会让旧定时器覆盖新结果
    clearAiFillTimers()
    const ac = new AbortController()
    aiAbortRef.current = ac
    setAiLoading(true)
    // 三个可回填字段的指示器同时亮起
    setAiFilling({ title: true, desc: true, tags: true })
    const tid = toast.loading(
      '正在智能分析…',
      activeProviderLogo ? (
        <img
          src={activeProviderLogo}
          alt=""
          className="w-4 h-4 animate-spin"
          style={{ animationDuration: '1.5s' }}
        />
      ) : undefined,
      { onDismiss: () => ac.abort() },
    )
    try {
      const meta = await fetchAIMeta(
        normalized,
        categories.map((c) => c.name),
        ac.signal,
      )
      // 优先用 AI 翻译的中文，缺则回退本地原始提取
      const finalTitle = meta.title_cn || meta.title || ''
      const finalDesc = meta.description_cn || meta.description || ''
      const selectedCategory = categoryName.trim()
      const suggestedCategory = selectedCategory ? '' : (meta.category ?? '').trim()
      if (aiSaveRequestedRef.current) {
        const message = await saveAIResult(
          normalized,
          finalTitle,
          finalDesc,
          meta.tags ?? '',
          selectedCategory,
          suggestedCategory,
        )
        toast.resolve(tid, message, 'success')
        return
      }
      // 回填：按 标题→描述→标签 依次填充（每步 200ms），配合输入框内指示器逐格消失
      const fillSteps: Array<[string, () => void]> = []
      if (finalTitle) fillSteps.push(['title', () => setTitle(finalTitle)])
      if (finalDesc) fillSteps.push(['desc', () => setDesc(finalDesc)])
      // tags：后端返回逗号分隔字符串，split + 过滤已有分类名
      if (meta.tags) {
        const catNames = new Set(categories.map((c) => c.name.trim()))
        const filtered = meta.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t && !catNames.has(t))
        if (filtered.length) fillSteps.push(['tags', () => setTags(filtered.join(', '))])
      }
      if (suggestedCategory) setCategoryName(suggestedCategory)
      // 没有数据返回的字段：指示器立即收掉
      const noData = ['title', 'desc', 'tags'].filter((k) => !fillSteps.some(([fk]) => fk === k))
      setAiFilling((prev) => {
        const next = { ...prev }
        noData.forEach((k) => delete next[k])
        return next
      })
      fillSteps.forEach(([key, fill], i) => {
        const t = window.setTimeout(() => {
          fill()
          setAiFilling((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          })
        }, 200 * (i + 1))
        aiFillTimers.current.push(t)
      })
      // 成功 toast 带 usedSerper 提示（智能获取是否调用了搜索工具）
      const usedSerper = meta.usedSerper === 'true'
      toast.resolve(
        tid,
        usedSerper ? '智能获取成功 · 调用了搜索工具' : '智能获取成功',
        'success',
      )
    } catch (e) {
      clearAiFillTimers()
      setAiFilling({})
      if ((e as Error).name === 'AbortError')
        toast.resolve(tid, '智能分析已取消', 'warning')
      else toast.resolve(tid, (e as Error).message || '智能获取失败', 'error')
    } finally {
      aiSaveRequestedRef.current = false
      setAiLoading(false)
      if (aiAbortRef.current === ac) aiAbortRef.current = null
    }
  }

  // Esc 中断 AI/抓标题（capture 阶段先于 Dialog 的 bubble Esc 关闭，避免冒泡触发 dialog 自管 close）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && aiAbortRef.current) {
        e.stopImmediatePropagation()
        e.preventDefault()
        aiAbortRef.current.abort()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  // 弹窗关闭/卸载：清掉 AI 回填逐字段定时器，避免关闭后还在改 state
  useEffect(() => {
    if (!open) return
    return () => {
      clearAiFillTimers()
      setAiFilling({})
    }
  }, [open])

  const copyId = () => {
    if (!editingBookmark) return
    navigator.clipboard.writeText(`书签ID: ${editingBookmark.id}`).then(() => {
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 1000)
    })
  }

  const saving = createMut.isPending || updateMut.isPending
  // 防重入 + 弹窗关闭后不响应：submit 是 async +「先 onClose 再 await」乐观关闭（偏离 TanStack Query 官方
  // form 模式——官方是 await mutation 后再 close/reset）。onClose 后 re-render 使 editingBookmark 变 null、
  // open 变 false；弹窗退场 350ms 内 DOM 还在，此时按回车命中新 submit（editingBookmark=null），
  // findDuplicateBookmark(url, undefined) 不排除自身 -> 误判为重复 -> 误报「URL 已存在」。
  // 两道闸：① !open 拦住「弹窗已关、退场期间」的 submit（覆盖 submit1 finally 复位后到弹窗卸载的窗口）；
  // ② submittingRef 拦住「同一次 open 内」的并发（re-render 前的极快双击）。
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

  const save = () => {
    if (!editingBookmark && aiLoading) {
      const normalized = requireUrl(url)
      if (!normalized) return
      const duplicate = findDuplicateBookmark(bookmarks, normalized)
      if (duplicate) {
        setUrlDuplicate(true)
        setDuplicateBookmark(duplicate)
        toast.warning('该网址已存在，请修改URL')
        return
      }
      aiSaveRequestedRef.current = true
      onClose()
      return
    }
    void submit()
  }

  const runSubmit = async () => {
    const normalizedUrl = normalizeUrl(url)
    const trimmedTitle = title.trim()
    if (!normalizedUrl || !trimmedTitle) {
      toast.warning('请填写网址和标题')
      return
    }
    const dup = findDuplicateBookmark(bookmarks, normalizedUrl, editingBookmark?.id)
    if (dup) {
      setUrlDuplicate(true)
      setDuplicateBookmark(dup)
      toast.warning('该网址已存在，请修改URL')
      return
    }
    try {
      new URL(normalizedUrl)
    } catch {
      toast.error('请输入有效的URL')
      return
    }

    let categoryId: number | null = null
    const trimmedCat = categoryName.trim()
    if (trimmedCat) {
      const existing = categories.find(
        (c) => c.name.toLowerCase() === trimmedCat.toLowerCase(),
      )
      if (existing) {
        categoryId = existing.id
      } else {
        try {
          // 走 useCreateCategory —— 后端成功后自动 invalidate ['categories'] + ['bookmarks']，
          // sidebar / 计数实时刷新，无需手动 refetch / 刷新页面
          const created = await createCategoryMut.mutateAsync({
            name: trimmedCat,
            icon: 'fa-folder',
          })
          categoryId = created.id
        } catch (e) {
          toast.error('创建分类失败: ' + (e as Error).message)
          return
        }
      }
    }

    const input = {
      url: normalizedUrl,
      title: trimmedTitle,
      description: desc.trim(),
      category_id: categoryId,
      tags: parseTags(tags),
      // 添加模式写入预获取的 favicon（新书签保存后图标立即显示）；
      // 编辑模式不传 favicon 字段，保留原值（后端按字段出现覆盖，bookmarks.go:267）
      ...(editingBookmark ? {} : { favicon: preFetchedFaviconRef.current || '' }),
    }

    // 更新：useUpdateBookmark 乐观（onMutate 改缓存秒变，失败 onError 回滚）。
    // 新建：useCreateBookmark 在 onSuccess 用后端真值 append（省 refetch；失败则未 append，缓存不动）。
    // 立即关弹窗 + 立即弹通知，await 写库；失败补错误通知（409 冲突等：红色通知，用户重新编辑）。
    onClose()
    toast.success(editingBookmark ? '书签已更新' : '书签已添加')
    try {
      if (editingBookmark) {
        await updateMut.mutateAsync({ id: editingBookmark.id, input })
      } else {
        const res = await createMut.mutateAsync(input)
        // 新书签预抓的图标写入缓存，列表卡片渲染时 getFavicon 秒显（updated_at 来自后端，与 refetch 一致）
        if (preFetchedFaviconRef.current && res.bookmark.updated_at) {
          setFavicon(res.bookmark.id, res.bookmark.updated_at, preFetchedFaviconRef.current)
        }
        onCreated?.(res.bookmark.id)
      }
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('冲突') || msg.includes('已存在')) {
        // race 兜底：本地查不到但后端 reject（竞态 / 跨端 / 列表陈旧）。
        // 同步设 urlDuplicate 让红字显示，前后端反馈一致
        setUrlDuplicate(true)
        toast.warning('该网址已存在，请修改URL')
      } else {
        toast.error('保存失败: ' + msg)
      }
    }
  }

  /* Ctrl+Enter 快捷键保存（通过 uiStore token 触发） */
  const submitRef = useRef(submit)
  useEffect(() => {
    submitRef.current = submit
  }, [submit])
  const bookmarkDialogSubmitToken = useUIStore((s) => s.bookmarkDialogSubmitToken)
  useEffect(() => {
    if (!open || bookmarkDialogSubmitToken === 0) return
    submitRef.current()
  }, [open, bookmarkDialogSubmitToken])

  const categoryOptions = categories.map((c) => {
    const Icon = resolveCategoryIcon(c.icon)
    return {
      value: String(c.id),
      label: c.name,
      icon: <Icon size={12} />,
      color: c.color,
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editingBookmark ? '编辑书签' : '添加书签'}
      headerExtra={
        editingBookmark ? (
          <span
            className={cn(
              'inline-flex items-center gap-[3px] px-[10px] py-[3px] rounded-md ' +
                'border font-mono text-xs font-medium tracking-[0.4px] ' +
                'cursor-pointer select-none transition-all duration-200',
              idCopied
                ? // 复制反馈：实心亮橙底白字，跟随主题色（hover 类在反馈态停用以避免覆盖 text-white）
                  'border-(--accent) bg-(--accent) text-white shadow-sm'
                : // 默认 / hover 态：灰底浅文字，hover 时变橙边
                  'border-(--border) bg-(--bg-secondary) shadow-sm text-(--text-secondary) ' +
                  'hover:border-(--accent) hover:text-(--accent) hover:bg-[var(--accent-soft-bg)]',
            )}
            onClick={(e) => {
              e.stopPropagation()
              copyId()
            }}
            title="点击复制 ID"
          >
            {idCopied ? '已复制' : <span>ID:{editingBookmark.id}</span>}
          </span>
        ) : null
      }
      footer={
        <>
          <Button
            variant="ai"
            onClick={() => void handleAI()}
            disabled={aiLoading || !url}
            className="mr-auto"
          >
            <Sparkles size={14} />
            {aiLoading ? 'AI 填充中…' : '智能填充'}
          </Button>
          <Button variant="soft" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={save}
            disabled={saving || (!!editingBookmark && aiLoading)}
          >
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
      {/* URL */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 mb-2">
          <Label htmlFor="bookmark-url" className="mb-0 mr-auto">网址 *</Label>
          <button
            // 始终渲染保留占位，避免按钮显隐时 label 宽度变化导致布局抖动；
            // URL 为空时用 invisible + pointer-events-none 隐藏（占据空间 + 不可点 + 不可 focus + 不在 a11y 树）
            className={cn(
              'inline-flex items-center justify-center w-[26px] h-[22px] p-0 border border-(--border) rounded-md bg-(--bg-secondary) shadow-sm text-(--text-secondary) text-[0.7rem] cursor-pointer transition-colors duration-200 hover:border-(--accent) hover:text-(--accent) hover:bg-[var(--accent-soft-bg)]',
              !url && 'invisible pointer-events-none',
            )}
            title="在新标签页打开"
            onClick={() => {
              const u = normalizeUrl(url)
              if (u) window.open(u, '_blank')
            }}
          >
            <ExternalLink size={11} />
          </button>
        </div>
        <InputWithClear
          ref={urlInputRef}
          id="bookmark-url"
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://example.com"
          inputClassName={cn(urlDuplicate && '!border-[var(--destructive)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--destructive)_15%,transparent)]')}
          right={
            !url.trim() ? (
              <PasteButton
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onPaste={async () => {
                  const text = await pasteClipboardText()
                  if (text) {
                    onUrlChange(text)
                    urlInputRef.current?.focus()
                  }
                }}
              />
            ) : undefined
          }
          onKeyDown={(e) => {
            // Enter 始终走普通保存；AI 仅由左下角“智能填充”触发。
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              submitRef.current()
            }
          }}
        />
        {urlDuplicate && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--destructive)]">
            <span>该URL已存在</span>
            {duplicateBookmark && (
              <span className="inline-flex items-center max-w-[240px] px-1.5 h-[18px] rounded-[20px] bg-[var(--destructive)]/10 border border-[var(--destructive)]/30 text-[0.65rem] font-medium">
                <span className="shrink-0 text-(--text-primary)">#{duplicateBookmark.id}</span>
                <span className="ml-0.5 min-w-0 truncate">{duplicateBookmark.title}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* 标题 */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 mb-2">
          <Label htmlFor="bookmark-title" className="mb-0 mr-auto">标题 *</Label>
          <button
            className="inline-flex items-center justify-center w-[26px] h-[22px] p-0 border border-(--border) rounded-md bg-(--bg-secondary) shadow-sm text-(--text-secondary) text-[0.7rem] cursor-pointer transition-all duration-200 hover:border-(--accent) hover:text-(--accent) hover:bg-[var(--accent-soft-bg)]"
            title="获取标题"
            onClick={async () => {
              const n = requireUrl(url)
              if (!n) return
              setFetchingTitle(true)
              try {
                const res = await fetchPageTitle(n)
                if (res.title) setTitle(res.title)
                if (res.description) setDesc(res.description)
              } catch {
                /* 静默 */
              } finally {
                setFetchingTitle(false)
              }
            }}
          >
            <Type size={11} />
          </button>
        </div>
        <InputWithClear
          id="bookmark-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={fetchingTitle ? '正在获取标题…' : '网站标题'}
          onKeyDown={(e) => {
            // Enter 保存（不含 Ctrl/Cmd）
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              submitRef.current()
            }
          }}
          right={
            aiFilling.title ? (
              <FillIndicator className="right-2 top-1/2 -translate-y-1/2" />
            ) : undefined
          }
          hideClear={!!aiFilling.title}
        />
      </div>

      {/* 描述 */}
      <div className="mb-5">
        <div className="flex items-center gap-1.5 mb-2">
          <Label htmlFor="bookmark-desc" className="mb-0 mr-auto">描述</Label>
          <button
            type="button"
            className="inline-flex items-center justify-center w-[26px] h-[22px] p-0 border border-(--border) rounded-md bg-(--bg-secondary) shadow-sm text-(--text-secondary) text-[0.7rem] cursor-pointer transition-all duration-200 hover:border-(--accent) hover:text-(--accent) hover:bg-[var(--accent-soft-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
            title="获取描述"
            disabled={fetchingDesc}
            onClick={async () => {
              // 产品契约：单独获取描述，不动标题
              const n = requireUrl(url)
              if (!n) return
              setFetchingDesc(true)
              try {
                const { signal } = createTimeoutSignal(undefined, 5000)
                const res = await fetchPageTitle(n, signal)
                if (res.description) {
                  setDesc(res.description)
                  toast.success('描述获取成功')
                } else {
                  toast.warning('页面未提供描述，请手动输入')
                }
              } catch {
                toast.error('获取描述失败')
              } finally {
                setFetchingDesc(false)
              }
            }}
          >
            <FileText size={11} className={fetchingDesc ? 'animate-spin' : undefined} />
          </button>
        </div>
        <div className="relative">
          <Textarea
            ref={descRef}
            id="bookmark-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="简短描述（可选）"
            className="desc-scroll pr-6 min-h-[80px] max-h-[300px] overflow-y-auto"
          />
          {aiFilling.desc && <FillIndicator className="right-2 top-2" />}
          {desc && !aiFilling.desc && (
            <button
              type="button"
              className="input-icon-btn input-clear-btn absolute right-2 top-2 p-0.5 text-xs"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setDesc('')}
              title="清空描述"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 分类 */}
      <div className="mb-5">
        <Label htmlFor="bookmark-category">分类</Label>
        <Combobox
          value={categoryName}
          onChange={setCategoryName}
          options={categoryOptions}
          placeholder="选择或新建分类"
          emptyText="无匹配分类"
          onEnter={() => submitRef.current()}
          listMaxHeight={168}
        />
      </div>

      {/* 标签 */}
      <div className="mb-5">
        <Label htmlFor="bookmark-tags">标签（Tab 追加逗号）</Label>
        <InputWithClear
          id="bookmark-tags"
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="工具, 开发, 学习"
          onKeyDown={(e) => {
            // Enter 保存（与 URL/标题框一致；Ctrl/Cmd+Enter 由全局快捷键处理）
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
              e.preventDefault()
              submitRef.current()
              return
            }
            // Tab 追加英文逗号分隔标签。
            // 原回车键的追加逗号行为改用 Tab（回车让给保存）；Tab 不是字符键、IME 不处理它，
            // preventDefault 安全，不会像逗号键那样干扰中文输入法标点转换导致卡死。
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault()
              if (!tags.trimEnd().endsWith(',')) {
                setTags((prev) => prev.trimEnd() + ', ')
              }
            }
          }}
          right={
            aiFilling.tags ? (
              <FillIndicator className="right-2 top-1/2 -translate-y-1/2" />
            ) : undefined
          }
          hideClear={!!aiFilling.tags}
        />
      </div>
    </Dialog>
  )
}
