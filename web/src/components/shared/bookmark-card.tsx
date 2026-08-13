import { useEffect, useRef, useState } from 'react'
import { Star, Copy, Globe, Check, Hash, Menu } from 'lucide-react'
import type { Bookmark } from '@/types'
import { faviconUrl } from '@/api/bookmarks'
import { getFavicon, hasNoFavicon, markNoFavicon } from '@/lib/favicon-cache'
import { useToggleFavorite, useReorderBookmarks } from '@/hooks/useBookmarks'
import { useLongPress } from '@/hooks/use-long-press'
import { useUIStore } from '@/stores/ui'
import { highlightText } from '@/lib/bookmark-utils'
import { DRAG_TYPE_BOOKMARK, setDragId } from '@/lib/category-dnd'
import { cn, openInNewTab } from '@/lib/utils'
import { toast } from '@/components/ui/toast'

/**
 * 拖拽 MIME 类型。
 * 用专属 MIME 类型区分"书签拖到分类"和"分类之间排序"，避免共用 text/plain 派发模糊。
 */
/**
 * 书签卡片。
 * - favicon：icon 容器 46×46 radius 10px，内嵌 img 38×38 radius 4px，
 *   暗色主题容器底色 #FAF9F7；onerror 回退 Globe
 * - 收藏星标：绝对定位右上角 20×20，有星标时 title padding-right 28px
 * - 桌面端无三点菜单按钮：菜单靠右键 contextmenu 触发；
 *   footer 的 .copy-btn / .id-badge 默认隐藏，hover 才显示
 * - 批量模式下点击选中；搜索高亮
 * - 拖拽重排：仅非批量模式可拖；移动端不渲染本组件天然不触发。
 *
 * 拖拽视觉用 React state（dragging/dragOver）—— BookmarkCard 是外部稳定组件，
 * 挂载稳定，state 触发的重渲染不卸载 DOM，HTML5 DnD 不会被打断。
 */
export function BookmarkCard({
  bookmark,
  categoryName,
  searchQuery,
  onMenuClick,
  onSelect,
  isNew = false,
  exiting = false,
  onExitDone,
  refreshing = false,
}: {
  bookmark: Bookmark
  categoryName?: string
  searchQuery: string
  onMenuClick: (id: number, x: number, y: number) => void
  /** 批量模式点击选中回调（带修饰键 event，供 Shift 范围选择）；缺省 fallback 到 toggleSelection */
  onSelect?: (e: React.MouseEvent, id: number) => void
  /** 新添加的书签：挂 bookmark-highlight + pop-in*/
  isNew?: boolean
  /** 正在退出（删除）：挂 pop-out，动画结束触发 onExitDone*/
  exiting?: boolean
  /** pop-out 动画结束回调，调用方在此真正删数据*/
  onExitDone?: (id: number) => void
  /** 正在刷新图标：图标容器加 .refreshing class 显示旋转*/
  refreshing?: boolean
}) {
  // 初始值读无图标记忆（favicon-cache）：路由切换重挂时若已知该书签无 favicon（updated_at 匹配），
  // 直接显示 Globe 不发请求，避免"空白->Globe"闪烁。首次或书签更新后走 false 重新尝试 <img>。
  const [faviconError, setFaviconError] = useState(
    () => hasNoFavicon(bookmark.id, bookmark.updated_at),
  )
  // pop-in 动画结束后移除 class（恢复 pointer-events，.pop-in 有 pointer-events: none）
  const [showPopIn, setShowPopIn] = useState(isNew)
  useEffect(() => {
    if (isNew) setShowPopIn(true)
  }, [isNew])
  const [copiedUrl, setCopiedUrl] = useState(false)
  // favicon/updated_at 变（刷新图标或书签更新）：按记忆重新评估错误状态。
  // updated_at 变了 -> 记忆不匹配 -> false，让 <img> 重新加载新 favicon（原"重置 false"语义保留）；
  // updated_at 没变（仅重挂）-> effect 不跑，保持初始值（记忆命中即直接 Globe）。
  useEffect(() => {
    setFaviconError(hasNoFavicon(bookmark.id, bookmark.updated_at))
  }, [bookmark.favicon, bookmark.updated_at, bookmark.id])
  const [copiedId, setCopiedId] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // 拖拽预览与 sidebar 同机制：可见预览 div 用 ref 直接写 left/top（onDrag 高频触发不重渲染），
  // 隐藏 1px 元素只作 setDragImage 掩盖浏览器原生 ghost。
  const dragPreviewRef = useRef<HTMLDivElement>(null)
  const dragImageRef = useRef<HTMLElement | null>(null)
  useEffect(() => () => dragImageRef.current?.remove(), [])
  const toggleFav = useToggleFavorite()
  const reorder = useReorderBookmarks()
  const { batchMode, selectedIds, toggleSelection } = useUIStore()
  const selected = selectedIds.has(bookmark.id)

  // 移动端长按：不触发菜单（菜单已由汉堡按钮承担），只标记忽略后续 contextmenu，
  // 防止浏览器长按后默认 contextmenu 事件弹菜单
  const ignoreNextContextMenu = useRef(false)
  const longPress = useLongPress(() => {
    if (batchMode) return
    ignoreNextContextMenu.current = true
  })

  const handleCardClick = (e: React.MouseEvent) => {
    if (batchMode) {
      // 有 onSelect 回调时交给调用方处理 Shift 范围选择；否则 fallback 到纯 toggle
      if (onSelect) {
        onSelect(e, bookmark.id)
      } else {
        toggleSelection(bookmark.id)
      }
      return
    }
    openInNewTab(bookmark.url)
  }

  /**
   * 复制反馈：clipboard.writeText 成功时切换胶囊 className + 文字（copied 状态），
   * 1500ms 后还原。clipboard 失败（HTTP insecure context / 浏览器拒绝）时静默 + toast 兜底，
   * —— 移动端部分环境下 navigator.clipboard 不可用，必须给用户可感知的反馈。
   * 桌面端 / 移动端共用同一 handler（不复写新 hook），区别只在 dev 部署 context。
   */
  const copyUrl = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard
      .writeText(bookmark.url)
      .then(() => {
        setCopiedUrl(true)
        setTimeout(() => setCopiedUrl(false), 1000)
      })
      .catch(() => toast.error('复制失败，请检查浏览器剪贴板权限'))
  }

  const copyId = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard
      .writeText(`书签ID: ${bookmark.id}`)
      .then(() => {
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 1000)
      })
      .catch(() => toast.error('复制失败，请检查浏览器剪贴板权限'))
  }

  // ===== 拖拽重排（state 驱动视觉）=====
  const onDragStart = (e: React.DragEvent) => {
    setDragging(true)
    setDragId(e.dataTransfer, DRAG_TYPE_BOOKMARK, bookmark.id)
    const preview = document.createElement('div')
    preview.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;pointer-events:none;'
    document.body.append(preview)
    dragImageRef.current = preview
    e.dataTransfer.setDragImage(preview, 0, 0)
    window.requestAnimationFrame(() => {
      if (!dragPreviewRef.current) return
      dragPreviewRef.current.style.left = `${e.clientX + 14}px`
      dragPreviewRef.current.style.top = `${e.clientY + 14}px`
    })
  }
  const onDrag = (e: React.DragEvent) => {
    if (!dragPreviewRef.current || e.clientX === 0 || e.clientY === 0) return
    dragPreviewRef.current.style.left = `${e.clientX + 14}px`
    dragPreviewRef.current.style.top = `${e.clientY + 14}px`
  }
  const onDragEnd = () => {
    setDragging(false)
    setDragOver(false)
    dragImageRef.current?.remove()
    dragImageRef.current = null
  }
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    // 排除自身高亮
    if (!dragging) setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    // 只在真正离开卡片时移除，忽略子元素冒泡
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const fromId = Number(e.dataTransfer.getData(DRAG_TYPE_BOOKMARK))
    if (!fromId || fromId === bookmark.id) return
    reorder.mutate({ fromId, toId: bookmark.id })
  }

  return (
    <>
    <article
      data-bookmark-id={bookmark.id}
      className={cn(
        'bookmark-card group',
        // 批量模式取消 hover 上浮/背景变化
        batchMode && 'batch-mode-card',
        // 选中态挂语义类 selected，样式交 layout.css 的 .bookmark-card.selected
        // （accent 边框 + 双层描边外发光）
        selected && 'selected',
        dragging && 'dragging',
        dragOver && 'drag-over',
        // 进出场动画
        isNew && 'bookmark-highlight',
        showPopIn && 'pop-in',
        exiting && 'pop-out',
        refreshing && 'favicon-refreshing',
      )}
      draggable={!batchMode}
      onAnimationEnd={(e) => {
        // 只在 pop-out 动画结束时触发，避免与 fadeInUp 冲突
        if (exiting && e.animationName === 'popOut') {
          onExitDone?.(bookmark.id)
        }
        // pop-in 结束：移除 class 恢复 pointer-events（.pop-in 有 pointer-events: none）
        // + 清 animation 阻止 class 移除后 fadeInUp 重播（animation 属性变化触发重播）
        if (showPopIn && e.animationName === 'popIn') {
          setShowPopIn(false)
          ;(e.currentTarget as HTMLElement).style.animation = 'none'
        }
        // fadeInUp 结束后清除 animation，避免 fill-mode 锁定 transform 导致 CSS :hover transition 失效
        if (e.animationName === 'fadeInUp') {
          ;(e.currentTarget as HTMLElement).style.animation = 'none'
        }
      }}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={handleCardClick}
      onContextMenu={(e) => {
        if (batchMode) return
        e.preventDefault()
        if (ignoreNextContextMenu.current) {
          ignoreNextContextMenu.current = false
          return
        }
        onMenuClick(bookmark.id, e.clientX, e.clientY)
      }}
      {...longPress}
    >
      <header className="bookmark-header">
        {/* favicon 容器：46×46 radius 10px，暗色主题底色 #FAF9F7
            —— 尺寸/圆角/底色由 layout.css .bookmark-icon-bg 显式固定，不再依赖
            Tailwind v4 token 自动生成 utility（避免 .rounded-btn / .bg-secondary
            在 token 未注入时失效）。卡片 hover 时容器轻微抬起（layout.css） */}
        <div className="bookmark-icon-bg">
          {!faviconError ? (
            <img
              loading="lazy"
              src={bookmark.favicon || getFavicon(bookmark.id, bookmark.updated_at) || faviconUrl(bookmark.id, bookmark.updated_at)}
              alt=""
              onError={() => {
                setFaviconError(true)
                markNoFavicon(bookmark.id, bookmark.updated_at)
              }}
            />
          ) : (
            <Globe className="w-[1.4rem] h-[1.4rem]" strokeWidth={1.5} />
          )}
        </div>
        <div className="bookmark-info">
          <h3
            className="bookmark-title"
            data-favorite={bookmark.is_favorite ? 'true' : undefined}
          >
            {highlightText(bookmark.title, searchQuery)}
          </h3>
          <div className="flex flex-nowrap overflow-hidden gap-[4px] mt-[4px]">
            {categoryName && (
              <span className="bookmark-tag category-tag shrink-0">
                {highlightText(categoryName, searchQuery)}
              </span>
            )}
            {bookmark.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="bookmark-tag">
                {highlightText(tag, searchQuery)}
              </span>
            ))}
          </div>
        </div>

        {/* 收藏星标：绝对定位右上角。
            移动端 right-7 避让汉堡按钮（16px），桌面 right-0（无汉堡）。
            包成 button + before 伪元素向外扩 12px 扩大触控区：图标视觉 16px 不变，
            仅移动端扩大（桌面 md:before:hidden 回 16px，不影响桌面 hover 体验）*/}
        {bookmark.is_favorite && (
          <button
            type="button"
            aria-label="取消收藏"
            className={cn(
              'absolute top-1 right-7 md:right-0 p-0 bg-transparent border-none cursor-pointer rounded transition-transform hover:scale-125',
              'before:absolute before:block before:-inset-3 md:before:hidden',
              // 批量模式下星星不响应点击（穿透到卡片选中），避免误取消收藏
              batchMode && 'pointer-events-none',
            )}
            onClick={(e) => {
              e.stopPropagation()
              if (batchMode) return
              // 取消收藏：直接 mutate（轻操作，可逆--书签没删，切「全部」仍在）。
              // useToggleFavorite.onMutate 翻 is_favorite：收藏视图 filter 立即移除卡片（瞬间消失），
              // 其他视图星标消失、卡片留着。无需区分视图，也无需退场动画。
              // 故意与删除/拖走改分类的 pop-out 不一致：取消收藏是轻操作，果断干净。
              toggleFav.mutate(bookmark.id)
              toast.success('已取消收藏', <Star size={16} style={{ color: 'var(--favorite-star)' }} fill="none" />)
            }}
          >
            <Star className="w-4 h-4 text-[var(--favorite-star)] fill-[var(--favorite-star)] block" />
          </button>
        )}
        {/* 移动端汉堡菜单按钮：absolute top-1 right-0 与 Star 同一水平线对齐，
            尺寸 16×16 与 Star 一致；桌面隐藏（菜单由右键 contextmenu 承担）。
            hover:scale-125 与 Star 交互一致。
            批量模式隐藏（点卡片是选中，不应弹菜单）*/}
        <button
          type="button"
          className={cn(
            'absolute top-1 right-0 w-4 h-4 flex md:hidden items-center justify-center bg-transparent border-none p-0 text-(--text-muted) cursor-pointer rounded transition-transform hover:scale-125',
            'before:absolute before:block before:-inset-3',
            batchMode && 'hidden',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onMenuClick(bookmark.id, e.clientX, e.clientY)
          }}
          title="菜单"
        >
          <Menu size={16} />
        </button>
      </header>

      {/* 批量模式选中徽章：22×22 圆 / accent 实心底 / 橙色光晕阴影 / checkPop 弹出。
         徽章须在 article 层级而非 header 内
         （header 在卡片 padding 里，放 header 内会整体下移导致徽章低于标题行）。
         位置 top-[15px] right-[10px]：标题行右上角，略偏上偏左。
         bg-[var(--accent)] 直接引用 CSS 变量，绕过 Tailwind v4 未生成 bg-accent 类致背景透明的问题。*/}
      {batchMode && selected && (
        <div className="absolute top-[15px] right-[10px] w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--accent)] shadow-[0_2px_8px_var(--selection-glow)] check-pop">
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        </div>
      )}

      <p className="bookmark-desc">
        {bookmark.description ? highlightText(bookmark.description, searchQuery) : ''}
      </p>

      <footer className="bookmark-footer">
        <span className="bookmark-url">
          {highlightText(bookmark.url, searchQuery)}
        </span>
        <div className="bookmark-footer-actions">
          {/* ID 徽章 + 复制按钮：用 id-badge / copy-btn 语义类 + CSS 断点控制可见性。
              桌面端：默认 hidden，hover 时显示（group-hover 行为）；
              移动端：常驻显示（移动端无 hover 概念）。
              copied 状态只改背景/颜色，不影响 display。*/}
          {!batchMode && (
            <button
              className={cn(
                'id-badge items-center gap-[4px] px-[6px] min-w-[44px] justify-center rounded-[20px] text-[0.65rem] h-[18px] transition-all',
                copiedId
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--badge-neutral-bg)] text-[var(--text-muted)] hover:bg-[var(--badge-neutral-bg-hover)] hover:text-[var(--text-secondary)]',
              )}
              style={copiedId ? undefined : { fontFamily: "'SF Mono','Cascadia Code','Consolas',monospace" }}
              onClick={copyId}
              title="点击复制 ID"
            >
              {copiedId ? <Check className="w-3 h-3" /> : <Hash className="w-3 h-3" />}
              <span>{copiedId ? '已复制' : bookmark.id}</span>
            </button>
          )}
          {!batchMode && (
            <button
              className={cn(
                'copy-btn items-center gap-[4px] px-[6px] min-width-[56px] justify-center rounded-[20px] text-[0.65rem] h-[18px] transition-all',
                copiedUrl
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--copy-btn-bg)] text-[var(--accent)] hover:bg-[var(--copy-btn-bg-hover)]',
              )}
              onClick={copyUrl}
            >
              {copiedUrl ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedUrl ? '已复制' : '复制'}</span>
            </button>
          )}
        </div>
      </footer>
    </article>
    {dragging && (
      <div
        ref={dragPreviewRef}
        className="bookmark-drag-preview"
        aria-hidden="true"
      >
        {!faviconError ? (
          <img
            className="bookmark-drag-preview-icon"
            src={bookmark.favicon || getFavicon(bookmark.id, bookmark.updated_at) || faviconUrl(bookmark.id, bookmark.updated_at)}
            alt=""
            onError={() => setFaviconError(true)}
          />
        ) : <span className="bookmark-drag-preview-icon bookmark-drag-preview-fallback">◎</span>}
        <span>{bookmark.title}</span>
      </div>
    )}
    </>
  )
}
