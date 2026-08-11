import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, ExternalLink, Activity, KeyRound, Check, Bot, Plus, X, Play, ChevronRight, Loader2, Copy } from 'lucide-react'
import {
  getAISettings,
  updateAISettings,
  switchAIProvider,
  deleteAIProviderConfig,
  copyAIConfig,
  getSerperKey,
  saveSerperKey,
  deleteSerperKey,
  testSerperKey,
  testAIConnection,
  type SavedConfig,
} from '@/api/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SecretInput } from '@/components/shared/secret-input'
import { Combobox } from '@/components/ui/combobox'
import { AI_PRESETS, AI_APPLY_URLS, AI_PROVIDER_ORDER, CUSTOM_PROVIDER_PRESET } from '@/lib/ai-providers'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { createTimeoutSignal } from '@/lib/abort'
import { SECTION_CLASS } from './section-styles'

/** 状态徽章统一样式（已配置/已设置）-- 单一来源，避免多处硬编码导致位置不一致 */
const statusBadgeClass =
  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-(--accent) text-(--accent) bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'

const getProviderDisplayName = (provider: string) =>
  (provider === 'custom' ? CUSTOM_PROVIDER_PRESET : AI_PRESETS[provider])?.label ?? provider

/**
 * AI 设置 section -- 一个厂商可存多份配置（如 DeepSeek flash + pro 各一份），平铺展示。
 * 每份配置独立编辑/启用/删除；激活全局唯一（activeConfigId）。
 *
 * subView='ai-add-provider'：二级界面新增配置。
 * - selectedProvider=null：provider 网格平铺，点选后留在二级展开编辑表单
 * - selectedProvider 非 null：编辑表单（新增），保存后回一级
 * 返回按钮 + 标题由 SettingsDialog 统一渲染（subView 头部）。
 *
 * 已保存配置的编辑：一级界面点卡片原地展开（fillConfig），不走二级。
 */
export function AiSection({
  subView,
  onSubView,
}: {
  subView: string | null
  onSubView: (v: string | null) => void
}) {
  const qc = useQueryClient()
  const { data: aiData } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: getAISettings,
  })
  const { data: serperData } = useQuery({
    queryKey: ['serper-key'],
    queryFn: getSerperKey,
  })

  // editingConfigId: 0=新增态（表单待保存），>0=编辑某 config
  const [editingConfigId, setEditingConfigId] = useState(0)
  // 二级新增：选定的 provider（null=网格，非 null=编辑表单）
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [provider, setProvider] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [serperKey, setSerperKey] = useState('')
  // 正在进行的测试（key -> true）。卡片行 key=`cfg-${id}`，编辑表单 key='edit'，Serper key='serper'。
  const [activeTests, setActiveTests] = useState<Record<string, true>>({})
  const activeTestRef = useRef<Map<string, { ac: AbortController; toastId: number }>>(new Map())
  const [aiSaving, setAiSaving] = useState(false)
  const [serperSaving, setSerperSaving] = useState(false)
  // Serper 卡片默认收缩，点箭头展开输入
  const [serperExpanded, setSerperExpanded] = useState(false)
  // 删除确认态：命中的 config id
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)

  const resetForm = () => {
    setEditingConfigId(0)
    setProvider('')
    setDisplayName('')
    setModel('')
    setBaseUrl('')
    setApiKey('')
  }

  // 编辑某已存配置：填入它的 provider/model/baseUrl（一级原地编辑）
  const fillConfig = (c: SavedConfig) => {
    setEditingConfigId(c.id)
    setProvider(c.provider)
    setDisplayName(c.displayName || getProviderDisplayName(c.provider))
    setModel(c.model || '')
    setBaseUrl(c.baseUrl || AI_PRESETS[c.provider]?.baseUrl || '')
    setApiKey('')
  }

  // 新增某 provider：填预设默认 model/baseUrl（二级编辑表单）
  const fillProvider = (p: string) => {
    const preset = AI_PRESETS[p]
    setEditingConfigId(0)
    setProvider(p)
    setDisplayName(getProviderDisplayName(p))
    setModel(preset?.model || '')
    setBaseUrl(preset?.baseUrl || '')
    setApiKey('')
  }

  const preset = AI_PRESETS[provider]
  // 当前编辑的已存配置（新增态 editingConfigId=0 -> undefined）
  const savedCurrent = aiData?.savedConfigs?.find((c) => c.id === editingConfigId)
  const save = async () => {
    if (aiSaving) return
    if (!provider) {
      toast.warning('请选择提供商')
      return
    }
    if (!displayName.trim()) {
      toast.warning('请填写供应商名称')
      return
    }
    if (!model.trim()) {
      toast.warning('模型 ID 不能为空')
      return
    }
    setAiSaving(true)
    try {
      const res = await updateAISettings({
        configId: editingConfigId,
        provider,
        displayName: displayName.trim(),
        model: model.trim(),
        apiKey,
        baseUrl: baseUrl.trim(),
      })
      // 精确反馈：区分首次保存 / 密钥保留 / 密钥更新
      if (apiKey.trim() && savedCurrent?.hasKey) {
        toast.success('密钥已更新')
      } else if (apiKey.trim()) {
        toast.success('密钥已保存')
      } else {
        toast.success('密钥保留，其他设置已保存')
      }
      if (subView === 'ai-add-provider') {
        // 二级新增：保存后回一级（useEffect 监听 subView 离开会 resetForm）
        onSubView(null)
      } else {
        // 一级已保存编辑：留编辑态，清空 apiKey 输入框
        setEditingConfigId(res.configId)
        setApiKey('')
      }
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
    } catch (e) {
      toast.error('保存失败: ' + (e as Error).message)
    } finally {
      setAiSaving(false)
    }
  }

  // 中断指定测试（按 key）
  const cancelTest = (key: string) => {
    activeTestRef.current.get(key)?.ac.abort()
  }
  const cancelAllTests = () => {
    for (const entry of activeTestRef.current.values()) entry.ac.abort()
  }

  const runCancellableTest = async (
    key: string,
    label: string,
    requestFn: (signal: AbortSignal) => Promise<{ ok: boolean; latency?: number; error?: string }>,
    timeoutMs = 12000,
  ) => {
    const ac = new AbortController()
    // 默认 12s 兜底：AI 测试是 max_tokens:1 最小探针，正常 2~5s 应答；
    // 超过 12s 必是网络黑洞/端点下线。Serper 较慢，调用方传更大值（如 20000）
    const { signal: reqSignal, timeoutSignal } = createTimeoutSignal(ac.signal, timeoutMs)
    const tid = toast.loading('正在测试连通性…', undefined, {
      onDismiss: () => ac.abort(),
    })
    activeTestRef.current.set(key, { ac, toastId: tid })
    setActiveTests((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await requestFn(reqSignal)
      if (res.ok) toast.resolve(tid, `${label} 连接成功（${res.latency ?? 0}ms）`, 'success')
      else toast.resolve(tid, `${label} 连接失败: ${res.error || '未知错误'}`, 'error')
    } catch (e) {
      if (timeoutSignal.aborted) toast.resolve(tid, `${label} 测试超时（12s 无响应）`, 'error')
      else if (ac.signal.aborted) toast.resolve(tid, `${label} 已取消`, 'warning')
      else toast.resolve(tid, `${label} 测试失败: ${(e as Error).message}`, 'error')
    } finally {
      activeTestRef.current.delete(key)
      setActiveTests((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  // 编辑表单测试连接：测刚填入的新鲜配置。再点一次 = 中断。
  const onAITest = async () => {
    if (activeTestRef.current.has('edit')) {
      cancelTest('edit')
      return
    }
    if (!provider) {
      toast.warning('请先选择提供商')
      return
    }
    if (!model.trim()) {
      toast.warning('请填写模型 ID')
      return
    }
    await runCancellableTest('edit', model.trim(), (signal) =>
      testAIConnection(
        { configId: editingConfigId || undefined, provider, model: model.trim(), apiKey, baseUrl: baseUrl.trim() },
        signal,
      ),
    )
  }

  // 卡片行延迟测试：测已保存配置（传已存 baseUrl，后端不再回退默认）。再点同一行 = 中断。
  const onTestLatency = async (configId: number, p: string, m: string, url: string) => {
    const key = `cfg-${configId}`
    if (activeTestRef.current.has(key)) {
      cancelTest(key)
      return
    }
    await runCancellableTest(key, m, (signal) =>
      testAIConnection({ configId, provider: p, model: m, baseUrl: url }, signal),
    )
  }

  // 测试中 ESC 中断全部（不关弹窗）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (activeTestRef.current.size === 0) return
      e.preventDefault()
      e.stopImmediatePropagation()
      cancelAllTests()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 离开二级新增界面（返回 / 保存后 onSubView(null)）：清空表单 + selectedProvider，
  // 避免一级 provider 残留导致 editForm 展开
  const prevSubView = useRef<string | null>(subView)
  useEffect(() => {
    if (prevSubView.current === 'ai-add-provider' && subView !== 'ai-add-provider') {
      resetForm()
      setSelectedProvider(null)
    }
    prevSubView.current = subView
  }, [subView])

  // 开关切换激活：点未激活的 -> 激活它；点已激活的 -> 取消激活（关开关）。
  const onToggleActive = async (configId: number) => {
    const willActivate = aiData?.activeConfigId !== configId
    try {
      await switchAIProvider(willActivate ? configId : 0)
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      const c = aiData?.savedConfigs?.find((x) => x.id === configId)
      toast.success(
        willActivate ? `已激活 ${c?.displayName || AI_PRESETS[c?.provider ?? '']?.label || c?.provider}` : '已停用 AI',
      )
    } catch (e) {
      toast.error('操作失败: ' + (e as Error).message)
    }
  }

  // 点击已保存卡片：展开/收缩 toggle（一级原地编辑）
  const onToggleExpand = (c: SavedConfig) => {
    if (editingConfigId === c.id) {
      resetForm()
    } else {
      fillConfig(c)
    }
  }

  // 复制配置：后端创建副本（含密钥）-> 进入新副本编辑态，改完保存更新
  const onCopyConfig = async (c: SavedConfig) => {
    try {
      const copiedName = `${c.displayName || getProviderDisplayName(c.provider)} copy`
      const res = await copyAIConfig(c.id, c.displayName || getProviderDisplayName(c.provider))
      await qc.invalidateQueries({ queryKey: ['ai-settings'] })
      setEditingConfigId(res.configId)
      setProvider(c.provider)
      setDisplayName(copiedName)
      setModel(c.model)
      setBaseUrl(c.baseUrl || AI_PRESETS[c.provider]?.baseUrl || '')
      setApiKey('')
      toast.success('已复制配置')
    } catch (e) {
      toast.error('复制失败: ' + (e as Error).message)
    }
  }

  const onDeleteConfig = async () => {
    if (confirmingDelete === null) return
    const id = confirmingDelete
    try {
      await deleteAIProviderConfig(id)
      toast.success('已删除配置')
      if (editingConfigId === id) resetForm()
      setConfirmingDelete(null)
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
    } catch {
      toast.error('删除失败')
    }
  }

  // Serper 测试连接
  const onSerperTest = async () => {
    if (activeTestRef.current.has('serper')) {
      cancelTest('serper')
      return
    }
    await runCancellableTest('serper', 'Serper', (signal) =>
      testSerperKey(serperKey.trim() || undefined, signal),
    )
  }

  const onSerperSave = async () => {
    if (serperSaving) return
    const k = serperKey.trim()
    if (!k) {
      toast.warning('请输入 Serper Key')
      return
    }
    setSerperSaving(true)
    try {
      await saveSerperKey(k)
      toast.success('Serper Key 已保存')
      setSerperKey('')
      qc.invalidateQueries({ queryKey: ['serper-key'] })
    } catch (e) {
      toast.error('保存失败: ' + (e as Error).message)
    } finally {
      setSerperSaving(false)
    }
  }

  const onSerperDelete = async () => {
    try {
      await deleteSerperKey()
      toast.success('Serper Key 已删除')
      qc.invalidateQueries({ queryKey: ['serper-key'] })
    } catch {
      toast.error('删除失败')
    }
  }

  const apiKeyPlaceholder = savedCurrent?.hasKey
    ? '留空保留，输入新值覆盖'
    : '输入 API 密钥'

  // 编辑表单（一级已保存编辑 + 二级新增共用；二级始终显示空模板，点 provider 填入）
  const editForm = (
    <>
      <div>
        <Label htmlFor="ai-display-name">供应商名称</Label>
        <Input
          id="ai-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="供应商名称"
          autoComplete="off"
          className="h-12 text-base"
        />
      </div>
      <div>
        <Label htmlFor="ai-model">模型</Label>
        <Combobox
          value={model}
          onChange={setModel}
          options={(preset?.modelOptions ?? []).map((m) => ({ value: m, label: m }))}
          placeholder="模型 ID"
          inputClassName="h-11"
        />
      </div>

      {(!!preset?.baseUrl || provider === 'custom') && (
        <div>
          <Label htmlFor="ai-base-url">调用地址</Label>
          <Input
            id="ai-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="API Base URL"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
          />
        </div>
      )}

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Label htmlFor="ai-api-key" className="mb-0">API 密钥</Label>
          {savedCurrent?.hasKey && (
            <span className={statusBadgeClass}>
              <Check size={10} strokeWidth={3} />
              已设置 {savedCurrent?.keyHint}
            </span>
          )}
        </div>
        <SecretInput
          id="ai-api-key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={apiKeyPlaceholder}
        />
      </div>

      {AI_APPLY_URLS[provider] && (
        <a
          href={AI_APPLY_URLS[provider]}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-(--accent) inline-flex items-center gap-1 hover:underline w-fit"
        >
          <ExternalLink size={12} /> 获取密钥
        </a>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button onClick={save} disabled={aiSaving}>保存</Button>
        <Button
          variant="outline"
          onClick={onAITest}
          aria-label={activeTests['edit'] ? '取消测试' : '测试连接'}
        >
          {activeTests['edit'] ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
          {activeTests['edit'] ? '取消测试' : '测试连接'}
        </Button>
      </div>
    </>
  )

  // ========== 二级界面：新增配置（网格 + 编辑表单同时常驻）==========
  if (subView === 'ai-add-provider') {
    return (
      <section className={cn(SECTION_CLASS, 'gap-4')}>
        {/* provider 网格：点选高亮 + 下方表单填入 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {AI_PROVIDER_ORDER.map((p) => {
            const pPreset = p === 'custom' ? CUSTOM_PROVIDER_PRESET : AI_PRESETS[p]
            const isSelected = selectedProvider === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  fillProvider(p)
                  setSelectedProvider(p)
                }}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-3 min-h-12 rounded-[10px] border transition-colors cursor-pointer text-left',
                  isSelected
                    ? 'border-(--accent) bg-[var(--accent)]/10'
                    : 'border-(--border) hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/10',
                )}
              >
                {pPreset.logo ? (
                  <img src={pPreset.logo} alt="" className="w-6 h-6 object-contain shrink-0" />
                ) : (
                  <Bot size={20} className="shrink-0 text-(--text-muted)" />
                )}
                <span className="flex flex-col min-w-0">
                  <span className={cn('text-sm font-medium truncate', isSelected ? 'text-(--accent)' : 'text-(--text-primary)')}>
                    {pPreset.label}
                  </span>
                  <span className="text-[10px] text-(--text-muted) truncate">{pPreset.format}</span>
                </span>
              </button>
            )
          })}
        </div>
        {/* 编辑表单（始终显示，空模板；点 provider 后填入）*/}
        {editForm}
      </section>
    )
  }

  // ========== 一级界面：配置列表 + 已保存编辑表单 + Serper ==========
  return (
    <>
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
            <Bot size={16} />
            AI 设置
          </h3>
          <p className="text-xs text-(--text-muted) mt-0.5">
            多 Provider 配置，一个厂商可存多份模型配置；激活的配置用于书签 AI 元数据填充
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            resetForm()
            setSelectedProvider(null)
            onSubView('ai-add-provider')
          }}
          className="shrink-0"
        >
          <Plus size={14} /> 新增配置
        </Button>
      </div>

      {/* 无配置且未在编辑时整卡隐藏，避免空卡片占位 */}
      {(!!aiData?.savedConfigs?.length || !!provider) && (
        <div className={cn(SECTION_CLASS, 'gap-4')}>

          {/* 模型配置列表（平铺，同 provider 多份各一行）*/}
          {!!aiData?.savedConfigs?.length && (
            <div>
              <Label className="mb-2">模型配置</Label>
              <div className="flex flex-col gap-1.5">
                {aiData.savedConfigs.map((c) => {
                  const cPreset = AI_PRESETS[c.provider]
                  const cLabel = c.displayName || (cPreset?.label ?? c.provider)
                  const isActive = aiData.activeConfigId === c.id
                  const isEditing = editingConfigId === c.id
                  const testKey = `cfg-${c.id}`
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        'flex items-center gap-3 min-h-12 rounded-[10px] border transition-colors',
                        confirmingDelete === c.id
                          ? 'border-[var(--destructive)] bg-[var(--destructive-soft-bg)]'
                          : isEditing
                            ? 'border-(--accent) bg-[var(--accent)]/10'
                            : isActive
                              ? 'border-(--border) bg-[linear-gradient(90deg,color-mix(in_srgb,var(--accent)_10%,transparent),transparent)]'
                              : 'border-(--border) hover:bg-(--bg-primary)',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onToggleExpand(c)}
                        className="flex flex-1 items-center gap-2.5 px-3 py-2 text-left cursor-pointer min-w-0"
                      >
                        <ChevronRight
                          size={16}
                          className={cn(
                            'shrink-0 text-(--text-muted) transition-transform',
                            isEditing && 'rotate-90',
                          )}
                        />
                        {cPreset?.logo ? (
                          <img src={cPreset.logo} alt="" className="w-6 h-6 object-contain shrink-0" />
                        ) : (
                          <Bot size={20} className="shrink-0 text-(--text-muted)" />
                        )}
                        <span className="flex flex-col min-w-0">
                          <span className="text-xs truncate text-(--text-primary)" style={{ fontWeight: 550 }}>
                            {cLabel}
                          </span>
                          <span className="text-[10px] text-(--text-muted) truncate">
                            {c.model || '未设置模型'}
                          </span>
                        </span>
                      </button>
                      {confirmingDelete === c.id ? (
                        <div className="pr-2 shrink-0 flex items-center gap-1.5">
                          <Button variant="destructive" size="sm" onClick={onDeleteConfig}>
                            <Trash2 size={13} /> 确认删除
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setConfirmingDelete(null)}
                            aria-label="取消删除"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="pr-0 shrink-0">
                            <Button
                              variant={isActive ? 'soft' : 'default'}
                              size="sm"
                              disabled={isActive}
                              onClick={() => onToggleActive(c.id)}
                              className={cn(
                                'min-w-[5rem]',
                                isActive ? undefined : 'bg-[var(--ios-blue)] hover:bg-[var(--ios-blue)] hover:opacity-90',
                              )}
                              aria-label={
                                isActive
                                  ? `${cLabel} 使用中`
                                  : `启用 ${cLabel}`
                              }
                            >
                              {isActive ? <Check size={13} /> : <Play size={13} />}
                              {isActive ? '使用中' : '启用'}
                            </Button>
                          </div>
                          <div className="shrink-0">
                            <Button
                              variant="outline"
                              size="icon-sm"
                              onClick={() => onCopyConfig(c)}
                              aria-label={`复制 ${cLabel} 配置`}
                            >
                              <Copy size={14} />
                            </Button>
                          </div>
                          <div className="shrink-0">
                            <Button
                              variant="outline"
                              size="icon-sm"
                              onClick={() => onTestLatency(c.id, c.provider, c.model, c.baseUrl)}
                              aria-label={
                                activeTests[testKey]
                                  ? `取消测试 ${cLabel}`
                                  : `测试 ${cLabel} 延迟`
                              }
                            >
                              {activeTests[testKey] ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                            </Button>
                          </div>
                          <div className="pr-2 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-(--text-muted) hover:text-[var(--destructive)] hover:bg-[var(--destructive-soft-bg)]"
                              onClick={() => setConfirmingDelete(c.id)}
                              aria-label={`删除 ${cLabel} 配置`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 已保存配置编辑表单（一级原地展开）*/}
            {provider && editForm}
            </div>
      )}
    </section>

    {/* Serper -- 独立卡片（与 AI 配置分离）*/}
      <section className="flex flex-col gap-2 mt-6">
        <button
          type="button"
          onClick={() => setSerperExpanded((v) => !v)}
          className="flex items-start justify-between gap-3 w-full text-left cursor-pointer"
          aria-expanded={serperExpanded}
        >
          <div>
            <h3 className="text-base font-semibold text-(--text-primary) inline-flex items-center gap-2">
              <KeyRound size={16} /> Serper 搜索
              {serperData?.hasKey ? (
                <span className={statusBadgeClass}>
                  <Check size={10} strokeWidth={3} />
                  已配置 {serperData.keyHint}
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-(--border) text-(--text-muted)">
                  未配置
                </span>
              )}
            </h3>
            <p className="text-xs text-(--text-muted) mt-0.5">
              直连抓不到网页时借 Google 搜索兜底
            </p>
          </div>
          <ChevronRight
            size={16}
            className={cn('shrink-0 text-(--text-muted) transition-transform mt-1', serperExpanded && 'rotate-90')}
          />
        </button>
        {serperExpanded && (
          <div className={SECTION_CLASS}>
            <div>
              <Label htmlFor="serper-key">Serper API Key</Label>
              <SecretInput
                id="serper-key"
                value={serperKey}
                onChange={(e) => setSerperKey(e.target.value)}
                placeholder={
                  serperData?.hasKey ? '输入新值覆盖原密钥' : '输入 Serper API Key'
                }
              />
            </div>

            <a
              href="https://serper.dev"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-(--accent) inline-flex items-center gap-1 hover:underline w-fit"
            >
              <ExternalLink size={12} /> 获取密钥
            </a>

            <div className="flex gap-2 flex-wrap">
              <Button onClick={onSerperSave} disabled={serperSaving}>保存</Button>
              <Button
                variant="outline"
                onClick={onSerperTest}
                aria-label={activeTests['serper'] ? '取消测试' : '测试 Serper 连通性'}
              >
                {activeTests['serper'] ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                {activeTests['serper'] ? '取消测试' : '测试连接'}
              </Button>
              {serperData?.hasKey && (
                <Button
                  variant="ghost"
                  className="text-[var(--destructive)] hover:bg-[var(--destructive-soft-bg)] hover:text-[var(--destructive)]"
                  onClick={onSerperDelete}
                >
                  <Trash2 size={14} /> 删除
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
