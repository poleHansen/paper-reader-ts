import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import mime from 'mime-types'
import multer from 'multer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, '工业缺陷零样本分割2026', 'auto')
const settingsPath = path.join(rootDir, 'server', 'settings.json')
const uploadsDir = path.join(rootDir, 'workspace', 'imports')
const runsDir = path.join(rootDir, 'workspace', 'runs')
const workerPath = path.join(rootDir, 'server', 'mineru_worker.py')
const githubSyncPath = path.join(rootDir, 'server', 'github_sync.py')
const ragBuilderPath = path.join(rootDir, 'server', 'rag_builder.py')
const ragQueryPath = path.join(rootDir, 'server', 'rag_query.py')

const app = express()
const upload = multer({ dest: uploadsDir })
app.use(cors())
app.use(express.json())

const defaultSettings = {
  provider: 'OpenAI Compatible',
  model: 'gpt-4.1-mini',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  githubRepo: 'honor/paper-reader-assets',
  githubBranch: 'main',
  condaEnv: 'daling-test',
  condaExePath: 'D:/Anaconda/Scripts/conda.exe',
  pythonExePath: '',
  mineruRoot: path.join(rootDir, 'pdf_cut', 'MinerU'),
  outputRoot: runsDir,
  githubToken: '',
  deviceMode: 'cuda',
  executionMode: 'api-first',
  mineruModelSource: 'local',
  mineruConfigPath: path.join(rootDir, 'pdf_cut', 'MinerU', 'mineru.json'),
  ragEnabled: true,
  ragAutoBuild: true,
  ragModelName: 'BAAI/bge-m3',
  ragModelPath: '',
  ragTopK: 8,
  ragChunkSize: 1200,
  ragChunkOverlap: 150,
  ragBatchSize: 4,
}

const defaultTasks = [
  {
    id: 'task-2',
    title: '解析完成',
    detail: '已生成 markdown、content_list_v2、middle.json、model.json 和图片目录。',
    status: 'ready',
    timestamp: '10:16',
    logs: ['当前阅读器仍加载示例论文产物。'],
  },
  {
    id: 'task-3',
    title: 'GitHub 同步待接入',
    detail: '当前服务已准备好 settings 和 import API，并开始接入 Conda + MinerU 执行器。',
    status: 'queued',
    timestamp: '10:17',
    logs: ['支持真实导入后会自动切换到新产物。'],
  },
]

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'))

const ensureSettings = () => {
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf-8')
  }
}

const ensureDirectories = () => {
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.mkdirSync(runsDir, { recursive: true })
}

const readSettings = () => ({ ...defaultSettings, ...readJson(settingsPath) })

const listCondaEnvironments = async () => {
  const settings = readSettings()
  const condaCommand = settings.condaExePath || 'conda'

  return new Promise((resolve) => {
    const child = spawn(condaCommand, ['env', 'list', '--json'], {
      cwd: rootDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (error) => {
      resolve({
        condaExePath: condaCommand,
        activeEnv: settings.condaEnv || '',
        envs: [],
        error: error.message,
      })
    })

    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout || '{}')
        const envPaths = Array.isArray(parsed.envs) ? parsed.envs : []
        const envs = envPaths.map((envPath) => ({
          name: path.basename(envPath),
          path: envPath,
        }))

        resolve({
          condaExePath: condaCommand,
          activeEnv: settings.condaEnv || '',
          envs,
          error: '',
        })
      } catch {
        resolve({
          condaExePath: condaCommand,
          activeEnv: settings.condaEnv || '',
          envs: [],
          error: stderr.trim() || 'Failed to parse conda env list',
        })
      }
    })
  })
}

const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

const buildEnvironmentTask = (settings) => ({
  id: 'task-env',
  title: 'Conda 环境就绪',
  detail: `已连接 ${settings.condaEnv || '默认 Python'}，准备复用本地 GPU 与 MinerU pipeline。`,
  status: 'starting-env',
  timestamp: nowTime(),
  logs: [
    `Conda 环境: ${settings.condaEnv || '未指定'}`,
    `Conda 路径: ${settings.condaExePath || '未指定'}`,
    '等待新的论文导入任务。',
  ],
})

let tasks = [buildEnvironmentTask(readSettings()), ...defaultTasks]
let activeDocumentDir = dataDir
const taskClients = new Set()

const getDocumentBaseName = (artifactDir) => {
  const contentListPath = getDocumentContentListPath(artifactDir)
  if (contentListPath) {
    return path.basename(contentListPath).replace(/_(content_list_v2|content_list)\.json$/i, '')
  }

  return path.basename(artifactDir).replace(/_(content_list_v2|content_list)$/i, '')
}

const getDocumentContentListPath = (artifactDir) => {
  if (!artifactDir || !fs.existsSync(artifactDir)) {
    return ''
  }

  const files = fs.readdirSync(artifactDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)

  const preferredName = files.find((name) => /_content_list_v2\.json$/i.test(name))
  if (preferredName) {
    return path.join(artifactDir, preferredName)
  }

  const fallbackName = files.find((name) => /_content_list\.json$/i.test(name))
  if (fallbackName) {
    return path.join(artifactDir, fallbackName)
  }

  return ''
}

const getDocumentMarkdownPath = (artifactDir) => {
  if (!artifactDir || !fs.existsSync(artifactDir)) {
    return ''
  }

  const files = fs.readdirSync(artifactDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)

  const markdownName = files.find((name) => /\.md$/i.test(name))
  return markdownName ? path.join(artifactDir, markdownName) : ''
}

const getRagDir = (artifactDir) => path.join(artifactDir, 'rag')

const getRagFiles = (artifactDir) => ({
  ragDir: getRagDir(artifactDir),
  chunksPath: path.join(getRagDir(artifactDir), 'chunks.jsonl'),
  metadataPath: path.join(getRagDir(artifactDir), 'metadata.json'),
  buildInfoPath: path.join(getRagDir(artifactDir), 'build_info.json'),
  indexPath: path.join(getRagDir(artifactDir), 'index.faiss'),
})

const getRagStatus = (artifactDir) => {
  const ragFiles = getRagFiles(artifactDir)
  const missingFiles = Object.entries(ragFiles)
    .filter(([key, filePath]) => key !== 'ragDir' && !fs.existsSync(filePath))
    .map(([key]) => key)

  const buildInfo = fs.existsSync(ragFiles.buildInfoPath) ? readJson(ragFiles.buildInfoPath) : {}
  const metadata = fs.existsSync(ragFiles.metadataPath) ? readJson(ragFiles.metadataPath) : {}

  return {
    artifactDir,
    ragDir: ragFiles.ragDir,
    indexed: missingFiles.length === 0,
    chunkCount: Number(metadata.chunkCount || buildInfo.chunkCount) || 0,
    builtAt: buildInfo.builtAt || (fs.existsSync(ragFiles.buildInfoPath) ? fs.statSync(ragFiles.buildInfoPath).mtime.toISOString() : ''),
    model: buildInfo.modelName || '',
    missingFiles,
  }
}

const runPythonTask = ({ settings, scriptPath, scriptArgs, onStdout, onStderr }) => {
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
  }

  if (settings.pythonExePath) {
    return spawn(settings.pythonExePath, [scriptPath, ...scriptArgs], { cwd: rootDir, env })
  }

  if (settings.condaExePath && settings.condaEnv) {
    return spawn(settings.condaExePath, ['run', '-n', settings.condaEnv, 'python', scriptPath, ...scriptArgs], {
      cwd: rootDir,
      env,
    })
  }

  return spawn('python', [scriptPath, ...scriptArgs], { cwd: rootDir, env })
}

const buildRagIndex = (artifactDir, { taskId, settings }) => new Promise((resolve, reject) => {
  const scriptArgs = [
    '--artifact-dir',
    artifactDir,
    '--model-name',
    settings.ragModelName,
    '--model-path',
    settings.ragModelPath || '',
    '--device',
    settings.deviceMode || 'cuda',
    '--chunk-size',
    String(settings.ragChunkSize || 1200),
    '--chunk-overlap',
    String(settings.ragChunkOverlap || 150),
    '--batch-size',
    String(settings.ragBatchSize || 4),
  ]

  const child = runPythonTask({ settings, scriptPath: ragBuilderPath, scriptArgs })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    stdout += text
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue
      }
      if (line.startsWith('TASK_STATUS|')) {
        const [, status, detail] = line.split('|')
        if (taskId) {
          appendTaskLog(taskId, detail || line, { status: status || 'parsing' })
        }
        continue
      }
      if (taskId) {
        appendTaskLog(taskId, line, { status: 'parsing' })
      }
    }
  })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    stderr += text
    if (taskId) {
      for (const line of text.split(/\r?\n/)) {
        appendTaskLog(taskId, line, { status: 'parsing' })
      }
    }
  })

  child.on('error', (error) => reject(error))
  child.on('close', (code) => {
    if (code !== 0) {
      reject(new Error(stderr.trim() || `rag builder failed with exit code ${code ?? 'unknown'}`))
      return
    }

    const lastJsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .at(-1)

    if (!lastJsonLine) {
      resolve({ ok: true, ...getRagStatus(artifactDir) })
      return
    }

    resolve(JSON.parse(lastJsonLine))
  })
})

const retrieveRagChunks = (artifactDir, { question, topK, settings }) => new Promise((resolve, reject) => {
  const scriptArgs = [
    '--artifact-dir',
    artifactDir,
    '--question',
    question,
    '--top-k',
    String(topK || settings.ragTopK || 8),
    '--model-name',
    settings.ragModelName,
    '--model-path',
    settings.ragModelPath || '',
    '--device',
    settings.deviceMode || 'cuda',
  ]

  const child = runPythonTask({ settings, scriptPath: ragQueryPath, scriptArgs })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf-8')
  })

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf-8')
  })

  child.on('error', (error) => reject(error))
  child.on('close', (code) => {
    if (code !== 0) {
      reject(new Error(stderr.trim() || `rag query failed with exit code ${code ?? 'unknown'}`))
      return
    }

    const lastJsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .at(-1)

    if (!lastJsonLine) {
      reject(new Error('rag query did not return JSON payload'))
      return
    }

    resolve(JSON.parse(lastJsonLine))
  })
})

const listAvailableArtifactDirs = () => {
  const settings = readSettings()
  const artifactDirs = []

  if (getDocumentContentListPath(dataDir)) {
    artifactDirs.push({ artifactDir: dataDir, source: 'bundled' })
  }

  if (settings.outputRoot && fs.existsSync(settings.outputRoot)) {
    const runDirs = fs.readdirSync(settings.outputRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(settings.outputRoot, entry.name))

    for (const runDir of runDirs) {
      let nestedDirs = []
      try {
        nestedDirs = fs.readdirSync(runDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(runDir, entry.name, 'auto'))
          .filter((artifactDir) => fs.existsSync(artifactDir) && getDocumentContentListPath(artifactDir))
      } catch {
        nestedDirs = []
      }

      for (const artifactDir of nestedDirs) {
        artifactDirs.push({ artifactDir, source: 'workspace-run' })
      }
    }
  }

  return artifactDirs
}

const resolveActiveDocumentDir = () => {
  if (getDocumentContentListPath(activeDocumentDir)) {
    return activeDocumentDir
  }

  const available = listAvailableArtifactDirs()
    .map(({ artifactDir, source }) => {
      const contentListPath = getDocumentContentListPath(artifactDir)
      const stats = fs.statSync(contentListPath)
      return { artifactDir, source, updatedAt: stats.mtime.getTime() }
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)

  const fallback = available[0]?.artifactDir || dataDir
  activeDocumentDir = fallback
  return activeDocumentDir
}

const listKnowledgeDocuments = () => {
  const directories = new Map()

  for (const item of listAvailableArtifactDirs()) {
    directories.set(item.artifactDir, item)
  }

  const readyDocuments = [...directories.values()]
    .map(({ artifactDir, source }) => {
      const contentListPath = getDocumentContentListPath(artifactDir)
      const stats = fs.statSync(contentListPath)
      return {
        id: path.relative(rootDir, artifactDir).split(path.sep).join('/'),
        paperTitle: getDocumentBaseName(artifactDir),
        artifactDir,
        assetBasePath: `/${path.relative(rootDir, artifactDir).split(path.sep).join('/')}`,
        updatedAt: stats.mtime.toISOString(),
        source,
        isActive: path.resolve(artifactDir) === path.resolve(activeDocumentDir),
        status: 'ready',
      }
    })

  const readyByOutputDir = new Map(
    readyDocuments
      .filter((item) => item.source === 'workspace-run')
      .map((item) => [path.resolve(path.dirname(path.dirname(item.artifactDir))), item]),
  )

  const taskDocuments = tasks
    .filter((task) => task.kind !== 'chat' && task.outputDir)
    .map((task) => {
      const resolvedOutputDir = path.resolve(task.outputDir)
      const readyMatch = readyByOutputDir.get(resolvedOutputDir)
      if (readyMatch) {
        return {
          ...readyMatch,
          taskId: task.id,
          detail: task.detail,
          inputPath: task.inputPath,
          updatedAt: new Date().toISOString(),
        }
      }

      const paperTitle = task.paperId
        ? task.paperId.replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim() || task.paperId
        : path.parse(task.inputPath || task.title).name || task.title

      const status = task.status === 'failed' ? 'failed' : 'processing'

      return {
        id: task.id,
        paperTitle,
        artifactDir: task.outputDir,
        assetBasePath: '',
        updatedAt: new Date().toISOString(),
        source: 'workspace-run',
        isActive: false,
        status,
        taskId: task.id,
        detail: task.detail,
        inputPath: task.inputPath,
      }
    })

  const merged = new Map()

  for (const item of readyDocuments) {
    merged.set(item.id, item)
  }

  for (const item of taskDocuments) {
    merged.set(item.id, item)
  }

  return [...merged.values()]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

const slugifyPaperId = (value) =>
  value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || `paper-${Date.now()}`

const broadcastTasks = () => {
  const payload = `data: ${JSON.stringify(tasks)}\n\n`
  for (const client of taskClients) {
    client.write(payload)
  }
}

const updateTask = (taskId, updater) => {
  tasks = tasks.map((task) => (task.id === taskId ? updater(task) : task))
  broadcastTasks()
}

const prependTask = (task) => {
  tasks = [task, ...tasks]
  broadcastTasks()
}

const syncEnvironmentTask = (settings) => {
  const environmentTask = buildEnvironmentTask(settings)
  const remainingTasks = tasks.filter((task) => task.id !== environmentTask.id)
  tasks = [environmentTask, ...remainingTasks]
  broadcastTasks()
}

const getLatestTask = (taskId) => tasks.find((task) => task.id === taskId)

const startImportTask = (filePath, res) => {
  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: `File not found: ${filePath}` })
    return
  }

  const settings = readSettings()
  const sourceName = path.basename(filePath)
  const paperStem = path.parse(sourceName).name
  const paperId = `${slugifyPaperId(paperStem)}-${Date.now()}`
  const outputDir = path.join(settings.outputRoot, paperId)
  const task = {
    id: `task-${Date.now()}`,
    title: `正在解析 ${sourceName}`,
    detail: `已接收 ${sourceName}，准备启动 ${settings.executionMode} 解析。`,
    status: 'queued',
    timestamp: nowTime(),
    logs: [`输入文件: ${filePath}`],
    paperId,
    inputPath: filePath,
    outputDir,
  }

  prependTask(task)

  const env = {
    ...process.env,
    MINERU_DEVICE_MODE: settings.deviceMode || process.env.MINERU_DEVICE_MODE || 'cuda',
    MINERU_MODEL_SOURCE: settings.mineruModelSource || process.env.MINERU_MODEL_SOURCE || 'local',
    MINERU_TOOLS_CONFIG_JSON: settings.mineruConfigPath || process.env.MINERU_TOOLS_CONFIG_JSON || '',
    PYTHONIOENCODING: 'utf-8',
  }

  const workerArgs = [
    workerPath,
    '--file',
    filePath,
    '--output-dir',
    outputDir,
    '--method',
    settings.executionMode,
    '--mineru-root',
    settings.mineruRoot,
  ]

  const runWorker = () => {
    if (settings.pythonExePath) {
      return spawn(settings.pythonExePath, workerArgs, { cwd: rootDir, env })
    }

    if (settings.condaExePath && settings.condaEnv) {
      return spawn(settings.condaExePath, ['run', '-n', settings.condaEnv, 'python', ...workerArgs], {
        cwd: rootDir,
        env,
      })
    }

    return spawn('python', workerArgs, { cwd: rootDir, env })
  }

  let worker
  try {
    worker = runWorker()
  } catch (error) {
    updateTask(task.id, (current) => ({
      ...current,
      status: 'failed',
      detail: `启动解析失败: ${error.message}`,
      error: String(error.message),
      timestamp: nowTime(),
      logs: [...(current.logs ?? []), `启动解析失败: ${error.message}`],
    }))
    res.status(500).json(task)
    return
  }

  updateTask(task.id, (current) => ({
    ...current,
    status: 'starting-env',
    detail: `正在启动 ${settings.condaEnv || '默认 Python'} 环境。`,
    timestamp: nowTime(),
  }))

  worker.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('TASK_STATUS|')) {
        const [, status, detail] = line.split('|')
        updateTask(task.id, (current) => ({
          ...current,
          status,
          detail: detail || current.detail,
          timestamp: nowTime(),
        }))
        continue
      }

      if (line.startsWith('TASK_OUTPUT|')) {
        const [, artifactDir] = line.split('|')
        if (artifactDir && fs.existsSync(artifactDir)) {
          activeDocumentDir = artifactDir
          appendTaskLog(task.id, `阅读器已切换到 ${artifactDir}`)
        }
        continue
      }

      appendTaskLog(task.id, line)
    }
  })

  worker.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    for (const line of text.split(/\r?\n/)) {
      appendTaskLog(task.id, line, { status: 'parsing' })
    }
  })

  worker.on('close', (code) => {
    if (code === 0) {
      const currentTask = getLatestTask(task.id)
      const artifactDir = currentTask?.outputDir ? path.join(currentTask.outputDir, paperStem, 'auto') : ''

      updateTask(task.id, (current) => ({
        ...current,
        status: 'ready',
        detail: settings.ragEnabled && settings.ragAutoBuild && artifactDir ? '解析完成，正在构建 RAG 索引。' : '解析完成，已加载最新产物。',
        timestamp: nowTime(),
        logs: [...(current.logs ?? []), '解析进程结束，状态码 0。'],
      }))

      const finalizeAfterRag = () => {
        const imageDir = currentTask?.outputDir ? path.join(currentTask.outputDir, paperStem, 'auto', 'images') : ''
        if (imageDir && fs.existsSync(imageDir)) {
          syncImagesToGithub(task.id, imageDir, settings)
        }
      }

      if (settings.ragEnabled && settings.ragAutoBuild && artifactDir && fs.existsSync(artifactDir)) {
        buildRagIndex(artifactDir, { taskId: task.id, settings })
          .then((result) => {
            updateTask(task.id, (current) => ({
              ...current,
              status: 'ready',
              detail: `解析完成，RAG 索引已生成，共 ${result.chunkCount || getRagStatus(artifactDir).chunkCount} 个片段。`,
              timestamp: nowTime(),
              logs: [...(current.logs ?? []), `RAG 索引构建完成: ${getRagDir(artifactDir)}`],
            }))
            finalizeAfterRag()
          })
          .catch((error) => {
            updateTask(task.id, (current) => ({
              ...current,
              status: 'failed',
              detail: `解析完成，但 RAG 索引构建失败: ${error.message}`,
              timestamp: nowTime(),
              error: `rag-build:${error.message}`,
              logs: [...(current.logs ?? []), `RAG 索引构建失败: ${error.message}`],
            }))
          })
        return
      }

      finalizeAfterRag()
      return
    }

    updateTask(task.id, (current) => ({
      ...current,
      status: 'failed',
      detail: `解析失败，退出码 ${code ?? 'unknown'}`,
      timestamp: nowTime(),
      error: `exit-code:${code ?? 'unknown'}`,
      logs: [...(current.logs ?? []), `解析进程退出，状态码 ${code ?? 'unknown'}。`],
    }))
  })

  res.json(task)
}

const appendTaskLog = (taskId, line, patch = {}) => {
  const message = String(line || '').trim()
  if (!message) {
    return
  }

  updateTask(taskId, (task) => ({
    ...task,
    ...patch,
    logs: [...(task.logs ?? []), message].slice(-120),
    detail: patch.detail ?? message,
    timestamp: nowTime(),
  }))
}

const textFromItems = (items) => {
  if (!Array.isArray(items)) {
    return ''
  }

  return items
    .map((item) => (item && typeof item.content === 'string' ? item.content : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const textFromLines = (lines) => {
  if (!Array.isArray(lines)) {
    return ''
  }

  return lines
    .flatMap((line) => Array.isArray(line.spans) ? line.spans : [])
    .map((span) => (typeof span?.content === 'string' ? span.content : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const readPageMetas = (documentDir, baseName) => {
  const modelJsonPath = path.join(documentDir, `${baseName}_model.json`)
  if (!fs.existsSync(modelJsonPath)) {
    return []
  }

  const modelJson = readJson(modelJsonPath)
  if (!Array.isArray(modelJson)) {
    return []
  }

  return modelJson.map((page, pageIndex) => ({
    page: pageIndex + 1,
    width: Number(page?.page_info?.width) || 1700,
    height: Number(page?.page_info?.height) || 2200,
  }))
}

const buildDocument = (artifactDir) => {
  const resolvedDocumentDir = artifactDir && fs.existsSync(artifactDir)
    ? artifactDir
    : resolveActiveDocumentDir()
  const baseName = getDocumentBaseName(resolvedDocumentDir)
  const contentListPath = getDocumentContentListPath(resolvedDocumentDir)
  const markdownPath = getDocumentMarkdownPath(resolvedDocumentDir)
  const middleJsonPath = path.join(resolvedDocumentDir, `${baseName}_middle.json`)
  const pages = readJson(contentListPath)
  const pageMetas = readPageMetas(resolvedDocumentDir, baseName)
  const assetBasePath = `/${path.relative(rootDir, resolvedDocumentDir).split(path.sep).join('/')}`
  const middleJson = fs.existsSync(middleJsonPath) ? readJson(middleJsonPath) : { pdf_info: [] }
  const markdown = markdownPath && fs.existsSync(markdownPath)
    ? fs.readFileSync(markdownPath, 'utf-8')
    : ''

  const outline = pages.flatMap((page, pageIndex) =>
    page
      .filter((block) => block.type === 'title')
      .map((block, index) => ({
        id: `outline-${pageIndex}-${index}`,
        level: block.content?.level ?? 1,
        title: textFromItems(block.content?.title_content),
        page: pageIndex + 1,
      })),
  )

  const figures = pages.flatMap((page, pageIndex) =>
    page
      .filter((block) => block.type === 'image')
      .map((block, index) => ({
        id: `figure-${pageIndex}-${index}`,
        page: pageIndex + 1,
        src: `${assetBasePath}/${block.content?.image_source?.path ?? ''}`,
        caption: textFromItems(block.content?.image_caption),
      })),
  )

  const anchors = (middleJson.pdf_info ?? []).flatMap((page, pageIndex) =>
    (page.preproc_blocks ?? [])
      .filter((block) => ['title', 'text', 'abstract'].includes(block.type))
      .map((block, blockIndex) => ({
        id: `anchor-${pageIndex}-${blockIndex}`,
        page: pageIndex + 1,
        text: textFromLines(block.lines),
        bbox: Array.isArray(block.bbox) ? block.bbox : [],
        type: block.type,
      }))
      .filter((anchor) => anchor.text),
  )

  return { pages, outline, figures, anchors, pageMetas, assetBasePath, paperTitle: baseName, markdown }
}

const buildChatContext = ({ question, page, anchorId, artifactDir }) => {
  const document = buildDocument(artifactDir)
  const pageBlocks = document.pages[page - 1] ?? []
  const pageText = pageBlocks
    .map((block) => {
      if (block.type === 'title') {
        return textFromItems(block.content?.title_content)
      }

      if (block.type === 'paragraph') {
        return textFromItems(block.content?.paragraph_content)
      }

      if (block.type === 'image') {
        return `Figure: ${textFromItems(block.content?.image_caption)}`
      }

      return ''
    })
    .filter(Boolean)
    .join('\n\n')

  const selectedAnchor = document.anchors.find((anchor) => anchor.id === anchorId)
  const citations = [`P.${page}`]
  if (selectedAnchor) {
    citations.push(`${selectedAnchor.type}: ${selectedAnchor.text.slice(0, 72)}`)
  }
  const pageAnchors = document.anchors
    .filter((anchor) => anchor.page === page)
    .slice(0, 6)
    .map((anchor) => `- [${anchor.type}] ${anchor.text}`)
    .join('\n')

  return {
    paperTitle: document.paperTitle,
    citations,
    prompt: [
      `论文标题: ${document.paperTitle}`,
      `当前页: ${page}`,
      selectedAnchor ? `当前选中锚点: ${selectedAnchor.text}` : '当前选中锚点: 无',
      pageAnchors ? `当前页锚点:\n${pageAnchors}` : '当前页锚点: 无',
      pageText ? `当前页正文:\n${pageText}` : '当前页正文: 无',
      `用户问题: ${question}`,
    ].join('\n\n'),
  }
}

const buildRagPrompt = ({ paperTitle, question, chunks }) => {
  const citations = chunks.map((chunk) => {
    const sectionPart = chunk.sectionPath ? ` ${chunk.sectionPath}` : ''
    return `P.${chunk.page}${sectionPart}`
  })

  const context = chunks
    .map((chunk, index) => {
      const sectionText = chunk.sectionPath ? `章节: ${chunk.sectionPath}` : '章节: 未知'
      return [
        `片段 ${index + 1}`,
        `页码: ${chunk.page}`,
        sectionText,
        `相关度: ${typeof chunk.score === 'number' ? chunk.score.toFixed(4) : 'n/a'}`,
        chunk.text,
      ].join('\n')
    })
    .join('\n\n')

  return {
    paperTitle,
    citations,
    prompt: [
      `论文标题: ${paperTitle}`,
      `用户问题: ${question}`,
      '以下内容为从当前论文检索得到的证据片段。你必须只基于这些证据回答；若证据不足，直接说明。',
      context,
    ].join('\n\n'),
  }
}

const requestChatCompletion = async ({ question, page, anchorId, artifactDir, useRag, topK }) => {
  const settings = readSettings()
  if (!settings.apiKey) {
    throw new Error('apiKey is not configured')
  }

  const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
  const document = buildDocument(targetArtifactDir)
  let mode = 'page'
  let retrievedChunks = []
  let promptPayload

  if (useRag) {
    const ragStatus = getRagStatus(targetArtifactDir)
    if (!ragStatus.indexed) {
      throw new Error(`RAG index is not ready for ${targetArtifactDir}`)
    }

    const retrieval = await retrieveRagChunks(targetArtifactDir, {
      question,
      topK,
      settings,
    })

    retrievedChunks = Array.isArray(retrieval.chunks) ? retrieval.chunks : []
    if (!retrievedChunks.length) {
      throw new Error('RAG retrieval returned no chunks')
    }

    promptPayload = buildRagPrompt({
      paperTitle: document.paperTitle,
      question,
      chunks: retrievedChunks,
    })
    mode = 'rag'
  } else {
    promptPayload = buildChatContext({ question, page, anchorId, artifactDir: targetArtifactDir })
  }

  const { prompt, paperTitle, citations } = promptPayload
  const endpoint = `${String(settings.apiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: mode === 'rag'
            ? '你是一个论文阅读助手。你必须只基于给定检索证据回答，优先给出结构化总结，并明确指出证据对应的页码或章节。若上下文不足，直接说明证据不足，不要编造。'
            : '你是一个论文阅读助手。你必须只基于给定页面与锚点上下文回答，优先给出结构化总结，并明确指出回答对应的是当前页内容。若上下文不足，直接说明证据不足，不要编造。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`chat request failed: ${response.status} ${detail}`)
  }

  const payload = await response.json()
  return {
    answer: payload?.choices?.[0]?.message?.content || '模型未返回内容。',
    paperTitle,
    citations,
    mode,
    retrievedChunks,
  }
}

ensureSettings()
ensureDirectories()

app.use('/workspace', express.static(path.join(rootDir, 'workspace')))
app.use('/工业缺陷零样本分割2026', express.static(path.join(rootDir, '工业缺陷零样本分割2026')))

app.get('/api/fs', (req, res) => {
  const target = typeof req.query.path === 'string' && req.query.path ? req.query.path : rootDir
  if (!fs.existsSync(target)) {
    res.status(404).json({ error: `Path not found: ${target}` })
    return
  }

  const stat = fs.statSync(target)
  if (stat.isFile()) {
    res.json({
      path: target,
      type: 'file',
      name: path.basename(target),
      mime: mime.lookup(target) || 'application/octet-stream',
    })
    return
  }

  const entries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    path: path.join(target, entry.name),
    type: entry.isDirectory() ? 'directory' : 'file',
  }))

  res.json({ path: target, type: 'directory', entries })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/document', (_req, res) => {
  res.json(buildDocument())
})

app.get('/api/library', (_req, res) => {
  res.json(listKnowledgeDocuments())
})

app.post('/api/library/select', (req, res) => {
  const artifactDir = typeof req.body?.artifactDir === 'string' ? req.body.artifactDir.trim() : ''

  if (!artifactDir || !fs.existsSync(artifactDir)) {
    res.status(400).json({ error: 'artifactDir is required and must exist' })
    return
  }

  const contentListPath = getDocumentContentListPath(artifactDir)
  if (!contentListPath) {
    res.status(400).json({ error: 'artifactDir does not contain a readable document' })
    return
  }

  activeDocumentDir = artifactDir
  res.json({ ok: true, document: buildDocument(), library: listKnowledgeDocuments() })
})

app.get('/api/tasks', (_req, res) => {
  res.json(tasks)
})

app.get('/api/tasks/stream', (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  taskClients.add(res)
  res.write(`data: ${JSON.stringify(tasks)}\n\n`)

  _req.on('close', () => {
    taskClients.delete(res)
  })
})

app.post('/api/import', (req, res) => {
  const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : ''
  if (!filePath) {
    res.status(400).json({ error: 'filePath is required' })
    return
  }
  startImportTask(filePath, res)
})

app.post('/api/import/retry', (req, res) => {
  const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : ''
  if (!filePath) {
    res.status(400).json({ error: 'filePath is required' })
    return
  }

  const taskResponse = {
    json(payload) {
      res.json({ task: payload })
    },
    status(code) {
      res.status(code)
      return this
    },
  }

  startImportTask(filePath, taskResponse)
})

app.post('/api/import-upload', upload.single('paper'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'paper file is required' })
    return
  }

  const originalName = req.file.originalname || 'paper.pdf'
  const safeName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '-')}`
  const finalPath = path.join(uploadsDir, safeName)
  fs.renameSync(req.file.path, finalPath)

  const taskResponse = {
    json(payload) {
      res.json({ filePath: finalPath, task: payload })
    },
    status(code) {
      res.status(code)
      return this
    },
  }

  startImportTask(finalPath, taskResponse)
})

const syncImagesToGithub = (taskId, imageDir, settings) => {
  updateTask(taskId, (current) => ({
    ...current,
    status: 'uploading-images',
    detail: '正在同步产物到 GitHub。',
    timestamp: nowTime(),
  }))

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    GITHUB_TOKEN: settings.githubToken || '',
  }

  const child = spawn(
    settings.pythonExePath || 'python',
    [
      githubSyncPath,
      '--image-dir',
      imageDir,
      '--repo',
      settings.githubRepo,
      '--branch',
      settings.githubBranch,
      '--output-root',
      settings.outputRoot || runsDir,
    ],
    { cwd: rootDir, env },
  )

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    for (const line of text.split(/\r?\n/)) {
      appendTaskLog(taskId, line, { status: 'uploading-images' })
    }
  })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf-8')
    for (const line of text.split(/\r?\n/)) {
      appendTaskLog(taskId, line, { status: 'uploading-images' })
    }
  })

  child.on('close', (code) => {
    if (code === 0) {
      updateTask(taskId, (current) => ({
        ...current,
        status: 'ready',
        detail: '图片已同步到 GitHub。',
        timestamp: nowTime(),
        logs: [...(current.logs ?? []), 'GitHub 图片同步完成。'],
      }))
      return
    }

    updateTask(taskId, (current) => ({
      ...current,
      status: 'failed',
      detail: 'GitHub 图片同步失败，请查看日志。',
      timestamp: nowTime(),
      logs: [...(current.logs ?? []), `GitHub 图片同步失败，退出码 ${code ?? 'unknown'}。`],
    }))
  })
}

app.post('/api/github-sync', (req, res) => {
  const rawImageDir = typeof req.body?.imageDir === 'string' ? req.body.imageDir.trim() : ''
  const rawArtifactDir = typeof req.body?.artifactDir === 'string' ? req.body.artifactDir.trim() : ''

  const resolveWorkspacePath = (targetPath) => {
    if (!targetPath) {
      return ''
    }

    if (path.isAbsolute(targetPath)) {
      return targetPath
    }

    const normalized = targetPath.replace(/^\/+/, '').split('/').join(path.sep)
    return path.join(rootDir, normalized)
  }

  const artifactDir = resolveWorkspacePath(rawArtifactDir)
  let imageDir = resolveWorkspacePath(rawImageDir)

  if (artifactDir && fs.existsSync(path.join(artifactDir, 'images'))) {
    imageDir = path.join(artifactDir, 'images')
  } else if (imageDir && fs.existsSync(path.join(imageDir, 'images'))) {
    imageDir = path.join(imageDir, 'images')
  }

  if (!imageDir || !fs.existsSync(imageDir)) {
    res.status(400).json({ error: 'imageDir or artifactDir is required and must exist' })
    return
  }

  const settings = readSettings()
  const task = {
    id: `task-${Date.now()}`,
    title: '正在同步产物到 GitHub',
    detail: `${imageDir} 已进入 GitHub 同步队列。`,
    status: 'uploading-images',
    timestamp: nowTime(),
    logs: [`同步目录: ${imageDir}`],
  }
  prependTask(task)
  syncImagesToGithub(task.id, imageDir, settings)
  res.json(task)
})

app.get('/api/settings', (_req, res) => {
  res.json(readJson(settingsPath))
})

app.get('/api/conda-envs', async (_req, res) => {
  const result = await listCondaEnvironments()
  res.json(result)
})

app.put('/api/settings', (req, res) => {
  const nextSettings = { ...defaultSettings, ...req.body }
  fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf-8')
  syncEnvironmentTask(nextSettings)
  res.json(nextSettings)
})

app.get('/api/rag/index-status', (req, res) => {
  const artifactDir = typeof req.query.artifactDir === 'string' && req.query.artifactDir.trim()
    ? req.query.artifactDir.trim()
    : resolveActiveDocumentDir()

  if (!artifactDir || !fs.existsSync(artifactDir)) {
    res.status(400).json({ error: 'artifactDir is required and must exist' })
    return
  }

  res.json({ ok: true, ...getRagStatus(artifactDir) })
})

app.post('/api/rag/index', async (req, res) => {
  const settings = readSettings()
  const artifactDir = typeof req.body?.artifactDir === 'string' && req.body.artifactDir.trim()
    ? req.body.artifactDir.trim()
    : resolveActiveDocumentDir()
  const rebuild = Boolean(req.body?.rebuild)

  if (!artifactDir || !fs.existsSync(artifactDir)) {
    res.status(400).json({ error: 'artifactDir is required and must exist' })
    return
  }

  const currentStatus = getRagStatus(artifactDir)
  if (currentStatus.indexed && !rebuild) {
    res.json({ ok: true, ...currentStatus })
    return
  }

  try {
    const result = await buildRagIndex(artifactDir, { settings })
    res.json({ ok: true, ...result, ...getRagStatus(artifactDir) })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'rag index build failed' })
  }
})

app.post('/api/rag/retrieve', async (req, res) => {
  const settings = readSettings()
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
  const artifactDir = typeof req.body?.artifactDir === 'string' && req.body.artifactDir.trim()
    ? req.body.artifactDir.trim()
    : resolveActiveDocumentDir()
  const topK = Number(req.body?.topK) || settings.ragTopK || 8

  if (!question) {
    res.status(400).json({ error: 'question is required' })
    return
  }

  if (!artifactDir || !fs.existsSync(artifactDir)) {
    res.status(400).json({ error: 'artifactDir is required and must exist' })
    return
  }

  try {
    const result = await retrieveRagChunks(artifactDir, { question, topK, settings })
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'rag retrieval failed' })
  }
})

app.post('/api/chat', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
  const page = Number(req.body?.page) || 1
  const anchorId = typeof req.body?.anchorId === 'string' ? req.body.anchorId : ''
  const useRag = Boolean(req.body?.useRag)
  const topK = Number(req.body?.topK) || undefined
  const artifactDir = typeof req.body?.artifactDir === 'string' ? req.body.artifactDir.trim() : ''

  if (!question) {
    res.status(400).json({ error: 'question is required' })
    return
  }

  try {
    const result = await requestChatCompletion({ question, page, anchorId, artifactDir, useRag, topK })
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'chat failed' })
  }
})

const server = http.createServer(app)

server.on('error', (error) => {
  console.error('Paper Reader API failed to start:', error)
  process.exitCode = 1
})

server.on('close', () => {
  console.warn('Paper Reader API server closed')
})

server.listen(8787, '127.0.0.1', () => {
  const address = server.address()
  if (typeof address === 'object' && address) {
    console.log(`Paper Reader API listening on http://${address.address}:${address.port}`)
    return
  }

  console.log('Paper Reader API listening on http://127.0.0.1:8787')
})
