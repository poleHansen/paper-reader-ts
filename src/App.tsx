import { Component, useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  createImportTask,
  createGithubSyncTask,
  askPaperQuestion,
  fetchCondaEnvironments,
  fetchLibraryDocuments,
  fetchPaperDocument,
  fetchTaskFeed,
  fetchSettings,
  retryImportTask,
  saveSettings,
  selectLibraryDocument,
  subscribeTaskFeed,
  uploadAndImportPdf,
} from './lib/api'
import type { Block, CondaEnvironmentItem, FigureItem, LibraryDocument, OutlineItem, Page, PageMeta, ParseTask, SettingsState } from './types'

type MarkdownHeadingEntry = {
  id: string
  level: number
  title: string
  normalizedTitle: string
}

const extractNodeText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => extractNodeText(child)).join(' ')
  }

  if (node && typeof node === 'object' && 'props' in node) {
    return extractNodeText((node as { props?: { children?: React.ReactNode } }).props?.children)
  }

  return ''
}

const normalizeMarkdown = (source: string): string => {
  if (!source) {
    return ''
  }

  return source
    .replace(/\\\[((?:.|\r?\n)*?)\\\]/g, (_, content: string) => `\n$$\n${content.trim()}\n$$\n`)
    .replace(/\\\(((?:.|\r?\n)*?)\\\)/g, (_, content: string) => `$${content.trim()}$`)
}

const normalizeHeadingText = (value: string): string => {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[>*_~#]/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const slugifyHeading = (value: string): string => {
  const normalized = normalizeHeadingText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

  return normalized || 'section'
}

const extractMarkdownHeadings = (source: string): MarkdownHeadingEntry[] => {
  const lines = source.split(/\r?\n/)
  const headings: MarkdownHeadingEntry[] = []
  const slugCounts = new Map<string, number>()
  let insideFence = false

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      insideFence = !insideFence
      continue
    }

    if (insideFence) {
      continue
    }

    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) {
      continue
    }

    const [, marks, rawTitle] = match
    const title = normalizeHeadingText(rawTitle)
    if (!title) {
      continue
    }

    const baseSlug = slugifyHeading(title)
    const seenCount = slugCounts.get(baseSlug) ?? 0
    slugCounts.set(baseSlug, seenCount + 1)

    headings.push({
      id: seenCount === 0 ? baseSlug : `${baseSlug}-${seenCount + 1}`,
      level: marks.length,
      title,
      normalizedTitle: title.toLowerCase(),
    })
  }

  return headings
}

const buildOutlineHeadingMap = (outlineItems: OutlineItem[], headings: MarkdownHeadingEntry[]) => {
  const headingBuckets = new Map<string, MarkdownHeadingEntry[]>()

  headings.forEach((heading) => {
    const bucket = headingBuckets.get(heading.normalizedTitle)
    if (bucket) {
      bucket.push(heading)
      return
    }

    headingBuckets.set(heading.normalizedTitle, [heading])
  })

  const usage = new Map<string, number>()

  return outlineItems.reduce<Record<string, string>>((accumulator, item) => {
    const normalizedTitle = normalizeHeadingText(item.title).toLowerCase()
    if (!normalizedTitle) {
      return accumulator
    }

    const matchingHeadings = headingBuckets.get(normalizedTitle)
    if (!matchingHeadings?.length) {
      return accumulator
    }

    const nextIndex = usage.get(normalizedTitle) ?? 0
    const heading = matchingHeadings[Math.min(nextIndex, matchingHeadings.length - 1)]
    usage.set(normalizedTitle, nextIndex + 1)
    accumulator[item.id] = heading.id
    return accumulator
  }, {})
}

let mermaidInitialized = false

const MermaidBlock = ({ value }: { value: string }) => {
  const [svgMarkup, setSvgMarkup] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    const render = async () => {
      try {
        setErrorMessage('')
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'base',
          })
          mermaidInitialized = true
        }

        const result = await mermaid.render(`mermaid-${Math.random().toString(36).slice(2)}`, value)

        if (!cancelled) {
          const svg = typeof result.svg === 'string' ? result.svg : ''

          if (!svg) {
            setErrorMessage('Mermaid 图表返回为空。')
            setSvgMarkup('')
            return
          }

          setSvgMarkup(svg)
        }
      } catch (error) {
        if (!cancelled) {
          setSvgMarkup('')
          setErrorMessage(error instanceof Error ? error.message : 'Mermaid 图表渲染失败')
        }
      }
    }

    void render()

    return () => {
      cancelled = true
    }
  }, [value])

  if (errorMessage) {
    return (
      <div className="mermaid-fallback">
        <p>{errorMessage}</p>
        <pre><code>{value}</code></pre>
      </div>
    )
  }

  if (!svgMarkup) {
    return <div className="mermaid-loading">正在渲染图表...</div>
  }

  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
}

const MarkdownTable = ({ children }: { children?: React.ReactNode }) => (
  <div className="table-scroll">
    <table>{children}</table>
  </div>
)

const resolveMarkdownAsset = (src: string, assetBasePath: string) => {
  if (!src) {
    return src
  }

  if (/^(https?:)?\/\//i.test(src) || src.startsWith('/')) {
    return src
  }

  return `${assetBasePath}/${src.replace(/^\.\//, '')}`
}

const MarkdownImage = ({
  src = '',
  alt = '',
  assetBasePath,
}: {
  src?: string
  alt?: string
  assetBasePath: string
}) => {
  const normalizedSrc = typeof src === 'string' ? resolveMarkdownAsset(src, assetBasePath) : src

  return (
    <figure className="markdown-image-block">
      <img src={normalizedSrc} alt={alt} loading="lazy" />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  )
}

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
  ragEnabled: true,
  ragAutoBuild: true,
  ragModelName: 'BAAI/bge-m3',
  ragModelPath: '',
  ragTopK: 8,
  ragChunkSize: 1200,
  ragChunkOverlap: 150,
  ragBatchSize: 4,
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
  const pageRefs = useRef<Record<number, HTMLElement | null>>({})
  const readerScrollRef = useRef<HTMLDivElement | null>(null)
  const outlineContainerRef = useRef<HTMLDivElement | null>(null)
  const outlineItemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const headingObserverRef = useRef<IntersectionObserver | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [figures, setFigures] = useState<FigureItem[]>([])
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([])
  const [pageMetas, setPageMetas] = useState<PageMeta[]>([])
  const [markdown, setMarkdown] = useState('')
  const [taskFeed, setTaskFeed] = useState<ParseTask[]>([])
  const [activePanel, setActivePanel] = useState<'assistant' | 'library' | 'outline' | 'figures'>('assistant')
  const [activePage, setActivePage] = useState(1)
  const [activeOutlineId, setActiveOutlineId] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(defaultSettings)
  const [bootstrapError, setBootstrapError] = useState('')
  const [assetBasePath, setAssetBasePath] = useState('/工业缺陷零样本分割2026/auto')
  const [paperTitle, setPaperTitle] = useState('SSVP: Synergistic Semantic-Visual Prompting')
  const [filePath, setFilePath] = useState('D:/code/paper-reader-ts/工业缺陷零样本分割2026/工业缺陷零样本分割2026.pdf')
  const [folderPath, setFolderPath] = useState('/workspace/runs')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pendingAutoOpenTaskId, setPendingAutoOpenTaskId] = useState('')
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

  const applyDocument = (document: {
    pages: Page[]
    outline: OutlineItem[]
    figures: FigureItem[]
    pageMetas: PageMeta[]
    assetBasePath: string
    paperTitle: string
    markdown: string
  }) => {
    setPages(document.pages)
    setOutline(document.outline)
    setFigures(document.figures)
    setPageMetas(document.pageMetas)
    setAssetBasePath(document.assetBasePath)
    setFolderPath(`${document.assetBasePath}/images`)
    setPaperTitle(document.paperTitle)
    setMarkdown(document.markdown)
    setActivePage(1)
  }

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [document, storedSettings, library] = await Promise.all([
          fetchPaperDocument(),
          fetchSettings(),
          fetchLibraryDocuments(),
        ])
        applyDocument(document)
        setSettings(storedSettings)
        setLibraryDocuments(library)
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
      void Promise.all([fetchPaperDocument(), fetchLibraryDocuments()])
        .then(([document, library]) => {
          applyDocument(document)
          setLibraryDocuments(library)
        })
        .catch(() => undefined)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!pendingAutoOpenTaskId) {
      return
    }

    const matchedDocument = libraryDocuments.find(
      (item) => item.taskId === pendingAutoOpenTaskId && item.status === 'ready' && !item.isActive,
    )

    if (!matchedDocument) {
      const pendingTask = taskFeed.find((task) => task.id === pendingAutoOpenTaskId)
      if (pendingTask?.status === 'failed') {
        setPendingAutoOpenTaskId('')
      }
      return
    }

    void handleSelectLibraryDocument(matchedDocument.artifactDir)
    setActivePanel('library')
    setPendingAutoOpenTaskId('')
  }, [libraryDocuments, pendingAutoOpenTaskId, taskFeed])

  const groupedLibraryDocuments = useMemo(
    () => ({
      processing: libraryDocuments.filter((item) => item.status === 'processing'),
      ready: libraryDocuments.filter((item) => item.status === 'ready'),
      failed: libraryDocuments.filter((item) => item.status === 'failed'),
    }),
    [libraryDocuments],
  )
  const renderedMarkdown = useMemo(() => normalizeMarkdown(markdown), [markdown])
  const markdownHeadings = useMemo(() => extractMarkdownHeadings(renderedMarkdown), [renderedMarkdown])
  const outlineHeadingMap = useMemo(
    () => buildOutlineHeadingMap(outline, markdownHeadings),
    [outline, markdownHeadings],
  )
  const headingOutlineMap = useMemo(() => {
    return Object.entries(outlineHeadingMap).reduce<Record<string, string>>((accumulator, [outlineId, headingId]) => {
      accumulator[headingId] = outlineId
      return accumulator
    }, {})
  }, [outlineHeadingMap])
  const markdownHeadingBuckets = useMemo(() => {
    return markdownHeadings.reduce<Record<string, MarkdownHeadingEntry[]>>((accumulator, heading) => {
      const key = `${heading.level}:${heading.normalizedTitle}`
      const bucket = accumulator[key]
      if (bucket) {
        bucket.push(heading)
      } else {
        accumulator[key] = [heading]
      }
      return accumulator
    }, {})
  }, [markdownHeadings])

  const scrollToHeading = (headingId: string, page?: number) => {
    const headingElement = document.getElementById(headingId)
    if (!headingElement) {
      if (typeof page === 'number') {
        scrollToPage(page)
      }
      return
    }

    if (typeof page === 'number') {
      setActivePage(page)
    }

    const outlineId = headingOutlineMap[headingId]
    if (outlineId) {
      setActiveOutlineId(outlineId)
    }

    const reader = readerScrollRef.current
    if (!reader) {
      headingElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const readerRect = reader.getBoundingClientRect()
    const headingRect = headingElement.getBoundingClientRect()
    const offsetTop = headingRect.top - readerRect.top + reader.scrollTop - 12

    reader.scrollTo({
      top: Math.max(0, offsetTop),
      behavior: 'smooth',
    })
  }

  const scrollToPage = (page: number) => {
    setActivePage(page)
    const pageElement = pageRefs.current[page]
    const reader = readerScrollRef.current

    if (!pageElement) {
      return
    }

    if (!reader) {
      pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    const readerRect = reader.getBoundingClientRect()
    const pageRect = pageElement.getBoundingClientRect()
    const offsetTop = pageRect.top - readerRect.top + reader.scrollTop - 12

    reader.scrollTo({
      top: Math.max(0, offsetTop),
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    const outlineEntries = Object.entries(outlineHeadingMap)
    if (!outlineEntries.length) {
      setActiveOutlineId('')
      return
    }

    headingObserverRef.current?.disconnect()

    const visibleHeadings = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const headingId = entry.target.id
          if (!headingId) {
            return
          }

          if (entry.isIntersecting) {
            visibleHeadings.set(headingId, entry.boundingClientRect.top)
          } else {
            visibleHeadings.delete(headingId)
          }
        })

        let nextHeadingId = ''

        if (visibleHeadings.size > 0) {
          nextHeadingId = [...visibleHeadings.entries()]
            .sort((left, right) => Math.abs(left[1]) - Math.abs(right[1]))[0]?.[0] ?? ''
        } else {
          const candidates = outlineEntries
            .map(([, headingId]) => document.getElementById(headingId))
            .filter((element): element is HTMLElement => Boolean(element))
            .filter((element) => element.getBoundingClientRect().top <= 140)
            .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)

          nextHeadingId = candidates[0]?.id ?? outlineEntries[0]?.[1] ?? ''
        }

        const outlineId = headingOutlineMap[nextHeadingId]
        if (outlineId) {
          setActiveOutlineId(outlineId)
        }
      },
      {
        root: null,
        rootMargin: '-72px 0px -55% 0px',
        threshold: [0, 0.2, 0.4, 1],
      },
    )

    headingObserverRef.current = observer

    outlineEntries.forEach(([, headingId]) => {
      const element = document.getElementById(headingId)
      if (element) {
        observer.observe(element)
      }
    })

    const initialOutlineId = headingOutlineMap[outlineEntries[0][1]]
    if (initialOutlineId) {
      setActiveOutlineId(initialOutlineId)
    }

    return () => {
      observer.disconnect()
      headingObserverRef.current = null
    }
  }, [headingOutlineMap, outlineHeadingMap])

  useEffect(() => {
    if (!activeOutlineId) {
      return
    }

    const container = outlineContainerRef.current
    const activeItem = outlineItemRefs.current[activeOutlineId]
    if (!container || !activeItem) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const isAbove = itemRect.top < containerRect.top + 12
    const isBelow = itemRect.bottom > containerRect.bottom - 12

    if (isAbove || isBelow) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeOutlineId])

  const handleImport = async () => {
    if (selectedFile) {
      const response = await uploadAndImportPdf(selectedFile)
      setFilePath(response.filePath)
      setTaskFeed((current) => [response.task, ...current])
      setPendingAutoOpenTaskId(response.task.id)
      setActivePanel('library')
      return
    }

    if (!filePath) {
      return
    }

    const task = await createImportTask(filePath)
    setTaskFeed((current) => [task, ...current])
    setPendingAutoOpenTaskId(task.id)
    setActivePanel('library')
  }

  const handleSelectLibraryDocument = async (artifactDir: string) => {
    const response = await selectLibraryDocument(artifactDir)
    applyDocument(response.document)
    setLibraryDocuments(response.library)
    setPendingAutoOpenTaskId('')
  }

  const handleRetryLibraryDocument = async (filePathToRetry: string) => {
    const response = await retryImportTask(filePathToRetry)
    setTaskFeed((current) => [response.task, ...current])
    setPendingAutoOpenTaskId(response.task.id)
    setActivePanel('library')
  }

  const renderLibraryGroup = (
    title: string,
    items: LibraryDocument[],
    emptyText: string,
  ) => (
    <section className="library-group">
      <div className="library-group-header">
        <strong>{title}</strong>
        <span>{items.length}</span>
      </div>
      {items.length ? items.map((item) => (
        <article key={item.id} className={item.isActive ? 'library-card active' : 'library-card'}>
          <div className="library-card-header">
            <div>
              <strong>{item.paperTitle}</strong>
              <span>{item.source === 'bundled' ? '内置文档' : '上传结果'}</span>
            </div>
            <time>{new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}</time>
          </div>
          <p>{item.detail || item.inputPath || item.artifactDir}</p>
          {item.status === 'ready' ? (
            <button
              className={item.isActive ? 'ghost-button' : 'primary-button'}
              onClick={() => void handleSelectLibraryDocument(item.artifactDir)}
            >
              {item.isActive ? '当前打开' : '打开查看'}
            </button>
          ) : item.status === 'failed' && item.inputPath ? (
            <button
              className="primary-button"
              onClick={() => void handleRetryLibraryDocument(item.inputPath!)}
            >
              重试导入
            </button>
          ) : (
            <div className={item.status === 'failed' ? 'library-status failed' : 'library-status'}>
              {item.status === 'failed' ? '解析失败' : '解析中'}
            </div>
          )}
        </article>
      )) : <div className="empty-state">{emptyText}</div>}
    </section>
  )

  const handleGithubSync = async () => {
    const trimmedFolderPath = folderPath.trim()
    const artifactDir = assetBasePath.trim()

    if (!trimmedFolderPath && !artifactDir) {
      return
    }

    const task = await createGithubSyncTask({
      imageDir: trimmedFolderPath || undefined,
      artifactDir: artifactDir || undefined,
    })
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
        logs: ['正在整理当前页上下文。'],
        citations: [`P.${activePage}`],
      },
      ...current,
    ])

    try {
      const response = await askPaperQuestion({
        question: queuedQuestion,
        page: activePage,
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

  const isBootstrapping = !markdown && pages.length === 0 && !bootstrapError
  const summaryCards = [
    {
      label: 'Sections',
      value: String(outline.length).padStart(2, '0'),
    },
    {
      label: 'Figures',
      value: String(figures.length).padStart(2, '0'),
    },
    {
      label: 'Pages',
      value: String(pages.length).padStart(2, '0'),
    },
  ]
  const renderedHeadingUsage = new Map<string, number>()
  const renderMarkdownHeading = (
    level: number,
    children: React.ReactNode,
    props: React.HTMLAttributes<HTMLHeadingElement>,
  ) => {
    const normalizedTitle = normalizeHeadingText(extractNodeText(children)).toLowerCase()
    const key = `${level}:${normalizedTitle}`
    const index = renderedHeadingUsage.get(key) ?? 0
    renderedHeadingUsage.set(key, index + 1)
    const heading = markdownHeadingBuckets[key]?.[index]

    switch (level) {
      case 1:
        return <h1 id={heading?.id} {...props}>{children}</h1>
      case 2:
        return <h2 id={heading?.id} {...props}>{children}</h2>
      case 3:
        return <h3 id={heading?.id} {...props}>{children}</h3>
      case 4:
        return <h4 id={heading?.id} {...props}>{children}</h4>
      case 5:
        return <h5 id={heading?.id} {...props}>{children}</h5>
      default:
        return <h6 id={heading?.id} {...props}>{children}</h6>
    }
  }

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
                同步目录
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
              className={activePanel === 'library' ? 'tab active' : 'tab'}
              onClick={() => setActivePanel('library')}
            >
              知识库
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

            {activePanel === 'library' && (
              <div className="library-list">
                {renderLibraryGroup('处理中', groupedLibraryDocuments.processing, '当前没有正在处理的文档。')}
                {renderLibraryGroup('已完成', groupedLibraryDocuments.ready, '当前还没有可打开的知识库文档。')}
                {renderLibraryGroup('失败', groupedLibraryDocuments.failed, '当前没有失败任务。')}
              </div>
            )}

            {activePanel === 'outline' && (
              <div className="outline-list" ref={outlineContainerRef}>
                {outline.map((item) => (
                  <button
                    key={item.id}
                    ref={(element) => {
                      outlineItemRefs.current[item.id] = element
                    }}
                    className={item.id === activeOutlineId ? 'outline-item active' : 'outline-item'}
                    onClick={() => {
                      const headingId = outlineHeadingMap[item.id]
                      if (headingId) {
                        scrollToHeading(headingId, item.page)
                      } else {
                        scrollToPage(item.page)
                      }
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
                      scrollToPage(item.page)
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
            <div className="page-switcher continuous-mode-indicator">
              <span>连续阅读模式</span>
              <strong>Page {activePage} / {pages.length || 1}</strong>
            </div>
          </div>

          <div className="reader-body">
            <div className="paper-stage markdown-reader" ref={readerScrollRef}>
              {isBootstrapping ? <div className="canvas-placeholder">正在加载解析结果...</div> : null}
              {!isBootstrapping && !markdown ? <div className="canvas-placeholder">当前没有可显示的文档内容。</div> : null}
              {markdown ? (
                <article className="paper-canvas markdown-canvas">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                    components={{
                      table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
                      img: ({ src = '', alt = '' }) => {
                        return <MarkdownImage src={src} alt={alt} assetBasePath={assetBasePath} />
                      },
                      h1: ({ children, ...props }) => renderMarkdownHeading(1, children, props),
                      h2: ({ children, ...props }) => renderMarkdownHeading(2, children, props),
                      h3: ({ children, ...props }) => renderMarkdownHeading(3, children, props),
                      h4: ({ children, ...props }) => renderMarkdownHeading(4, children, props),
                      h5: ({ children, ...props }) => renderMarkdownHeading(5, children, props),
                      h6: ({ children, ...props }) => renderMarkdownHeading(6, children, props),
                      code: ({ className, children, ...props }) => {
                        const language = className?.replace(/^language-/, '') ?? ''
                        const codeText = String(children).replace(/\n$/, '')

                        if (language === 'mermaid') {
                          return <MermaidBlock value={codeText} />
                        }

                        return <code className={className} {...props}>{children}</code>
                      },
                    }}
                  >
                    {renderedMarkdown}
                  </ReactMarkdown>
                </article>
              ) : null}
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
                    {condaOptions.map((env: CondaEnvironmentItem) => (
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
              <label>
                RAG Embedding 模型名
                <input
                  value={settings.ragModelName}
                  onChange={(event) => setSettings({ ...settings, ragModelName: event.target.value })}
                  placeholder="BAAI/bge-m3"
                />
              </label>
              <label>
                RAG Embedding 模型路径
                <input
                  value={settings.ragModelPath}
                  onChange={(event) => setSettings({ ...settings, ragModelPath: event.target.value })}
                  placeholder="留空则使用模型名或默认下载路径"
                />
                <p className="settings-hint">可填写本地 Hugging Face 缓存目录或实际 snapshot 目录；留空时走默认模型名。</p>
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
