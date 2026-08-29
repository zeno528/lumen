import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { createLazyFileRoute } from '@tanstack/react-router'
import {
  Rocket,
  SlidersHorizontal,
  Bookmark,
  Layers,
  Star,
  Search,
  CheckCheck,
  Import,
  Wand2,
  Keyboard,
  RefreshCw,
  Smartphone,
  Copy,
  Check,
  Image,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SINGLE_PAGE_MAX_WIDTH } from '@/hooks/use-grid-metrics'
import { useBodyScrollLock } from '@/hooks/use-body-scroll-lock'
import { useUIStore } from '@/stores/ui'

export const Route = createLazyFileRoute('/_authed/help')({
  component: HelpPage,
})

const SECTIONS: { id: string; title: string; icon: LucideIcon }[] = [
  { id: 'quick-start', title: '快速开始', icon: Rocket },
  { id: 'settings', title: '设置中心', icon: SlidersHorizontal },
  { id: 'bookmarks', title: '书签管理', icon: Bookmark },
  { id: 'categories', title: '分类管理', icon: Layers },
  { id: 'favorites', title: '收藏功能', icon: Star },
  { id: 'search', title: '搜索', icon: Search },
  { id: 'batch', title: '批量操作', icon: CheckCheck },
  { id: 'import-export', title: '导入 / 导出', icon: Import },
  { id: 'ai', title: 'AI 功能', icon: Wand2 },
  { id: 'realtime', title: '实时同步', icon: RefreshCw },
  { id: 'shortcuts', title: '快捷键', icon: Keyboard },
  { id: 'mobile', title: '移动端', icon: Smartphone },
  { id: 'favicon', title: '网站图标', icon: Image },
]

function HelpPage() {
  const { helpTocOpen, closeHelpToc } = useUIStore()
  const [activeId, setActiveId] = useState(SECTIONS[0].id)

  // section ref 注册表：目录点击 scrollIntoView + active 跟踪都走 ref，
  // 不用 document.getElementById 命令式查 DOM（新架构：ref callback 注册 + 声明式状态驱动）。
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())
  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el)
    else sectionRefs.current.delete(id)
  }, [])
  // 点击目录跳转后锁定 activeId：短 section（如"收藏"/"搜索"）滚到顶部不在 IO 观察带
  // （rootMargin -20%/-70%，只观察视口 20%-30%），IO 回调会选下一个 visible section 覆盖。
  // 锁定期间 IO 不覆盖，150ms 后解锁让用户手动滚动恢复跟踪。
  const scrollLockRef = useRef<string | null>(null)
  const scrollToSection = useCallback(
    (id: string) => {
      // 立即设 active + 瞬时跳：避免 smooth 滚动期间 IO 触发高亮块从上往下流动（用户不要流动轨迹）
      setActiveId(id)
      scrollLockRef.current = id
      sectionRefs.current
        .get(id)
        ?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' })
      closeHelpToc()
      window.setTimeout(() => {
        scrollLockRef.current = null
      }, 150)
    },
    [closeHelpToc],
  )

  // body 滚动锁：与首页侧边栏抽屉行为对齐
  useBodyScrollLock(helpTocOpen)

  // main 滚动容器 ref（IO root + 底部兜底用）
  const mainRef = useRef<HTMLElement>(null)
  // 目录 active 跟踪：IntersectionObserver（root=main 滚动容器）。
  // 回调维护 visible set，选「文档顺序最后一个 visible」= 当前章节（chriskirknielsen 模式），
  // 解决多个 section 同时 intersect 时 last-callback-wins 的不确定顺序问题。
  // 底部兜底优先（在 IO 回调内，不被覆盖）：最后 section 短可能永远不进 active 带，
  // 滚到 main 底部时强制 active 最后一个（Ben Frain 指出的短 section 指针错位问题）。
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) visible.add(e.target.id)
          else visible.delete(e.target.id)
        })
        // 点击目录跳转锁定期间不覆盖 activeId（见 scrollToSection 的 scrollLockRef）
        if (scrollLockRef.current) return
        if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) {
          setActiveId(SECTIONS[SECTIONS.length - 1].id)
          return
        }
        let lastVisible: string | null = null
        for (const { id } of SECTIONS) {
          if (visible.has(id)) lastVisible = id
        }
        if (lastVisible) setActiveId(lastVisible)
      },
      { root: main, rootMargin: '-20% 0px -70% 0px' },
    )
    sectionRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className="relative flex h-full w-full mx-auto overflow-hidden"
      style={{ maxWidth: SINGLE_PAGE_MAX_WIDTH }}
    >
      {/* 移动端目录抽屉遮罩（helpTocOpen 状态驱动，Zustand） */}
      <div
        className={cn(
          'fixed inset-0 z-[200] bg-black/45 md:hidden',
          'transition-[opacity,visibility] duration-300 ease-out',
          helpTocOpen
            ? 'opacity-100 visible pointer-events-auto'
            : 'opacity-0 invisible pointer-events-none',
        )}
        onClick={closeHelpToc}
      />

      {/* 左侧目录：桌面 sticky 固定；移动端抽屉（translate 由 helpTocOpen 状态驱动） */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-[300] h-dvh w-[280px]',
          'bg-(--bg-secondary) rounded-r-2xl p-5 pr-4 flex flex-col',
          'transition-transform duration-250 ease-out',
          helpTocOpen ? 'translate-x-0' : '-translate-x-full',
          'md:sticky md:top-0 md:z-auto md:h-full md:w-[200px] md:min-w-[200px]',
          'md:bg-transparent md:rounded-none md:pr-4',
          'md:translate-x-0 md:flex',
        )}
      >
        <div className="pb-3 mb-3 border-b border-(--border)">
          <div className="text-xs font-semibold uppercase tracking-wider text-(--text-muted)">
            目录
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-hover">
          <ul className="space-y-0.5">
            {SECTIONS.map(({ id, title, icon: Icon }, idx) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(id)}
                  className={cn('help-toc-item', activeId === id && 'active')}
                  aria-current={activeId === id ? 'true' : undefined}
                >
                  <span className="help-toc-num">{String(idx + 1).padStart(2, '0')}</span>
                  <Icon size={14} className="icon" />
                  <span>{title}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* 内容：桌面态独立滚动（左侧 aside 固定不动） */}
      <main ref={mainRef} className="flex-1 overflow-y-auto scrollbar-hover px-4 md:px-8 lg:px-10 py-6 md:py-8 pb-0 md:pb-24 select-text">
        {/* Hero 封面 */}
        <div className="help-hero" id="intro">
          <h1 className="help-hero-title">
            <img src="/logo_color.svg" alt="" />
            <span>Lumen 使用指南</span>
          </h1>
          <p className="help-hero-sub">
            <span className="dot" />
            轻量、自托管的书签管理器 · AI 加持 · 隐私优先 · 单用户部署
          </p>
          <a
            className="help-hero-link"
            href="https://github.com/zeno528/lumen"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="在 GitHub 上查看 zeno528/lumen 仓库"
          >
            <GithubMark aria-hidden />
            <span className="owner">zeno528</span>
            <span className="sep">/</span>
            <span className="repo">lumen</span>
          </a>
        </div>

        <Section id="quick-start" index={1} icon={Rocket} title="快速开始" registerRef={registerSection}>
          <H3>登录</H3>
          <p>
            打开页面后输入账号和密码登录。默认账号 <Code>admin</Code>；首次启动的密码由部署时设置的
            <Code>APP_PASSWORD</Code> 环境变量决定（本地开发未设置时回退 <Code>admin</Code>）。
            建议登录后进入「设置中心」-&gt;「账号」修改密码。
          </p>
          <p>
            项目为<strong>单用户部署</strong>，账号名在「设置中心 -&gt; 账号 -&gt; 修改账号」处修改（会影响后续所有登录）。
          </p>
          <H3>添加第一个书签</H3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>点击右下角的 <Kbd>+</Kbd> 悬浮按钮，或按快捷键 <Kbd>Ctrl</Kbd> + <Kbd>I</Kbd></li>
            <li>在弹出窗口中输入网址（URL），标题和描述会自动获取</li>
            <li>选择分类，点击保存</li>
          </ol>
          <Tip>粘贴 URL 后，系统会自动获取网站标题、描述和图标。</Tip>
        </Section>

        <Section id="settings" index={2} icon={SlidersHorizontal} title="设置中心" registerRef={registerSection}>
          <p>设置中心分四个 tab：<strong>账号</strong> / <strong>外观</strong> / <strong>AI 设置</strong> / <strong>API Token</strong>。</p>
          <H3>账号</H3>
          <p>可修改：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>头像</strong> - 多种图标 + 自定义背景颜色 + 自定义头像图片，同步保存到服务器</li>
            <li><strong>昵称</strong> - 显示在顶栏头像区</li>
            <li><strong>账号 & 密码</strong> - 登录凭据，密码修改后立即生效</li>
            <li><strong>清空所有书签</strong>（设置窗口左下角，四个 tab 均可见）- 一键清空全部书签与分类，不可恢复</li>
            <li><strong>退出登录</strong> - 清除登录态并返回登录页</li>
          </ul>
          <H3>外观</H3>
          <p>
            <strong>深浅主题</strong>（浅色 / 深色）与<strong>配色方案</strong>（赤陶为默认 / 暗金 / 勃艮第 /
            琥珀橙 / 靛蓝 / 海洋蓝）都在本 tab 选择，偏好存 <Code>localStorage</Code>；
            深浅主题同样可在顶栏头像下拉切换，双向同步。
          </p>
          <H3>AI 设置</H3>
          <p>配置 AI Provider 与 Serper 搜索，详见下方「AI 功能」章节。</p>
          <H3>API Token</H3>
          <p>创建第三方访问令牌，用于 AI 工具（如 Claude Code）直接管理书签。在请求头中携带：</p>
          <CodeBlock>Authorization: Bearer msk_your_token_here</CodeBlock>
          <Tip>Token 创建后只显示一次，请妥善保管。可以随时删除不需要的 Token。</Tip>
        </Section>

        <Section id="bookmarks" index={3} icon={Bookmark} title="书签管理" registerRef={registerSection}>
          <H3>添加书签</H3>
          <ul className="list-disc pl-5 space-y-1">
            <li>点击 <Kbd>+</Kbd> 按钮或按 <Kbd>Ctrl</Kbd> + <Kbd>I</Kbd></li>
            <li>填写 URL、标题、描述，选择分类</li>
            <li>可添加标签（Tags）方便检索</li>
          </ul>
          <H3>编辑 & 删除</H3>
          <p>
            <strong>桌面端</strong>：右键点击书签卡片打开菜单，可编辑、收藏、智能填充、刷新图标、删除。
            <strong>移动端</strong>：每张卡片右上角有一个汉堡按钮（点击展开菜单）；长按不会弹菜单，
            避免与 iOS/Android 系统菜单冲突。
          </p>
          <H3>URL 重复检测</H3>
          <p>
            保存书签时若数据库已有相同 URL，后端会以 HTTP 409 + 「书签已存在」错误拒绝写入。
            前端处理：弹窗已乐观关闭且会立即弹「书签已添加」通知；异步检测到 409 时把弹窗重新打开、
            URL 字段下方显示红字「该网址已存在」，同时弹一个 warning toast 提示修改。
          </p>
          <Tip>
            这是「race 兜底」设计：本地列表查不到重复但后端 SQL UNIQUE 约束拦截（多端写入、列表缓存陈旧）。
            URL 字段下方有「实时重复预览」，保存前会先看到红字，409 主要兜这种竞态场景。
          </Tip>
        </Section>

        <Section id="categories" index={4} icon={Layers} title="分类管理" registerRef={registerSection}>
          <H3>创建分类</H3>
          <p>点击侧边栏分类标题旁的「新建」按钮，输入名称并选择图标和颜色。</p>
          <H3>右键菜单</H3>
          <p>右键分类名称可进行编辑、复制 ID 和删除。右键「收藏」分类可选择「全部取消收藏」，右键「未分类」可选择「清空未分类」。</p>
          <H3>未分类书签</H3>
          <p>没有分配分类的书签会自动归入「未分类」分组。</p>
        </Section>

        <Section id="favorites" index={5} icon={Star} title="收藏功能" registerRef={registerSection}>
          <p>右键点击书签卡片选择「收藏」即可标记。收藏的书签会出现在侧边栏「收藏」分类中，右键该分类可选择「全部取消收藏」。</p>
        </Section>

        <Section id="search" index={6} icon={Search} title="搜索" registerRef={registerSection}>
          <ul className="list-disc pl-5 space-y-1">
            <li>按 <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> 或点击搜索框聚焦</li>
            <li>实时匹配标题、描述、URL、标签与分类名</li>
            <li>空格分隔多个关键词需全部命中，顺序不限（如 <Code>git 下载</Code>）；中英文连写自动拆词（<Code>git下载</Code> 与 <Code>git 下载</Code> 等价）</li>
            <li>输入 <Code>#数字</Code>，或开启 ID 搜索后直接输数字，可按书签 ID 精确查找，按回车直达打开</li>
            <li>单个关键词命中会高亮显示</li>
          </ul>
        </Section>

        <Section id="batch" index={7} icon={CheckCheck} title="批量操作" registerRef={registerSection}>
          <H3>书签批量</H3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>点击顶部工具栏的批量按钮进入批量模式（或 <Kbd>Ctrl</Kbd> + <Kbd>B</Kbd>）</li>
            <li>点击书签卡片进行多选</li>
            <li>按住 <Kbd>Shift</Kbd> + 点击可选中从上次点击位置到当前位置的连续范围（对齐 Windows 资源管理器：范围内全选、范围外取消；连续 Shift 点击可收窄或平移范围，锚点保持不变）</li>
            <li>底部操作栏支持：批量删除、移动到分类、添加/移除标签、导出选中</li>
            <li>完成后再次点击批量按钮或按 Esc 退出</li>
          </ol>
          <H3>分类批量</H3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>点击侧边栏分类标题旁「新建」右侧的菜单按钮，选择「批量管理分类」；也可按 <Kbd>Ctrl</Kbd> + <Kbd>Shift</Kbd> + <Kbd>B</Kbd></li>
            <li>点击分类多选，<Kbd>Shift</Kbd> + 点击范围选择（仅真实分类可选，收藏 / 未分类不参与）</li>
            <li>操作栏：删除选中分类（其下书签自动变为未分类，不丢失）</li>
            <li>按 Esc 或点退出按钮退出</li>
          </ol>
        </Section>

        <Section id="import-export" index={8} icon={Import} title="导入 / 导出" registerRef={registerSection}>
          <H3>入口</H3>
          <p>
            入口在<strong>左侧边栏底部</strong>，「导入」「导出」两个并排按钮（仅桌面端可见）。
            移动端通过 Dock -&gt; 主侧栏 -&gt; 抽屉底部也能访问。
          </p>
          <H3>导出</H3>
          <ul className="list-disc pl-5 space-y-1">
            <li>可在导出窗口选择格式：<strong>JSON</strong> 用于完整备份，可再次导入；<strong>HTML</strong> 是可直接在浏览器打开的只读书签页。</li>
            <li>HTML 按分类展示书签卡片，保留网站图标、标题、域名、描述、标签和收藏标记；它只用于查看，不支持导入。</li>
            <li>默认文件名为 <Code>lumenbackup-{`<host>`}-{`<YYYYMMDD>`}</Code>，扩展名会随所选格式自动补为 <Code>.json</Code> 或 <Code>.html</Code>。</li>
            <li>批量导出：先进入批量模式选中书签（<Kbd>Ctrl</Kbd> + <Kbd>B</Kbd>），底部操作栏选择「导出选中」即可下载。</li>
            <li>导出流程：点击「导出」-&gt; 系统自动拉取数据 -&gt; 选择文件名和格式 -&gt; 查看数量与文件大小 -&gt; 点击「导出」下载。</li>
          </ul>
          <H3>导入</H3>
          <p>
            导入目前<strong>只支持 JSON</strong>：点击「导入」选择之前导出的 JSON 文件即可。采用<strong>自动合并</strong>模式，
            已存在的 URL 会被跳过（依赖数据库 UNIQUE 约束去重），导入完成弹模态框显示
            「新增书签 / 跳过重复 / 新增分类」统计。
          </p>
        </Section>

        <Section id="ai" index={9} icon={Wand2} title="AI 功能" registerRef={registerSection}>
          <H3>入口</H3>
          <p>
            设置中心 -&gt; AI 设置。该区域独立 tab，包含两部分：<strong>AI Provider</strong>与<strong>Serper 搜索</strong>。
          </p>
          <H3>AI 智能填充</H3>
          <p>
            添加或编辑书签时点击「智能填充」按钮（<Code>Sparkles</Code> 图标），AI 将自动获取网页内容
            并生成标题、描述和标签；顶栏的 <Kbd>Topbar AI</Kbd> 按钮用于快速切换已配置的 AI 模型（提供商），点击下拉选目标模型。
          </p>
          <H3>配置 AI Provider</H3>
          <p>
            设置中心 -&gt; AI 设置 -&gt; 新增配置，在 Provider 网格里点选服务商（DeepSeek / 智谱 GLM / MiniMax / 硅基流动 /
            Anthropic / 自定义），填入 API Key -&gt; 点击「测试连接」验证 -&gt; 保存。
            密钥使用 AES-256-GCM 加密存储；多个 Provider 可同时配置并随时切换。
          </p>
          <H3>Serper 搜索（反爬站兜底）</H3>
          <p>
            部分网站启用反爬，直接抓取会失败。<strong>设置中心 -&gt; AI 设置 -&gt; 「Serper 搜索」区域</strong>填写
            Serper API Key 保存即可，系统会用搜索结果作为兜底方案。Serper Key 与 AI Provider Key
            独立存储，互不影响。
          </p>
          <Tip>
            「测试连接」按钮覆盖 AI 和 Serper 两个区块：先用候选 Key 试通一次再写入数据库，避免存一个无效 Key
            占用配额。
          </Tip>
        </Section>

        <Section id="realtime" index={10} icon={RefreshCw} title="实时同步" registerRef={registerSection}>
          <H3>跨设备同步</H3>
          <p>
            Lumen 通过 WebSocket 实时同步多设备 / 多标签页的书签与分类变更--在 A 设备改了书签，
            B 设备无需刷新即可自动更新。
          </p>
          <H3>连接状态指示器</H3>
          <p>
            顶栏<strong>头像右侧</strong>的小圆点 + 状态文字反映实时同步的连接状态：
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>🟢 <strong>绿色</strong>（已连接）- 正常，变更实时推送</li>
            <li><strong>首次连接</strong> - 静默建立连接，成功后直接显示“已连接”</li>
            <li>🟠 <strong>橙色 + 脉冲</strong>（重连中）- 连接断开，指数退避自动重连</li>
            <li>🔴 <strong>红色</strong>（已断开）- 重连 10 次失败放弃，需刷新页面重新连接</li>
          </ul>
          <Tip>
            断线重连采用指数退避（1s -&gt; 2s -&gt; 4s … 上限 30s，含 ±30% 抖动），最多重试 10 次。
            重连成功后会自动全量补齐断线期间错过的变更。
          </Tip>
        </Section>

        <Section id="shortcuts" index={11} icon={Keyboard} title="快捷键" registerRef={registerSection}>
          <ShortcutTable
            rows={[
              { keys: ['Ctrl', 'K'], action: '聚焦搜索框' },
              { keys: ['Ctrl', 'I'], action: '新建书签' },
              { keys: ['Ctrl', 'Shift', 'I'], action: '新建分类' },
              { keys: ['Ctrl', ','], action: '打开设置中心' },
              { keys: ['Ctrl', 'B'], action: '书签批量模式（再按一次或 Esc 退出）' },
              { keys: ['Ctrl', 'Shift', 'B'], action: '分类批量模式（再按一次或 Esc 退出）' },
              { keys: ['Enter'], action: '弹窗内输入框保存（描述框除外）/ ID 搜索命中时直达打开' },
              { keys: ['Ctrl', 'Enter'], action: '保存（弹窗内，任意位置触发）' },
              { keys: ['Tab'], action: '标签输入框追加英文逗号分隔（弹窗内）' },
              { keys: ['Esc'], action: '关闭弹窗 / 退出批量模式 / 清空搜索' },
            ]}
          />
        </Section>

        <Section id="mobile" index={12} icon={Smartphone} title="移动端" registerRef={registerSection}>
          <H3>底部 Dock 工具栏</H3>
          <p>
            窄屏下底部 Dock 提供四个入口：<strong>搜索 / 批量 / 添加 / 主侧栏</strong>。
            <strong>帮助页</strong>的 Dock 不同：<strong>目录 / 开始 / 快捷键 / 书签</strong>四个按钮（书签 = 返回书签主页）。
          </p>
          <H3>侧边栏抽屉</H3>
          <p>
            点击 Dock 上的<strong>「主侧栏」</strong>按钮（<Code>PanelLeft</Code> 图标）从左侧滑出分类抽屉，
            选择分类后自动关闭抽屉。点击左上角 Logo 是<strong>滚到顶部</strong>，<em>不</em>打开抽屉。
          </p>
          <H3>移动端特有交互</H3>
          <ul className="list-disc pl-5 space-y-1">
            <li>书签卡片菜单改为点击右上角的「汉堡按钮」唤起；长按不弹菜单，仅触发「忽略原生 contextmenu」防止 iOS / Android 系统菜单冲突。</li>
            <li>批量模式下不支持 Shift 范围选择，需逐个点击累积选中。</li>
          </ul>
        </Section>

        <Section id="favicon" index={13} icon={Image} title="网站图标" registerRef={registerSection}>
          <H3>自动抓取</H3>
          <p>
            添加书签时 Lumen 自动抓取网站图标（favicon），无需手动设置。抓取走多级降级链路，
            命中即停，尽量保证每个书签都有图标。
          </p>

          <H3>抓取链路（3 个阶段，按优先级降级，命中即停）</H3>
          <p>每个阶段都先查<strong>原始域名</strong>，miss 再回退<strong>主域名</strong>（如 <Code>mail.feishu.cn</Code> -&gt; <Code>feishu.cn</Code>）。整条链路全 miss 才返回 404（显示默认地球）。</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong>阶段 0 · 品牌库 SVG</strong>：theSVG（6,419+ 品牌，registry 精准域名映射）首选，
              Simple Icons（3,000+ 品牌）备选。矢量图，清晰且能按深浅主题着色。先查原始域名，miss 回退主域名。
            </li>
            <li>
              <strong>阶段 1/2 · 站点自身</strong>：直连目标网站，先解析 HTML 的 <Code>{'<link>'}</Code> 标签，
              再试 <Code>/favicon.ico</Code>、<Code>/favicon.svg</Code> 等常见路径。先原始域名，miss 回退主域名。
            </li>
            <li>
              <strong>阶段 3 · 第三方 6 家并发兜底</strong>：前两阶段全 miss 时，6 家服务并发请求，取最快返回的那家。先原始域名，miss 回退主域名。6 家分别是：
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li><strong>Google S2</strong>（<Code>google.com/s2/favicons</Code>）-- 业内覆盖率最高，限流未公开</li>
                <li><strong>DuckDuckGo</strong>（<Code>icons.duckduckgo.com</Code>）-- 隐私优先，限流未公开</li>
                <li><strong>favicone.com</strong> -- 第三方 favicon 服务，64px</li>
                <li><strong>favicon.im</strong> -- Cloudflare 边缘缓存</li>
                <li><strong>icon.horse</strong> -- 第三方 favicon 服务</li>
                <li><strong>Logo.dev</strong> -- 50M+ 公司 logo，<Code>fallback=404</Code> 让 miss 返回 404 跳过</li>
              </ul>
            </li>
          </ol>

          <H3>存储与刷新</H3>
          <p>
            抓到的图标以 dataURI 存入数据库，刷新页面不重抓。图标过期或错误时，
            右键书签卡片选「刷新图标」重新抓取。
          </p>
          <Tip>
            品牌库 SVG 质量最高（矢量 + 主题适配），知名品牌优先走品牌库；前 5 家第三方匿名免 key，
            Logo.dev 需 token（免费 500K/月，本页底部有 attribution）。
          </Tip>
        </Section>
        <p className="text-xs text-(--text-muted) text-center py-4 select-none">
          Logos provided by{' '}
          <a href="https://www.logo.dev" target="_blank" rel="noreferrer noopener" className="hover:text-(--accent) underline">
            Logo.dev
          </a>
        </p>
      </main>
    </div>
  )
}

/**
 * 章节卡片：Poppins 编号 + 图标 + 标题，进入视口时 fadeInUp 揭示（一次性）。
 * registerRef：把 section 元素注册到父级 ref 注册表，供目录 scrollIntoView + active 跟踪（非 DOM 查询）。
 */
function Section({
  id,
  index,
  icon: Icon,
  title,
  children,
  registerRef,
}: {
  id: string
  index: number
  icon: LucideIcon
  title: string
  children: ReactNode
  registerRef?: (id: string, el: HTMLElement | null) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    registerRef?.(id, el)
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setRevealed(true)
            io.disconnect()
          }
        })
      },
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      registerRef?.(id, null)
    }
  }, [id, registerRef])
  return (
    <section ref={ref} id={id} className={cn('help-section', revealed && 'revealed')}>
      <div className="help-section-head">
        <span className="help-section-num">{String(index).padStart(2, '0')}</span>
        <Icon size={18} className="help-section-icon" />
        <h2>{title}</h2>
      </div>
      <div className="help-section-body">{children}</div>
    </section>
  )
}

function H3({ children }: { children: ReactNode }) {
  return <h3>{children}</h3>
}

function Code({ children }: { children: ReactNode }) {
  return <code className="help-code">{children}</code>
}

/**
 * GitHub 商标 octocat 用品牌 inline SVG 渲染（Lucide 已移除商标图标，
 * 不打包额外依赖）。尺寸 14×14 与 hero-link 文字 baseline 对齐，
 * 当前 color 跟随 inherit，跟 tooltip / button 里的 svg 一致。
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.96 3.22 9.16 7.69 10.65.56.1.77-.24.77-.54 0-.27-.01-1-.02-1.95-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.72.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.44.11-3 0 0 .95-.31 3.1 1.15.9-.25 1.86-.37 2.82-.38.96.01 1.92.13 2.82.38 2.15-1.46 3.1-1.15 3.1-1.15.61 1.56.23 2.71.11 3 .72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.28-5.14 5.56.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.05 0 .3.21.65.78.54 4.46-1.49 7.68-5.69 7.68-10.65C23.25 5.48 18.27.5 12 .5Z" />
    </svg>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="help-kbd">{children}</kbd>
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="help-tip">
      <strong>提示</strong>
      <span>{children}</span>
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <code className="help-codeblock">{children}</code>
      <button
        type="button"
        className={cn(
          'absolute top-2 right-2 p-1.5 rounded-md border border-(--border) bg-(--bg-secondary) text-(--text-secondary) hover:text-(--accent) hover:border-(--accent) transition-all',
          copied && 'text-(--accent) border-(--accent)',
        )}
        onClick={() => {
          navigator.clipboard.writeText(children).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        title="复制"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function ShortcutTable({ rows }: { rows: { keys: string[]; action: string }[] }) {
  return (
    <table className="help-shortcut-table">
      <thead>
        <tr>
          <th>快捷键</th>
          <th>功能</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>
              <div className="help-shortcut-keys">
                {row.keys.map((k, idx) => (
                  <span key={idx} className="contents">
                    {idx > 0 && <span className="text-(--text-muted)">+</span>}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </div>
            </td>
            <td>{row.action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
