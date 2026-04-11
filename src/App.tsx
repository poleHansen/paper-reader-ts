import { Component, useEffect, useMemo, useState } from 'react'
import { summaryCards } from './data/paperData'
import {
  createImportTask,
  createGithubSyncTask,
  askPaperQuestion,
  fetchCondaEnvironments,
  fetchPaperDocument,
  fetchTaskFeed,
  fetchSettings,
  saveSettings,
  subscribeTaskFeed,
  uploadAndImportPdf,
} from './lib/api'
import type { AnchorBounds, AnchorItem, Block, CondaEnvironmentItem, FigureItem, OutlineItem, Page, PageMeta, ParseTask, SettingsState } from './types'

const defaultSettings: SettingsState = {
  provider: 'OpenAI Compatible',
  model: 'gpt-4.1-mini',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  githubRepo: 'honor/paper-reader-assets',
  githubBranch: 'main',
  condaEnv: 'daling-test',
  condaExePath: 'D:/Anaconda/Scripts/conda.exe',
  pythonExePath: '',
  mineruRoot: 'D:/code/paper-reader-ts/pdf_cut/MinerU',
  outputRoot: 'D:/code/paper-reader-ts/workspace/runs',
  githubToken: '',
  deviceMode: 'cuda',
  executionMode: 'api-first',
  mineruModelSource: 'local',
  mineruConfigPath: 'D:/code/paper-reader-ts/pdf_cut/MinerU/mineru.json',
}

const getText = (items: unknown): string => {
  if (!Array.isArray(items)) {
    return ''
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return ''
      }
      const content = (item as { content?: unknown }).content
      return typeof content === 'string' ? content : ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const renderBlock = (block: Block, index: number, assetBasePath: string) => {
  if (block.type === 'title') {
    const content = block.content as { title_content?: unknown; level?: number }
    const title = getText(content.title_content)
    const HeadingTag = content.level === 1 ? 'h1' : content.level === 2 ? 'h2' : 'h3'
    return <HeadingTag key={`title-${index}`}>{title}</HeadingTag>
  }

  if (block.type === 'paragraph') {
    const content = block.content as { paragraph_content?: unknown }
    return <p key={`paragraph-${index}`}>{getText(content.paragraph_content)}</p>
  }

  if (block.type === 'image') {
    const content = block.content as {
      image_source?: { path?: string }
      image_caption?: unknown
    }
    const src = `${assetBasePath}/${content.image_source?.path ?? ''}`
    return (
      <figure key={`image-${index}`} className="paper-figure">
        <img src={src} alt={getText(content.image_caption) || 'paper figure'} />
        <figcaption>{getText(content.image_caption)}</figcaption>
      </figure>
    )
  }

  return null
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || '页面渲染失败' }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="app-shell">
          <main className="workspace-grid error-state-shell">
            <section className="hero-card">
              <div className="eyebrow">Runtime Error</div>
              <h2>界面渲染失败</h2>
              <p>{this.state.message}</p>
            </section>
          </main>
        </div>
      )
    }

    return this.props.children
  }
}

function App() {
  const [pages, setPages] = useState<Page[]>([])
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [figures, setFigures] = useState<FigureItem[]>([])
  const [anchors, setAnchors] = useState<AnchorItem[]>([])
  const [pageMetas, setPageMetas] = useState<PageMeta[]>([])
  const [taskFeed, setTaskFeed] = useState<ParseTask[]>([])
  const [activePanel, setActivePanel] = useState<'assistant' | 'outline' | 'figures'>('assistant')
  const [activePage, setActivePage] = useState(1)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(defaultSettings)
  const [bootstrapError, setBootstrapError] = useState('')
  const [assetBasePath, setAssetBasePath] = useState('/工业缺陷零样本分割2026/auto')
  const [paperTitle, setPaperTitle] = useState('SSVP: Synergistic Semantic-Visual Prompting')
  const [filePath, setFilePath] = useState('D:/code/paper-reader-ts/工业缺陷零样本分割2026/工业缺陷零样本分割2026.pdf')
  const [folderPath, setFolderPath] = useState('D:/code/paper-reader-ts/workspace/runs')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeAnchorId, setActiveAnchorId] = useState('')
  const [chatInput, setChatInput] = useState('请总结这篇论文的核心创新，并说明当前页重点。')
  const [chatError, setChatError] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [condaEnvs, setCondaEnvs] = useState<CondaEnvironmentItem[]>([])
  const [condaEnvError, setCondaEnvError] = useState('')
  const [isRefreshingCondaEnvs, setIsRefreshingCondaEnvs] = useState(false)

  const condaOptions = useMemo(() => {
    const options = [...condaEnvs]

    if (settings.condaEnv && !options.some((env) => env.name === settings.condaEnv)) {
      options.unshift({
        name: settings.condaEnv,
        path: settings.condaEnv,
      })
    }

    return options
  }, [condaEnvs, settings.condaEnv])

  const refreshCondaEnvs = async () => {
    setIsRefreshingCondaEnvs(true)
    try {
      const response = await fetchCondaEnvironments()
      setCondaEnvs(response.envs)
      setCondaEnvError(response.error)
      if (!settings.condaExePath && response.condaExePath) {
        setSettings((current) => ({ ...current, condaExePath: response.condaExePath }))
      }
    } catch (error) {
      setCondaEnvError(error instanceof Error ? error.message : '加载 Conda 环境失败')
    } finally {
      setIsRefreshingCondaEnvs(false)
    }
  }

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [document, storedSettings] = await Promise.all([
          fetchPaperDocument(),
          fetchSettings(),
        ])
        setPages(document.pages)
        setOutline(document.outline)
        setFigures(document.figures)
        setAnchors(document.anchors)
        setPageMetas(document.pageMetas)
        setAssetBasePath(document.assetBasePath)
        setPaperTitle(document.paperTitle)
        setSettings(storedSettings)
        const condaResponse = await fetchCondaEnvironments()
        setCondaEnvs(condaResponse.envs)
        setCondaEnvError(condaResponse.error)
      } catch (error) {
        setBootstrapError(error instanceof Error ? error.message : '加载本地服务失败')
      }
    }

    void bootstrap()

    const unsubscribe = subscribeTaskFeed((tasks) => {
      setTaskFeed(tasks)
      void fetchPaperDocument()
        .then((document) => {
          setPages(document.pages)
          setOutline(document.outline)
          setFigures(document.figures)
          setAnchors(document.anchors)
          setPageMetas(document.pageMetas)
          setAssetBasePath(document.assetBasePath)
          setPaperTitle(document.paperTitle)
        })
        .catch(() => undefined)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const currentPage = useMemo<Page>(() => pages[activePage - 1] ?? [], [activePage, pages])
  const currentAnchors = useMemo(
    () => anchors.filter((anchor) => anchor.page === activePage).slice(0, 8),
    [activePage, anchors],
  )
  const currentPageMeta = useMemo<PageMeta>(
    () => pageMetas.find((meta) => meta.page === activePage) ?? { page: activePage, width: 1700, height: 2200 },
    [activePage, pageMetas],
  )
  const currentAnchorBounds = useMemo<AnchorBounds>(() => {
    const validAnchors = currentAnchors.filter((anchor) => anchor.bbox.length === 4)
    if (!validAnchors.length) {
      return { minX: 0, minY: 0, maxX: currentPageMeta.width, maxY: currentPageMeta.height }
    }

    return validAnchors.reduce(
      (bounds, anchor) => {
        const [x1, y1, x2, y2] = anchor.bbox
        return {
          minX: Math.min(bounds.minX, x1),
          minY: Math.min(bounds.minY, y1),
          maxX: Math.max(bounds.maxX, x2),
          maxY: Math.max(bounds.maxY, y2),
        }
      },
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 },
    )
  }, [currentAnchors, currentPageMeta.height, currentPageMeta.width])

  const handleImport = async () => {
    if (selectedFile) {
      const response = await uploadAndImportPdf(selectedFile)
      setFilePath(response.filePath)
      setTaskFeed((current) => [response.task, ...current])
      setActivePanel('assistant')
      return
    }

    if (!filePath) {
      return
    }

    const task = await createImportTask(filePath)
    setTaskFeed((current) => [task, ...current])
    setActivePanel('assistant')
  }

  const handleGithubSync = async () => {
    if (!folderPath) {
      return
    }

    const task = await createGithubSyncTask(folderPath)
    setTaskFeed((current) => [task, ...current])
    setActivePanel('assistant')
  }

  const handleSaveSettings = async () => {
    const nextSettings = await saveSettings(settings)
    setSettings(nextSettings)
    const [nextTasks, condaResponse] = await Promise.all([
      fetchTaskFeed(),
      fetchCondaEnvironments(),
    ])
    setTaskFeed(nextTasks)
    setCondaEnvs(condaResponse.envs)
    setCondaEnvError(condaResponse.error)
    setIsSettingsOpen(false)
  }

  const handleAsk = async () => {
    if (!chatInput.trim() || isAsking) {
      return
    }

    setIsAsking(true)
    setChatError('')
    const queuedQuestion = chatInput.trim()
    const pendingId = `chat-${Date.now()}`

    setTaskFeed((current) => [
      {
        id: pendingId,
        kind: 'chat',
        title: '论文问答',
        detail: queuedQuestion,
        status: 'queued',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        logs: ['正在整理当前页与锚点上下文。'],
        citations: activeAnchorId ? [`P.${activePage}`, `Anchor ${activeAnchorId}`] : [`P.${activePage}`],
      },
      ...current,
    ])

    try {
      const response = await askPaperQuestion({
        question: queuedQuestion,
        page: activePage,
        anchorId: activeAnchorId,
      })
      setTaskFeed((current) =>
        current.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                status: 'ready',
                detail: response.answer,
                logs: [queuedQuestion],
                citations: response.citations,
              }
            : item,
        ),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '提问失败'
      setChatError(message)
      setTaskFeed((current) =>
        current.map((item) =>
          item.id === pendingId
            ? {
                ...item,
                status: 'failed',
                detail: message,
                logs: [queuedQuestion],
              }
            : item,
        ),
      )
    } finally {
      setIsAsking(false)
    }
  }

  const isBootstrapping = pages.length === 0 && !bootstrapError

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">PR</div>
          <div>
            <div className="eyebrow">Paper Workspace</div>
            <div className="brand-title">Industrial Paper Reader</div>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => void handleImport()}>导入论文</button>
          <button className="primary-button" onClick={() => void handleGithubSync()}>同步图片</button>
          <button className="icon-button" onClick={() => setIsSettingsOpen(true)}>
            设置
          </button>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="left-panel">
          <section className="hero-card">
            <div>
              <div className="eyebrow">Live Workspace</div>
              <h2>论文阅读助手</h2>
            </div>
            <p>
              顶部负责导入与配置，左侧持续输出解析与问答流，右侧保持沉浸式阅读。当前页面已绑定你现有的 MinerU 解析结果。
            </p>
            <div className="quick-import-grid">
              <label>
                直接上传 PDF
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                本地 PDF 路径
                <input value={filePath} onChange={(event) => setFilePath(event.target.value)} />
              </label>
              <label>
                图片目录
                <input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} />
              </label>
            </div>
            {bootstrapError ? <p>{bootstrapError}</p> : null}
            <div className="summary-grid">
              {summaryCards.map((item) => (
                <div key={item.label} className="summary-tile">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel-tabs">
            <button
              className={activePanel === 'assistant' ? 'tab active' : 'tab'}
              onClick={() => setActivePanel('assistant')}
            >
              AI 工作流
            </button>
            <button
              className={activePanel === 'outline' ? 'tab active' : 'tab'}
              onClick={() => setActivePanel('outline')}
            >
              目录
            </button>
            <button
              className={activePanel === 'figures' ? 'tab active' : 'tab'}
              onClick={() => setActivePanel('figures')}
            >
              图表
            </button>
          </section>

          <section className="panel-content">
            {activePanel === 'assistant' && (
              <div className="stream-list">
                {taskFeed.map((task) => (
                  <article key={task.id} className={`stream-card ${task.status}`}>
                    <div className="stream-meta">
                      <span>{task.kind === 'chat' ? `${task.title} · ${task.citations?.join(' · ') ?? ''}` : task.title}</span>
                      <time>{task.timestamp}</time>
                    </div>
                    <p>{task.detail}</p>
                    {task.logs?.length ? <pre className="stream-log">{task.logs.slice(-4).join('\n')}</pre> : null}
                  </article>
                ))}
                <div className="chat-composer">
                  <textarea
                    rows={4}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                  />
                  {chatError ? <p className="chat-status error">{chatError}</p> : null}
                  <button className="primary-button wide-button" onClick={() => void handleAsk()}>
                    {isAsking ? '思考中...' : '发送'}
                  </button>
                </div>
              </div>
            )}

            {activePanel === 'outline' && (
              <div className="outline-list">
                {outline.map((item) => (
                  <button
                    key={item.id}
                    className={item.page === activePage ? 'outline-item active' : 'outline-item'}
                    onClick={() => {
                      setActivePage(item.page)
                      const nextAnchor = anchors.find((anchor) => anchor.page === item.page)
                      setActiveAnchorId(nextAnchor?.id ?? '')
                    }}
                    style={{ paddingLeft: `${16 + (item.level - 1) * 16}px` }}
                  >
                    <span>{item.title}</span>
                    <strong>P.{item.page}</strong>
                  </button>
                ))}
              </div>
            )}

            {activePanel === 'figures' && (
              <div className="figure-list">
                {figures.map((item) => (
                  <button
                    key={item.id}
                    className="figure-item"
                    onClick={() => {
                      setActivePage(item.page)
                      const nextAnchor = anchors.find((anchor) => anchor.page === item.page)
                      setActiveAnchorId(nextAnchor?.id ?? '')
                    }}
                  >
                    <img src={item.src} alt={item.caption} />
                    <div>
                      <span>P.{item.page}</span>
                      <p>{item.caption}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="reader-panel">
          <div className="reader-toolbar">
            <div>
              <div className="eyebrow">Active Paper</div>
              <h3>{paperTitle}</h3>
            </div>
            <div className="page-switcher">
              <button
                className="ghost-button"
                onClick={() => setActivePage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <span>Page {activePage} / {pages.length || 1}</span>
              <button
                className="ghost-button"
                onClick={() => setActivePage((value) => Math.min(pages.length || 1, value + 1))}
              >
                下一页
              </button>
            </div>
          </div>

          <div className="reader-body">
            <aside className="anchor-panel">
              <div className="eyebrow">Anchors</div>
              <div className="anchor-list">
                {currentAnchors.map((anchor) => (
                  <button
                    key={anchor.id}
                    className={anchor.id === activeAnchorId ? 'anchor-item active' : 'anchor-item'}
                    onClick={() => setActiveAnchorId(anchor.id)}
                  >
                    <span>{anchor.type}</span>
                    <p>{anchor.text}</p>
                  </button>
                ))}
              </div>
            </aside>

            <div className="paper-stage">
              <div
                className="paper-canvas"
                style={{ aspectRatio: `${currentPageMeta.width} / ${currentPageMeta.height}` }}
              >
                {isBootstrapping ? <div className="canvas-placeholder">正在加载解析结果...</div> : null}
                {!isBootstrapping && currentPage.length === 0 ? <div className="canvas-placeholder">当前没有可显示的页面内容。</div> : null}
                {currentPage.map((block, index) => renderBlock(block, index, assetBasePath))}
                <div className="highlight-layer">
                  {currentAnchors.map((anchor) => {
                    const [x1, y1, x2, y2] = anchor.bbox
                    if ([x1, y1, x2, y2].some((value) => typeof value !== 'number')) {
                      return null
                    }

                    return (
                      <button
                        key={anchor.id}
                        className={anchor.id === activeAnchorId ? 'highlight-box active' : 'highlight-box'}
                        style={{
                          left: `${(x1 / Math.max(1, currentPageMeta.width)) * 100}%`,
                          top: `${(y1 / Math.max(1, currentPageMeta.height)) * 100}%`,
                          width: `${((x2 - x1) / Math.max(1, currentPageMeta.width)) * 100}%`,
                          height: `${((y2 - y1) / Math.max(1, currentPageMeta.height)) * 100}%`,
                        }}
                        onClick={() => setActiveAnchorId(anchor.id)}
                        title={anchor.text}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {isSettingsOpen && (
        <div className="settings-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="settings-header">
              <div>
                <div className="eyebrow">Settings</div>
                <h3>解析与模型配置</h3>
              </div>
              <button className="icon-button" onClick={() => setIsSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <div className="settings-body">
              <label>
                模型提供方
                <input
                  value={settings.provider}
                  onChange={(event) => setSettings({ ...settings, provider: event.target.value })}
                />
              </label>
              <label>
                聊天模型
                <input
                  value={settings.model}
                  onChange={(event) => setSettings({ ...settings, model: event.target.value })}
                />
              </label>
              <label>
                API Base URL
                <input
                  value={settings.apiBaseUrl}
                  onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })}
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
                />
              </label>
              <label>
                GitHub 仓库
                <input
                  value={settings.githubRepo}
                  onChange={(event) => setSettings({ ...settings, githubRepo: event.target.value })}
                />
              </label>
              <label>
                GitHub 分支
                <input
                  value={settings.githubBranch}
                  onChange={(event) => setSettings({ ...settings, githubBranch: event.target.value })}
                />
              </label>
              <label>
                Conda 环境
                <div className="inline-select-row">
                  <select
                    value={settings.condaEnv}
                    onChange={(event) => setSettings({ ...settings, condaEnv: event.target.value })}
                  >
                    <option value="">选择 Conda 环境</option>
                    {condaOptions.map((env) => (
                      <option key={env.path} value={env.name}>
                        {env.name}
                      </option>
                    ))}
                  </select>
                  <button className="ghost-button compact-button" onClick={() => void refreshCondaEnvs()} type="button">
                    {isRefreshingCondaEnvs ? '刷新中' : '刷新'}
                  </button>
                </div>
                {condaEnvError ? <p className="chat-status error">{condaEnvError}</p> : null}
                {!condaEnvError && condaOptions.length > 0 ? (
                  <p className="settings-hint">已发现 {condaOptions.length} 个环境，当前将使用 {settings.condaEnv || '默认 Python'}。</p>
                ) : null}
              </label>
              <label>
                Conda 可执行路径
                <input
                  value={settings.condaExePath}
                  onChange={(event) => setSettings({ ...settings, condaExePath: event.target.value })}
                />
              </label>
              <label>
                Python 可执行路径
                <input
                  value={settings.pythonExePath}
                  onChange={(event) => setSettings({ ...settings, pythonExePath: event.target.value })}
                />
              </label>
              <label>
                MinerU 根目录
                <input
                  value={settings.mineruRoot}
                  onChange={(event) => setSettings({ ...settings, mineruRoot: event.target.value })}
                />
              </label>
              <label>
                解析输出目录
                <input
                  value={settings.outputRoot}
                  onChange={(event) => setSettings({ ...settings, outputRoot: event.target.value })}
                />
              </label>
              <label>
                GitHub Token
                <input
                  type="password"
                  value={settings.githubToken}
                  onChange={(event) => setSettings({ ...settings, githubToken: event.target.value })}
                />
              </label>
              <label>
                设备模式
                <input
                  value={settings.deviceMode}
                  onChange={(event) => setSettings({ ...settings, deviceMode: event.target.value })}
                />
              </label>
              <label>
                执行优先级
                <select
                  value={settings.executionMode}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      executionMode: event.target.value as SettingsState['executionMode'],
                    })
                  }
                >
                  <option value="api-first">API first</option>
                  <option value="cli-first">CLI first</option>
                </select>
              </label>
              <label>
                模型来源
                <select
                  value={settings.mineruModelSource}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      mineruModelSource: event.target.value as SettingsState['mineruModelSource'],
                    })
                  }
                >
                  <option value="local">local</option>
                  <option value="modelscope">modelscope</option>
                  <option value="huggingface">huggingface</option>
                </select>
              </label>
              <label>
                MinerU 配置文件路径
                <input
                  value={settings.mineruConfigPath}
                  onChange={(event) => setSettings({ ...settings, mineruConfigPath: event.target.value })}
                />
              </label>
            </div>

            <div className="settings-footer">
              <button className="primary-button wide-button footer-button" onClick={() => void handleSaveSettings()}>
                保存配置
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

export default function AppWithBoundary() {
  return (
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  )
}
