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
const conversationsPath = path.join(rootDir, 'server', 'conversations.json')
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
  openaiApiMode: 'chat',
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

const resolvePythonCommand = (settings) => {
  const configuredPython = (settings.pythonExePath || '').trim()
  if (configuredPython) {
    return { command: configuredPython, args: [] }
  }

  const condaPrefix = process.env.CONDA_PREFIX || ''
  if (condaPrefix) {
    const candidate = path.join(condaPrefix, process.platform === 'win32' ? 'python.exe' : 'bin/python')
    if (fs.existsSync(candidate)) {
      return { command: candidate, args: [] }
    }
  }

  if (settings.condaEnv && settings.condaExePath) {
    const condaRoot = path.dirname(path.dirname(settings.condaExePath))
    const candidate = path.join(
      condaRoot,
      'envs',
      settings.condaEnv,
      process.platform === 'win32' ? 'python.exe' : 'bin/python',
    )
    if (fs.existsSync(candidate)) {
      return { command: candidate, args: [] }
    }
  }

  if (settings.condaExePath && settings.condaEnv) {
    return { command: settings.condaExePath, args: ['run', '-n', settings.condaEnv, 'python'] }
  }

  return { command: 'python', args: [] }
}

const ensureSettings = () => {
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf-8')
  }
}

const ensureConversationsStore = () => {
  if (!fs.existsSync(conversationsPath)) {
    fs.writeFileSync(conversationsPath, JSON.stringify({ conversations: [] }, null, 2), 'utf-8')
  }
}

const ensureDirectories = () => {
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.mkdirSync(runsDir, { recursive: true })
}

const readSettings = () => ({ ...defaultSettings, ...readJson(settingsPath) })

const readConversationsStore = () => {
  ensureConversationsStore()
  const payload = readJson(conversationsPath)
  return Array.isArray(payload?.conversations) ? payload : { conversations: [] }
}

const writeConversationsStore = (store) => {
  fs.writeFileSync(conversationsPath, JSON.stringify(store, null, 2), 'utf-8')
}

const toConversationSummary = (conversation) => ({
  id: conversation.id,
  title: conversation.title,
  artifactDir: conversation.artifactDir,
  paperTitle: conversation.paperTitle,
  updatedAt: conversation.updatedAt,
  messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
})

const resolveConversationTitle = ({ userText, paperTitle }) => {
  const base = String(userText || '').trim().replace(/\s+/g, ' ')
  if (base) {
    return base.length > 36 ? `${base.slice(0, 36)}...` : base
  }
  return paperTitle ? `${paperTitle} 对话` : '新会话'
}

const createConversationRecord = ({ artifactDir, paperTitle, title }) => {
  const now = new Date().toISOString()
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title || resolveConversationTitle({ paperTitle }),
    artifactDir: artifactDir || '',
    paperTitle: paperTitle || '',
    updatedAt: now,
    messages: [],
  }
}

const getConversationRecord = (conversationId) => {
  const store = readConversationsStore()
  const conversation = store.conversations.find((item) => item.id === conversationId)
  return conversation ? { store, conversation } : { store, conversation: null }
}

const upsertConversationRecord = ({ conversationId, artifactDir, paperTitle, title }) => {
  const store = readConversationsStore()
  let conversation = store.conversations.find((item) => item.id === conversationId)

  if (!conversation) {
    conversation = createConversationRecord({ artifactDir, paperTitle, title })
    if (conversationId) {
      conversation.id = conversationId
    }
    store.conversations.unshift(conversation)
  }

  if (artifactDir) {
    conversation.artifactDir = artifactDir
  }
  if (paperTitle) {
    conversation.paperTitle = paperTitle
  }
  if (title) {
    conversation.title = title
  }
  conversation.updatedAt = new Date().toISOString()
  writeConversationsStore(store)
  return conversation
}

const appendConversationMessage = ({ conversationId, artifactDir, paperTitle, title, message }) => {
  const conversation = upsertConversationRecord({ conversationId, artifactDir, paperTitle, title })
  conversation.messages.push(message)
  conversation.updatedAt = new Date().toISOString()
  if (!conversation.title || conversation.title === '新会话') {
    conversation.title = resolveConversationTitle({ userText: message.role === 'user' ? message.content : '', paperTitle })
  }
  const store = readConversationsStore()
  const index = store.conversations.findIndex((item) => item.id === conversation.id)
  if (index >= 0) {
    store.conversations[index] = conversation
    const [updated] = store.conversations.splice(index, 1)
    store.conversations.unshift(updated)
  } else {
    store.conversations.unshift(conversation)
  }
  writeConversationsStore(store)
  return conversation
}

const updateConversationMessage = ({ conversationId, messageId, updater }) => {
  const store = readConversationsStore()
  const conversationIndex = store.conversations.findIndex((item) => item.id === conversationId)
  if (conversationIndex < 0) {
    return null
  }
  const conversation = store.conversations[conversationIndex]
  const messageIndex = conversation.messages.findIndex((item) => item.id === messageId)
  if (messageIndex < 0) {
    return null
  }
  conversation.messages[messageIndex] = updater(conversation.messages[messageIndex])
  conversation.updatedAt = new Date().toISOString()
  const [updated] = store.conversations.splice(conversationIndex, 1)
  store.conversations.unshift(updated)
  writeConversationsStore(store)
  return updated.messages[messageIndex]
}

const buildChatCompletionCandidates = (apiBaseUrl, mode = 'chat') => {
  const normalizedBase = String(apiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const hostNormalizedBase = normalizedBase.replace(/\/(chat\/completions|responses|completions)$/i, '')
  const candidates = mode === 'responses'
    ? [`${normalizedBase}/responses`, `${hostNormalizedBase}/responses`]
    : [
        `${normalizedBase}/chat/completions`,
        `${normalizedBase}/completions`,
        `${hostNormalizedBase}/chat/completions`,
      ]

  if (!/\/v1$/i.test(normalizedBase)) {
    if (mode === 'responses') {
      candidates.push(`${normalizedBase}/v1/responses`)
    } else {
      candidates.push(`${normalizedBase}/v1/chat/completions`)
    }
  }

  return [...new Set(candidates)]
}

const extractResponseText = (payload) => {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  if (typeof payload?.response === 'string' && payload.response.trim()) {
    return payload.response.trim()
  }

  if (typeof payload?.text === 'string' && payload.text.trim()) {
    return payload.text.trim()
  }

  if (typeof payload?.content === 'string' && payload.content.trim()) {
    return payload.content.trim()
  }

  const choices = Array.isArray(payload?.choices) ? payload.choices : []
  for (const choice of choices) {
    if (typeof choice?.text === 'string' && choice.text.trim()) {
      return choice.text.trim()
    }

    if (typeof choice?.message?.content === 'string' && choice.message.content.trim()) {
      return choice.message.content.trim()
    }

    const messageContent = choice?.message?.content
    if (Array.isArray(messageContent)) {
      for (const item of messageContent) {
        if (typeof item?.text === 'string' && item.text.trim()) {
          return item.text.trim()
        }
        if (typeof item?.content === 'string' && item.content.trim()) {
          return item.content.trim()
        }
      }
    }

    const deltaContent = choice?.delta?.content
    if (typeof deltaContent === 'string' && deltaContent.trim()) {
      return deltaContent.trim()
    }
    if (Array.isArray(deltaContent)) {
      for (const item of deltaContent) {
        if (typeof item?.text === 'string' && item.text.trim()) {
          return item.text.trim()
        }
      }
    }
  }

  const output = Array.isArray(payload?.output) ? payload.output : []
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const block of content) {
      if (typeof block?.text === 'string' && block.text.trim()) {
        return block.text.trim()
      }
      if (typeof block?.output_text === 'string' && block.output_text.trim()) {
        return block.output_text.trim()
      }
    }
  }

  const candidates = [payload?.data, payload?.result]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item?.text === 'string' && item.text.trim()) {
          return item.text.trim()
        }
      }
    }
  }

  return ''
}

const summarizePayload = (payload) => {
  try {
    const summary = JSON.stringify(payload)
    return summary.length > 240 ? `${summary.slice(0, 240)}...` : summary
  } catch {
    return ''
  }
}

const buildRequestBody = ({ settings, systemPrompt, userPrompt, messages, temperature, maxTokens }) => {
  const normalizedMessages = Array.isArray(messages) && messages.length
    ? messages
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]

  if (settings.openaiApiMode === 'responses') {
    return {
      model: settings.model,
      input: normalizedMessages,
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(typeof maxTokens === 'number' ? { max_output_tokens: maxTokens } : {}),
    }
  }

  return {
    model: settings.model,
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
    messages: normalizedMessages,
  }
}

const parseModelReply = (settings, payload) => {
  const extracted = extractResponseText(payload)
  if (extracted) {
    return extracted
  }

  try {
    const serialized = JSON.stringify(payload)
    if (serialized && serialized !== '{}' && serialized !== 'null') {
      return `模型返回了未识别的响应格式：${serialized.slice(0, 1200)}`
    }
  } catch {
    // ignore serialization failure
  }

  if (settings.openaiApiMode === 'responses') {
    return '模型未返回内容。'
  }

  return '模型未返回内容。'
}

const createStreamingRequestBody = ({ settings, systemPrompt, userPrompt, messages, temperature, maxTokens }) => {
  const body = buildRequestBody({ settings, systemPrompt, userPrompt, messages, temperature, maxTokens })
  return {
    ...body,
    stream: true,
  }
}

const extractStreamDelta = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  for (const choice of choices) {
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      return choice.delta.content
    }

    if (Array.isArray(choice?.delta?.content)) {
      const joined = choice.delta.content
        .map((item) => {
          if (typeof item?.text === 'string') {
            return item.text
          }
          if (typeof item?.content === 'string') {
            return item.content
          }
          return ''
        })
        .join('')
      if (joined) {
        return joined
      }
    }
  }

  if (typeof payload.delta === 'string' && payload.delta) {
    return payload.delta
  }

  return ''
}

const stripThinkBlocks = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '')

const writeJsonLine = (res, payload) => {
  res.write(`${JSON.stringify(payload)}\n`)
}

const writeProgressEvent = (res, stage, message) => {
  writeJsonLine(res, {
    type: 'delta',
    delta: '',
    answer: message,
    stage,
  })
}

const postChatCompletionStream = async (settings, body, contextLabel) => {
  const endpoints = buildChatCompletionCandidates(settings.apiBaseUrl, settings.openaiApiMode)
  let lastDetail = ''

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (response.ok && response.body) {
      return response
    }

    const detail = await response.text()
    lastDetail = detail

    if (response.status !== 404) {
      throw new Error(`${contextLabel} failed: ${response.status} ${detail}`)
    }
  }

  throw new Error(
    `${contextLabel} failed: 404 endpoint not found in ${settings.openaiApiMode} mode. Tried: ${endpoints.join(', ')}. ` +
    `Check apiBaseUrl and provider-specific path. Last response: ${lastDetail || 'empty response'}`,
  )
}

const pipeModelStream = async ({ response, res, meta, conversationId, assistantMessageId }) => {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let accumulatedText = ''

  const persistAssistantMessage = (updater) => {
    if (!conversationId || !assistantMessageId) {
      return
    }

    updateConversationMessage({
      conversationId,
      messageId: assistantMessageId,
      updater,
    })
  }

  writeJsonLine(res, {
    type: 'meta',
    ...meta,
  })

  persistAssistantMessage((message) => ({
    ...message,
    citations: meta.citations ?? message.citations,
    mode: meta.mode ?? message.mode,
  }))

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || !line.startsWith('data:')) {
        continue
      }

      const data = line.slice(5).trim()
      if (!data) {
        continue
      }

      if (data === '[DONE]') {
        const finalText = stripThinkBlocks(accumulatedText)
        persistAssistantMessage((message) => ({
          ...message,
          content: finalText,
          status: 'done',
          citations: meta.citations ?? message.citations,
          mode: meta.mode ?? message.mode,
        }))
        writeJsonLine(res, {
          type: 'done',
          answer: finalText,
          citations: meta.citations,
          mode: meta.mode,
          paperTitle: meta.paperTitle,
          retrievedChunks: meta.retrievedChunks,
          sections: meta.sections,
        })
        return
      }

      try {
        const payload = JSON.parse(data)
        const delta = extractStreamDelta(payload)
        if (!delta) {
          continue
        }

        accumulatedText += delta
        const streamedAnswer = stripThinkBlocks(accumulatedText)
        persistAssistantMessage((message) => ({
          ...message,
          content: streamedAnswer,
          status: 'streaming',
          citations: meta.citations ?? message.citations,
          mode: meta.mode ?? message.mode,
        }))
        writeJsonLine(res, {
          type: 'delta',
          delta,
          answer: streamedAnswer,
        })
      } catch {
        continue
      }
    }
  }

  if (buffer.trim().startsWith('data:')) {
    const data = buffer.trim().slice(5).trim()
    if (data && data !== '[DONE]') {
      try {
        const payload = JSON.parse(data)
        const delta = extractStreamDelta(payload)
        if (delta) {
          accumulatedText += delta
          const streamedAnswer = stripThinkBlocks(accumulatedText)
          persistAssistantMessage((message) => ({
            ...message,
            content: streamedAnswer,
            status: 'streaming',
            citations: meta.citations ?? message.citations,
            mode: meta.mode ?? message.mode,
          }))
          writeJsonLine(res, {
            type: 'delta',
            delta,
            answer: streamedAnswer,
          })
        }
      } catch {
        // ignore trailing parse errors for incomplete upstream events
      }
    }
  }

  const finalText = stripThinkBlocks(accumulatedText)
  persistAssistantMessage((message) => ({
    ...message,
    content: finalText,
    status: 'done',
    citations: meta.citations ?? message.citations,
    mode: meta.mode ?? message.mode,
  }))
  writeJsonLine(res, {
    type: 'done',
    answer: finalText,
    citations: meta.citations,
    mode: meta.mode,
    paperTitle: meta.paperTitle,
    retrievedChunks: meta.retrievedChunks,
    sections: meta.sections,
  })
}

const buildConversationMessages = ({ systemPrompt, contextPrompt, history, userPrompt }) => {
  const messages = [{ role: 'system', content: systemPrompt }]

  if (contextPrompt) {
    messages.push({ role: 'system', content: contextPrompt })
  }

  if (Array.isArray(history) && history.length) {
    for (const item of history) {
      if (!item || (item.role !== 'user' && item.role !== 'assistant')) {
        continue
      }
      const content = typeof item.content === 'string' ? item.content.trim() : ''
      if (!content) {
        continue
      }
      messages.push({ role: item.role, content })
    }
  }

  messages.push({ role: 'user', content: userPrompt })
  return messages
}

const buildContentBlocks = ({ text, imageEvidence = [] }) => {
  const blocks = []

  if (text) {
    blocks.push({ type: 'text', text })
  }

  for (const item of imageEvidence) {
    const imageUrl = item?.remoteUrl || item?.src
    if (!imageUrl) {
      continue
    }

    blocks.push({
      type: 'image_url',
      image_url: {
        url: imageUrl,
      },
    })
  }

  return blocks.length ? blocks : text
}

const buildConversationMessagesWithImages = ({ systemPrompt, contextPrompt, history, userPrompt, imageEvidence = [] }) => {
  const messages = [{ role: 'system', content: systemPrompt }]

  if (contextPrompt) {
    messages.push({ role: 'system', content: contextPrompt })
  }

  if (Array.isArray(history) && history.length) {
    for (const item of history) {
      if (!item || (item.role !== 'user' && item.role !== 'assistant')) {
        continue
      }

      const content = typeof item.content === 'string' ? item.content.trim() : ''
      if (!content) {
        continue
      }

      messages.push({ role: item.role, content })
    }
  }

  messages.push({
    role: 'user',
    content: buildContentBlocks({ text: userPrompt, imageEvidence }),
  })

  return messages
}

const postChatCompletion = async (settings, body, contextLabel) => {
  const endpoints = buildChatCompletionCandidates(settings.apiBaseUrl, settings.openaiApiMode)
  let lastStatus = 0
  let lastDetail = ''

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      return response.json()
    }

    const detail = await response.text()
    lastStatus = response.status
    lastDetail = detail

    if (response.status !== 404) {
      throw new Error(`${contextLabel} failed: ${response.status} ${detail}`)
    }
  }

  throw new Error(
    `${contextLabel} failed: 404 endpoint not found in ${settings.openaiApiMode} mode. Tried: ${endpoints.join(', ')}. ` +
    `Check apiBaseUrl and provider-specific path. Last response: ${lastDetail || 'empty response'}`,
  )
}

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

const resolveDisplayPaperTitle = (value) => {
  const source = String(value || '').trim()
  if (!source) {
    return ''
  }

  return path.parse(source).name.trim()
}

const getDocumentDisplayTitle = (artifactDir) => {
  const metaPath = path.join(artifactDir, 'display_title.json')
  if (!fs.existsSync(metaPath)) {
    return getDocumentBaseName(artifactDir)
  }

  try {
    const payload = readJson(metaPath)
    const displayTitle = resolveDisplayPaperTitle(payload?.displayTitle || payload?.originalName || payload?.fileName)
    return displayTitle || getDocumentBaseName(artifactDir)
  } catch {
    return getDocumentBaseName(artifactDir)
  }
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

const getGithubManifestPath = (artifactDir) => path.join(artifactDir, 'github_manifest.json')

const readGithubManifest = (artifactDir) => {
  const manifestPath = getGithubManifestPath(artifactDir)
  if (!fs.existsSync(manifestPath)) {
    return []
  }

  try {
    const payload = readJson(manifestPath)
    return Array.isArray(payload) ? payload : []
  } catch {
    return []
  }
}

const normalizePathForMatch = (value) => String(value || '').replace(/\\/g, '/').replace(/^\//, '')

const resolveFigureRemoteUrl = ({ artifactDir, src }) => {
  if (!src) {
    return ''
  }

  const manifest = readGithubManifest(artifactDir)
  const normalizedSrc = normalizePathForMatch(src)
  const match = manifest.find((item) => {
    const localPath = normalizePathForMatch(item?.localPath)
    const remotePath = normalizePathForMatch(item?.remotePath)
    return localPath.endsWith(normalizedSrc) || remotePath.endsWith(normalizedSrc)
  })

  return typeof match?.remoteUrl === 'string' ? match.remoteUrl : ''
}

const enrichFiguresWithRemoteUrls = ({ artifactDir, figures }) => figures.map((figure) => ({
  ...figure,
  remoteUrl: figure.remoteUrl || resolveFigureRemoteUrl({ artifactDir, src: figure.src }),
}))

const collectImageEvidence = ({ artifactDir, document, question, retrievedChunks = [], limit = 3 }) => {
  const normalizedQuestion = String(question || '').toLowerCase()
  const figures = enrichFiguresWithRemoteUrls({ artifactDir, figures: document.figures || [] })
  const pagesFromChunks = new Set(
    retrievedChunks
      .flatMap((chunk) => Array.isArray(chunk?.pages) && chunk.pages.length ? chunk.pages : [chunk?.page])
      .filter((value) => Number.isFinite(value)),
  )

  return figures
    .map((figure) => {
      let score = 0
      if (pagesFromChunks.has(figure.page)) {
        score += 3
      }

      if (figure.caption && normalizedQuestion) {
        const caption = figure.caption.toLowerCase()
        const tokens = normalizedQuestion.split(/\s+/).filter(Boolean)
        score += tokens.reduce((sum, token) => sum + (caption.includes(token) ? 1 : 0), 0)
      }

      if (/图|figure|table|表|架构|流程|示意/.test(normalizedQuestion)) {
        score += 2
      }

      return {
        id: figure.id,
        page: figure.page,
        caption: figure.caption,
        src: figure.src,
        remoteUrl: figure.remoteUrl,
        score,
      }
    })
    .filter((item) => item.remoteUrl || item.src)
    .sort((left, right) => right.score - left.score || left.page - right.page)
    .slice(0, Math.max(limit, 0))
    .map(({ score, ...item }) => item)
}

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
    PYTHONUTF8: '1',
  }

  const pythonCommand = resolvePythonCommand(settings)
  return spawn(pythonCommand.command, [...pythonCommand.args, scriptPath, ...scriptArgs], { cwd: rootDir, env })
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

    const ragStatus = getRagStatus(artifactDir)
    const lastJsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .at(-1)

    if (!lastJsonLine) {
      resolve({ ok: true, ...ragStatus })
      return
    }

    try {
      const parsed = JSON.parse(lastJsonLine)
      resolve({ ...ragStatus, ...parsed })
    } catch (error) {
      if (ragStatus.indexed) {
        if (taskId) {
          appendTaskLog(taskId, `RAG 构建结果解析失败，已根据落盘产物判定成功: ${error.message}`, { status: 'ready' })
        }
        resolve({ ok: true, ...ragStatus, parseWarning: error.message })
        return
      }
      reject(error)
    }
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
    const lastJsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .at(-1)

    if (lastJsonLine) {
      try {
        resolve(JSON.parse(lastJsonLine))
        return
      } catch (error) {
        reject(new Error(`rag query returned invalid JSON: ${error instanceof Error ? error.message : 'unknown error'}`))
        return
      }
    }

    const stderrText = stderr.trim()
    const stdoutText = stdout.trim()

    if (code !== 0) {
      reject(new Error(stderrText || stdoutText || `rag query failed with exit code ${code ?? 'unknown'}`))
      return
    }

    reject(new Error(stderrText || stdoutText || 'rag query did not return JSON payload'))
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
        paperTitle: getDocumentDisplayTitle(artifactDir),
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

const startImportTask = (filePath, res, options = {}) => {
  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: `File not found: ${filePath}` })
    return
  }

  const settings = readSettings()
  const sourceName = path.basename(filePath)
  const originalName = typeof options.originalName === 'string' && options.originalName.trim()
    ? options.originalName.trim()
    : sourceName
  const paperStem = path.parse(sourceName).name
  const paperId = `${slugifyPaperId(paperStem)}-${Date.now()}`
  const outputDir = path.join(settings.outputRoot, paperId)
  const task = {
    id: `task-${Date.now()}`,
    title: `正在解析 ${originalName}`,
    detail: `已接收 ${originalName}，准备启动 ${settings.executionMode} 解析。`,
    status: 'queued',
    timestamp: nowTime(),
    logs: [`输入文件: ${filePath}`],
    paperId,
    inputPath: filePath,
    outputDir,
    originalName,
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
    const pythonCommand = resolvePythonCommand(settings)
    return spawn(pythonCommand.command, [...pythonCommand.args, ...workerArgs], { cwd: rootDir, env })
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

      if (artifactDir && fs.existsSync(artifactDir) && currentTask?.originalName) {
        try {
          fs.writeFileSync(
            path.join(artifactDir, 'display_title.json'),
            JSON.stringify({ displayTitle: resolveDisplayPaperTitle(currentTask.originalName), originalName: currentTask.originalName }, null, 2),
            'utf-8',
          )
        } catch (error) {
          appendTaskLog(task.id, `写入展示标题失败: ${error.message}`)
        }
      }

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

  return {
    pages,
    outline,
    figures: enrichFiguresWithRemoteUrls({ artifactDir: resolvedDocumentDir, figures }),
    anchors,
    pageMetas,
    assetBasePath,
    paperTitle: baseName,
    markdown,
  }
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
  const limitedChunks = Array.isArray(chunks) ? chunks.slice(0, 4) : []
  const citations = limitedChunks.map((chunk) => {
    const sectionPart = chunk.sectionPath ? ` ${chunk.sectionPath}` : ''
    return `P.${chunk.page}${sectionPart}`
  })

  const context = limitedChunks
    .map((chunk, index) => {
      const sectionText = chunk.sectionPath ? `章节: ${chunk.sectionPath}` : '章节: 未知'
      const chunkText = String(chunk.text || '').trim()
      const compactText = chunkText.length > 900 ? `${chunkText.slice(0, 900)}…` : chunkText
      return [
        `片段 ${index + 1}`,
        `页码: ${chunk.page}`,
        sectionText,
        `相关度: ${typeof chunk.score === 'number' ? chunk.score.toFixed(4) : 'n/a'}`,
        compactText,
      ].join('\n')
    })
    .join('\n\n')

  return {
    paperTitle,
    citations,
    prompt: [
      `论文标题: ${paperTitle}`,
      `用户问题: ${question}`,
      '以下内容为从整篇论文检索得到的证据片段，可能跨越多个页面、章节、图表说明与图片标题。你必须只基于这些证据回答；若证据不足，直接说明。',
      '回答要求：先判断问题是在问整体论文、局部页面还是图表/图片；若是整体问题，优先综合多段证据后再给结构化答案；若证据中包含图像标题、表格说明或图号，需要把它们并入分析。',
      context,
    ].join('\n\n'),
  }
}

const planAgentSubqueries = ({ question, paperTitle, intent }) => {
  const normalizedQuestion = String(question || '').trim()
  const plans = []

  if (intent.isWholePaper || /架构|结构|框架|流程|method|architecture/i.test(normalizedQuestion)) {
    plans.push(`论文 ${paperTitle} 的核心任务与问题定义`)
    plans.push(`论文 ${paperTitle} 的整体架构与主要模块`)
    plans.push(`论文 ${paperTitle} 的关键方法机制与训练推理流程`)
  } else if (/实验|效果|结果|消融|对比|experiment|ablation/i.test(normalizedQuestion)) {
    plans.push(`论文 ${paperTitle} 的主实验设置与评价指标`)
    plans.push(`论文 ${paperTitle} 的实验结果与对比结论`)
    plans.push(`论文 ${paperTitle} 的消融实验与主要发现`)
  } else {
    plans.push(normalizedQuestion)
    plans.push(`论文 ${paperTitle} 中与“${normalizedQuestion}”最相关的方法说明`)
    plans.push(`论文 ${paperTitle} 中与“${normalizedQuestion}”最相关的结论或证据`)
  }

  if (intent.wantsImage) {
    plans.push(`论文 ${paperTitle} 中与“${normalizedQuestion}”对应的图表与图片说明`)
  }

  return [...new Set(plans)].slice(0, 4)
}

const buildAgentSubAnswerPrompt = ({ paperTitle, userQuestion, subquery, chunks }) => {
  const citations = uniqueCitations(chunks.map((chunk) => {
    const sectionPart = chunk.sectionPath ? ` ${chunk.sectionPath}` : ''
    return `P.${chunk.page}${sectionPart}`
  }))

  const evidenceText = chunks
    .slice(0, 3)
    .map((chunk, index) => {
      const sectionText = chunk.sectionPath ? `章节: ${chunk.sectionPath}` : '章节: 未知'
      const chunkText = String(chunk.text || '').trim()
      const compactText = chunkText.length > 700 ? `${chunkText.slice(0, 700)}…` : chunkText
      return [
        `证据 ${index + 1}`,
        `页码: ${chunk.page}`,
        sectionText,
        compactText,
      ].join('\n')
    })
    .join('\n\n')

  return {
    citations,
    prompt: [
      `论文标题: ${paperTitle}`,
      `用户总问题: ${userQuestion}`,
      `当前子任务: ${subquery}`,
      '你只回答当前子任务，并提炼与总问题相关的事实，不要输出无关铺垫。',
      '要求：只基于证据回答；证据不足时明确写“证据不足”。输出尽量简洁。',
      `证据片段:\n${evidenceText}`,
    ].join('\n\n'),
  }
}

const buildAgentSynthesisPrompt = ({ paperTitle, question, subAnswers }) => {
  const citations = uniqueCitations(subAnswers.flatMap((item) => item.citations || []))
  const evidenceText = subAnswers
    .map((item, index) => [
      `子结果 ${index + 1}`,
      `子任务: ${item.subquery}`,
      `引用: ${(item.citations || []).join('；') || '无'}`,
      item.answer || '证据不足',
    ].join('\n'))
    .join('\n\n')

  return {
    citations,
    prompt: [
      `论文标题: ${paperTitle}`,
      `用户问题: ${question}`,
      '下面是多个子任务的回答结果，请你综合、去重、纠正冲突，并输出最终答案。',
      '要求：1) 只基于子结果；2) 优先结构化回答；3) 缺失信息明确写“论文中未充分说明”；4) 不要重复。',
      `子结果集合:\n${evidenceText}`,
    ].join('\n\n'),
  }
}

const classifyQuestionIntent = (question) => {
  const normalized = String(question || '').trim().toLowerCase()
  const wholePaperSignals = [
    '全文',
    '整篇',
    '整篇论文',
    '总体',
    '整体',
    '架构',
    '结构',
    '框架',
    '流程',
    '架构分析',
    '结构分析',
    '论文架构',
    '系统架构',
    '整体架构',
    '关键方法',
    '方法机制',
    '原理',
    '实验',
    '消融',
    '对比',
    '创新点',
    '贡献',
    '总结',
    'summary',
    'architecture',
    'method',
    'mechanism',
    'experiment',
    'ablation',
    'contribution',
  ]
  const imageSignals = [
    '图片',
    '图',
    'figure',
    'fig.',
    'fig ',
    'table',
    '表',
    '示意图',
    '可视化',
    '流程图',
    '架构图',
  ]
  const pageSignals = [
    '当前页',
    '本页',
    '这一页',
    '该页',
    '这一段',
    '这里',
  ]

  const isWholePaper = wholePaperSignals.some((signal) => normalized.includes(signal))
  const wantsImage = imageSignals.some((signal) => normalized.includes(signal))
  const isPageScoped = pageSignals.some((signal) => normalized.includes(signal)) && !isWholePaper

  return {
    isWholePaper,
    wantsImage,
    isPageScoped,
    recommendedMode: isPageScoped ? 'page' : 'rag',
  }
}

const buildQuestionPlannerPrompt = ({ mode, intent }) => {
  if (mode === 'rag') {
    return [
      '你是一个论文阅读助手。你要先做隐式规划，再输出最终答案。',
      '规划要求：',
      '- 判断问题是否要求整篇论文级别的综合分析。',
      '- 优先整合跨页证据，而不是只复述单页内容。',
      '- 若问题涉及架构、方法、实验、创新点，默认视为全文问题。',
      '- 若证据中出现图、表、图片标题、图注、表注，应将其视为有效证据并纳入分析。',
      '- 若证据不足，明确写出缺失点，不要编造。',
      `当前路由判断: wholePaper=${intent.isWholePaper}; wantsImage=${intent.wantsImage}; pageScoped=${intent.isPageScoped}`,
    ].join('\n')
  }

  return [
    '你是一个论文阅读助手。当前问题按页面局部问答处理。',
    '你必须优先基于当前页正文和锚点回答，并明确说明这是当前页范围内的结论。',
    '如果用户实际上在问整篇论文层面的架构、方法或实验，请明确说明当前页证据不足，并建议切换到全文分析。',
  ].join('\n')
}

const uniqueCitations = (values) => [...new Set(values.filter(Boolean))]

const createSummarySectionConfig = (paperTitle) => ([
  {
    title: '论文一句话概述',
    coverage: 'good',
    question: `请概括论文 ${paperTitle} 的研究问题、方法和结果亮点`,
  },
  {
    title: '论文的核心贡献',
    coverage: 'good',
    question: `请提取论文 ${paperTitle} 的核心贡献、创新点、解决的问题与收益`,
  },
  {
    title: '整体架构',
    coverage: 'good',
    question: `请说明论文 ${paperTitle} 的整体架构、主要模块、各模块作用与输入输出`,
  },
  {
    title: '关键方法机制',
    coverage: 'good',
    question: `请解释论文 ${paperTitle} 的关键模块、方法步骤、设计动机和实现机制`,
  },
  {
    title: '实验结果与主要发现',
    coverage: 'good',
    question: `请总结论文 ${paperTitle} 的主实验、消融实验、主要发现和总体结论`,
  },
])

const buildSummaryPrompt = ({ paperTitle, sections, chunks }) => {
  const citations = uniqueCitations(chunks.map((chunk) => {
    const sectionPart = chunk.sectionPath ? ` ${chunk.sectionPath}` : ''
    return `P.${chunk.page}${sectionPart}`
  }))

  const evidenceText = chunks
    .map((chunk, index) => {
      const sectionText = chunk.sectionPath ? `章节: ${chunk.sectionPath}` : '章节: 未知'
      const blockText = Array.isArray(chunk.blockTypes) && chunk.blockTypes.length
        ? `块类型: ${chunk.blockTypes.join(', ')}`
        : '块类型: 未知'
      return [
        `证据 ${index + 1}`,
        `页码: ${chunk.page}`,
        sectionText,
        blockText,
        chunk.text,
      ].join('\n')
    })
    .join('\n\n')

  const sectionGuide = sections
    .map((section) => `- ${section.title}: ${section.question}`)
    .join('\n')

  return {
    citations,
    prompt: [
      `论文标题: ${paperTitle}`,
      '你要输出一份论文深度解析，必须保留下列一级结构和标题，不能改标题，不能省略章节：',
      '# 《论文标题》的深度解析',
      '## 1. 论文一句话概述',
      '## 2. 论文的核心贡献',
      '## 3. 整体架构',
      '## 4. 关键方法机制',
      '## 5. 实验结果与主要发现',
      '一级结构固定，但各节内部的小标题、分点数量、组织方式必须根据论文实际内容和证据强弱动态决定，不要套死板模板。',
      '具体要求：',
      '- “论文的核心贡献”不要默认写成固定三点；可以是 2 点、3 点、4 点或更多，按论文真实贡献组织。',
      '- “整体架构”不要机械写“模块1/模块2/模块3”；优先使用论文中的真实组件名、阶段名、流程名或子系统名。若论文本身不是模块化架构，可以改写为“整体流程”“系统组成”“训练/推理流程”等更贴切的形式。',
      '- “关键方法机制”要围绕真正关键的方法展开，不要为了凑格式强行拆成两个模块；几个机制合适就写几个。',
      '- “实验结果与主要发现”优先总结最关键的实验设置、对比结果、消融结论、优势与局限，不要空泛复述。',
      '- 如果论文某部分证据不足，要明确写“论文中未充分说明”，但不要因为证据不足就编造模块名、贡献点数量或流程细节。',
      '- 允许使用项目符号、小标题、编号列表，但必须服务于内容表达，不能显得公式化和僵硬。',
      '- 语言要自然、具体，像在认真分析论文，而不是套统一答题卡。',
      '要求：只基于给定证据回答；证据不足时明确写“论文中未充分说明”；不要编造。',
      `固定 section 任务:\n${sectionGuide}`,
      `证据片段:\n${evidenceText}`,
    ].join('\n\n'),
  }
}

const buildSummaryConversationPrompt = ({ paperTitle, sections, chunks, userPrompt }) => {
  const summary = buildSummaryPrompt({ paperTitle, sections, chunks })
  return {
    citations: summary.citations,
    contextPrompt: summary.prompt,
    userPrompt: userPrompt || `请总结论文《${paperTitle}》，并按固定结构输出。`,
  }
}

const buildSummaryRetrievalQueries = (paperTitle) => ([
  `paper ${paperTitle} abstract main idea contributions`,
  `paper ${paperTitle} method architecture module design`,
  `paper ${paperTitle} experiments results ablation limitations`,
])

const collectSummaryEvidence = async ({ artifactDir, settings, paperTitle }) => {
  const ragStatus = getRagStatus(artifactDir)
  const queries = buildSummaryRetrievalQueries(paperTitle)
  const mergedChunks = []
  const seenChunkIds = new Set()

  if (ragStatus.indexed) {
    for (const query of queries) {
      const retrieval = await retrieveRagChunks(artifactDir, {
        question: query,
        topK: 6,
        settings,
      })

      for (const chunk of Array.isArray(retrieval.chunks) ? retrieval.chunks : []) {
        const dedupeKey = chunk.id || `${chunk.page}-${chunk.sectionPath || ''}-${chunk.text?.slice(0, 80) || ''}`
        if (seenChunkIds.has(dedupeKey)) {
          continue
        }
        seenChunkIds.add(dedupeKey)
        mergedChunks.push(chunk)
      }
    }
  }

  if (mergedChunks.length) {
    return mergedChunks
  }

  const document = buildDocument(artifactDir)
  return document.pages
    .flatMap((page, pageIndex) => page.map((block, blockIndex) => {
      let text = ''
      if (block.type === 'title') {
        text = textFromItems(block.content?.title_content)
      } else if (block.type === 'paragraph') {
        text = textFromItems(block.content?.paragraph_content)
      } else if (block.type === 'image') {
        text = textFromItems(block.content?.image_caption)
      }

      return {
        id: `fallback-${pageIndex}-${blockIndex}`,
        text,
        page: pageIndex + 1,
        sectionPath: '',
        blockTypes: [block.type],
      }
    }))
    .filter((chunk) => chunk.text)
    .slice(0, 32)
}

const requestPaperSummary = async ({ artifactDir, history = [], userPrompt }) => {
  const settings = readSettings()
  if (!settings.apiKey) {
    throw new Error('apiKey is not configured')
  }

  const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
  const document = buildDocument(targetArtifactDir)
  const sections = createSummarySectionConfig(document.paperTitle)
  const evidenceChunks = await collectSummaryEvidence({
    artifactDir: targetArtifactDir,
    settings,
    paperTitle: document.paperTitle,
  })
  const { citations, contextPrompt, userPrompt: resolvedUserPrompt } = buildSummaryConversationPrompt({
    paperTitle: document.paperTitle,
    sections,
    chunks: evidenceChunks,
    userPrompt,
  })

  const payload = await postChatCompletion(settings, buildRequestBody({
    settings,
    systemPrompt: '你是论文深度解析助手。你必须先根据固定章节规划组织信息，再严格按给定 Markdown 模板输出。你只能基于证据回答，证据不足时必须明确写出“论文中未充分说明”。',
    messages: buildConversationMessages({
      systemPrompt: '你是论文深度解析助手。你必须先根据固定章节规划组织信息，再严格按给定 Markdown 模板输出。你只能基于证据回答，证据不足时必须明确写出“论文中未充分说明”。',
      contextPrompt,
      history,
      userPrompt: resolvedUserPrompt,
    }),
    temperature: 0.2,
  }), 'paper summary request')
  return {
    answer: parseModelReply(settings, payload),
    paperTitle: document.paperTitle,
    citations,
    sections: sections.map((section) => ({
      title: section.title,
      coverage: section.coverage,
    })),
  }
}

const streamPaperSummary = async ({ artifactDir, history = [], userPrompt, res, conversationId, assistantMessageId }) => {
  const settings = readSettings()
  if (!settings.apiKey) {
    throw new Error('apiKey is not configured')
  }

  writeProgressEvent(res, 'prepare', '正在整理论文证据与章节结构，请稍候...')

  const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
  const document = buildDocument(targetArtifactDir)
  const sections = createSummarySectionConfig(document.paperTitle)
  const evidenceChunks = await collectSummaryEvidence({
    artifactDir: targetArtifactDir,
    settings,
    paperTitle: document.paperTitle,
  })
  const { citations, contextPrompt, userPrompt: resolvedUserPrompt } = buildSummaryConversationPrompt({
    paperTitle: document.paperTitle,
    sections,
    chunks: evidenceChunks,
    userPrompt,
  })

  writeProgressEvent(res, 'model', '证据整理完成，正在连接模型生成总结...')

  const response = await postChatCompletionStream(settings, createStreamingRequestBody({
    settings,
    systemPrompt: '你是论文深度解析助手。你必须先根据固定章节规划组织信息，再严格按给定 Markdown 模板输出。你只能基于证据回答，证据不足时必须明确写出“论文中未充分说明”。',
    messages: buildConversationMessages({
      systemPrompt: '你是论文深度解析助手。你必须先根据固定章节规划组织信息，再严格按给定 Markdown 模板输出。你只能基于证据回答，证据不足时必须明确写出“论文中未充分说明”。',
      contextPrompt,
      history,
      userPrompt: resolvedUserPrompt,
    }),
    temperature: 0.2,
  }), 'paper summary request')

  await pipeModelStream({
    response,
    res,
    conversationId,
    assistantMessageId,
    meta: {
      paperTitle: document.paperTitle,
      citations,
      sections: sections.map((section) => ({
        title: section.title,
        coverage: section.coverage,
      })),
    },
  })
}

const requestChatCompletion = async ({ question, page, anchorId, artifactDir, useRag, topK, history = [] }) => {
  const settings = readSettings()
  if (!settings.apiKey) {
    throw new Error('apiKey is not configured')
  }

  const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
  const document = buildDocument(targetArtifactDir)
  const intent = classifyQuestionIntent(question)
  let mode = 'page'
  let retrievedChunks = []
  let imageEvidence = []
  let promptPayload

  if (useRag !== false || intent.recommendedMode === 'rag') {
    const ragStatus = getRagStatus(targetArtifactDir)
    if (ragStatus.indexed) {
      const plannerQueries = planAgentSubqueries({
        question,
        paperTitle: document.paperTitle,
        intent,
      })
      const subAnswers = []
      const mergedChunks = []
      const seenChunkIds = new Set()

      for (const subquery of plannerQueries) {
        const retrieval = await retrieveRagChunks(targetArtifactDir, {
          question: subquery,
          topK: Math.min(Number(topK) || settings.ragTopK || 8, 4),
          settings,
        })
        const chunks = Array.isArray(retrieval.chunks) ? retrieval.chunks.slice(0, 3) : []

        for (const chunk of chunks) {
          const dedupeKey = chunk.id || `${chunk.page}-${chunk.sectionPath || ''}-${chunk.text?.slice(0, 80) || ''}`
          if (seenChunkIds.has(dedupeKey)) {
            continue
          }
          seenChunkIds.add(dedupeKey)
          mergedChunks.push(chunk)
        }

        if (!chunks.length) {
          subAnswers.push({ subquery, answer: '证据不足', citations: [] })
          continue
        }

        const subPrompt = buildAgentSubAnswerPrompt({
          paperTitle: document.paperTitle,
          userQuestion: question,
          subquery,
          chunks,
        })
        const subPayload = await postChatCompletion(settings, buildRequestBody({
          settings,
          messages: buildConversationMessages({
            systemPrompt: '你是论文分析智能体的子任务执行器。你只能根据当前证据回答当前子任务。',
            contextPrompt: subPrompt.prompt,
            history: [],
            userPrompt: `请完成子任务：${subquery}`,
          }),
          temperature: 0.1,
          maxTokens: 320,
        }), 'chat subtask request')

        subAnswers.push({
          subquery,
          answer: parseModelReply(settings, subPayload),
          citations: subPrompt.citations,
        })
      }

      if (subAnswers.length) {
        const synthesisPrompt = buildAgentSynthesisPrompt({
          paperTitle: document.paperTitle,
          question,
          subAnswers,
        })
        promptPayload = {
          paperTitle: document.paperTitle,
          citations: synthesisPrompt.citations,
          prompt: synthesisPrompt.prompt,
        }
        retrievedChunks = mergedChunks
        mode = 'rag-agent'
      }
    }
  }

  if (!promptPayload) {
    promptPayload = buildChatContext({ question, page, anchorId, artifactDir: targetArtifactDir })
  }

  if (intent.wantsImage) {
    imageEvidence = collectImageEvidence({
      artifactDir: targetArtifactDir,
      document,
      question,
      retrievedChunks,
      limit: 2,
    })
  }

  const { prompt, paperTitle, citations } = promptPayload
  const systemPrompt = mode.startsWith('rag')
    ? '你是一个论文阅读助手。你必须只基于给定检索证据或子任务结果回答，优先给出结构化总结，并明确指出证据对应的页码、章节、图表或图片说明。若上下文不足，直接说明证据不足，不要编造。'
    : '你是一个论文阅读助手。你必须只基于给定页面与锚点上下文回答，优先给出结构化总结，并明确指出回答对应的是当前页内容。若上下文不足，直接说明证据不足，不要编造。'
  const payload = await postChatCompletion(settings, buildRequestBody({
    settings,
    messages: imageEvidence.length
      ? buildConversationMessagesWithImages({
          systemPrompt,
          contextPrompt: [buildQuestionPlannerPrompt({ mode: mode.startsWith('rag') ? 'rag' : mode, intent }), prompt].join('\n\n'),
          history,
          userPrompt: question,
          imageEvidence,
        })
      : buildConversationMessages({
          systemPrompt,
          contextPrompt: [buildQuestionPlannerPrompt({ mode: mode.startsWith('rag') ? 'rag' : mode, intent }), prompt].join('\n\n'),
          history,
          userPrompt: question,
        }),
    temperature: 0.2,
    maxTokens: 1024,
  }), 'chat request')
  return {
    answer: parseModelReply(settings, payload),
    paperTitle,
    citations,
    mode,
    retrievedChunks,
    imageEvidence,
  }
}

const streamChatCompletion = async ({ question, page, anchorId, artifactDir, useRag, topK, history = [], res, conversationId, assistantMessageId }) => {
  const settings = readSettings()
  if (!settings.apiKey) {
    throw new Error('apiKey is not configured')
  }

  const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
  const document = buildDocument(targetArtifactDir)
  const intent = classifyQuestionIntent(question)
  let mode = 'page'
  let retrievedChunks = []
  let imageEvidence = []
  let promptPayload

  if (useRag !== false || intent.recommendedMode === 'rag') {
    const ragStatus = getRagStatus(targetArtifactDir)
    if (ragStatus.indexed) {
      writeProgressEvent(res, 'plan', '正在规划子任务...')
      const plannerQueries = planAgentSubqueries({
        question,
        paperTitle: document.paperTitle,
        intent,
      })
      const subAnswers = []
      const mergedChunks = []
      const seenChunkIds = new Set()

      for (const [index, subquery] of plannerQueries.entries()) {
        writeProgressEvent(res, 'retrieve', `正在检索子任务 ${index + 1}/${plannerQueries.length}：${subquery}`)
        const retrieval = await retrieveRagChunks(targetArtifactDir, {
          question: subquery,
          topK: Math.min(Number(topK) || settings.ragTopK || 8, 4),
          settings,
        })
        const chunks = Array.isArray(retrieval.chunks) ? retrieval.chunks.slice(0, 3) : []

        for (const chunk of chunks) {
          const dedupeKey = chunk.id || `${chunk.page}-${chunk.sectionPath || ''}-${chunk.text?.slice(0, 80) || ''}`
          if (seenChunkIds.has(dedupeKey)) {
            continue
          }
          seenChunkIds.add(dedupeKey)
          mergedChunks.push(chunk)
        }

        if (!chunks.length) {
          subAnswers.push({ subquery, answer: '证据不足', citations: [] })
          continue
        }

        writeProgressEvent(res, 'reason', `正在分析子任务 ${index + 1}/${plannerQueries.length}...`)
        const subPrompt = buildAgentSubAnswerPrompt({
          paperTitle: document.paperTitle,
          userQuestion: question,
          subquery,
          chunks,
        })
        const subPayload = await postChatCompletion(settings, buildRequestBody({
          settings,
          messages: buildConversationMessages({
            systemPrompt: '你是论文分析智能体的子任务执行器。你只能根据当前证据回答当前子任务。',
            contextPrompt: subPrompt.prompt,
            history: [],
            userPrompt: `请完成子任务：${subquery}`,
          }),
          temperature: 0.1,
          maxTokens: 320,
        }), 'chat subtask request')

        subAnswers.push({
          subquery,
          answer: parseModelReply(settings, subPayload),
          citations: subPrompt.citations,
        })
      }

      if (subAnswers.length) {
        writeProgressEvent(res, 'synthesis', '正在综合多个子任务结果...')
        const synthesisPrompt = buildAgentSynthesisPrompt({
          paperTitle: document.paperTitle,
          question,
          subAnswers,
        })
        promptPayload = {
          paperTitle: document.paperTitle,
          citations: synthesisPrompt.citations,
          prompt: synthesisPrompt.prompt,
        }
        retrievedChunks = mergedChunks
        mode = 'rag-agent'
      }
    }
  }

  if (!promptPayload) {
    promptPayload = buildChatContext({ question, page, anchorId, artifactDir: targetArtifactDir })
  }

  if (intent.wantsImage) {
    imageEvidence = collectImageEvidence({
      artifactDir: targetArtifactDir,
      document,
      question,
      retrievedChunks,
      limit: 2,
    })
  }

  const { prompt, paperTitle, citations } = promptPayload
  const systemPrompt = mode.startsWith('rag')
    ? '你是一个论文阅读助手。你必须只基于给定检索证据或子任务结果回答，优先给出结构化总结，并明确指出证据对应的页码、章节、图表或图片说明。若上下文不足，直接说明证据不足，不要编造。'
    : '你是一个论文阅读助手。你必须只基于给定页面与锚点上下文回答，优先给出结构化总结，并明确指出回答对应的是当前页内容。若上下文不足，直接说明证据不足，不要编造。'
  const response = await postChatCompletionStream(settings, createStreamingRequestBody({
    settings,
    messages: imageEvidence.length
      ? buildConversationMessagesWithImages({
          systemPrompt,
          contextPrompt: [buildQuestionPlannerPrompt({ mode: mode.startsWith('rag') ? 'rag' : mode, intent }), prompt].join('\n\n'),
          history,
          userPrompt: question,
          imageEvidence,
        })
      : buildConversationMessages({
          systemPrompt,
          contextPrompt: [buildQuestionPlannerPrompt({ mode: mode.startsWith('rag') ? 'rag' : mode, intent }), prompt].join('\n\n'),
          history,
          userPrompt: question,
        }),
    temperature: 0.2,
    maxTokens: 1024,
  }), 'chat request')

  await pipeModelStream({
    response,
    res,
    conversationId,
    assistantMessageId,
    meta: {
      paperTitle,
      citations,
      mode,
      retrievedChunks,
      imageEvidence,
    },
  })
}

const requestModelTest = async () => {
  const settings = readSettings()
  if (!settings.apiKey) {
    throw new Error('apiKey is not configured')
  }

  if (!settings.model) {
    throw new Error('model is not configured')
  }

  const payload = await postChatCompletion(settings, buildRequestBody({
    settings,
    systemPrompt: 'You are a connection test assistant. Reply with a very short confirmation only.',
    userPrompt: 'Reply with: MODEL_OK',
    temperature: 0,
    maxTokens: 32,
  }), 'model test request')
  const reply = String(parseModelReply(settings, payload) || '').trim() || '模型已返回空内容'

  return {
    ok: true,
    provider: settings.provider,
    model: settings.model,
    reply,
    payloadPreview: summarizePayload(payload),
  }
}

ensureSettings()
ensureConversationsStore()
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

  startImportTask(finalPath, taskResponse, { originalName })
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
  const stream = Boolean(req.body?.stream)
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : ''
  const history = Array.isArray(req.body?.history) ? req.body.history : []

  if (!question) {
    res.status(400).json({ error: 'question is required' })
    return
  }

  try {
    const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
    const document = buildDocument(targetArtifactDir)
    const normalizedConversationId = conversationId || `conv-${Date.now()}`
    appendConversationMessage({
      conversationId: normalizedConversationId,
      artifactDir: targetArtifactDir,
      paperTitle: document.paperTitle,
      title: resolveConversationTitle({ userText: question, paperTitle: document.paperTitle }),
      message: {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
        status: 'done',
      },
    })

    if (stream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()
      const assistantId = `msg-assistant-${Date.now()}`
      appendConversationMessage({
        conversationId: normalizedConversationId,
        artifactDir: targetArtifactDir,
        paperTitle: document.paperTitle,
        message: {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          status: 'streaming',
        },
      })
      await streamChatCompletion({
        question,
        page,
        anchorId,
        artifactDir: targetArtifactDir,
        useRag,
        topK,
        history,
        res,
        conversationId: normalizedConversationId,
        assistantMessageId: assistantId,
      })
      res.end()
      return
    }

    const result = await requestChatCompletion({ question, page, anchorId, artifactDir: targetArtifactDir, useRag, topK, history })
    appendConversationMessage({
      conversationId: normalizedConversationId,
      artifactDir: targetArtifactDir,
      paperTitle: result.paperTitle,
      message: {
        id: `msg-assistant-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        createdAt: new Date().toISOString(),
        status: 'done',
        citations: result.citations,
        mode: result.mode,
      },
    })
    res.json({ ...result, conversationId: normalizedConversationId })
  } catch (error) {
    if (stream && !res.headersSent) {
      res.status(500)
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    }

    if (stream) {
      writeJsonLine(res, { type: 'error', error: error instanceof Error ? error.message : 'chat failed' })
      res.end()
      return
    }

    res.status(500).json({ error: error instanceof Error ? error.message : 'chat failed' })
  }
})

app.post('/api/paper/summary', async (req, res) => {
  const artifactDir = typeof req.body?.artifactDir === 'string' ? req.body.artifactDir.trim() : ''
  const stream = Boolean(req.body?.stream)
  const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : ''
  const history = Array.isArray(req.body?.history) ? req.body.history : []
  const userPrompt = typeof req.body?.userPrompt === 'string' ? req.body.userPrompt.trim() : ''

  try {
    const targetArtifactDir = artifactDir && fs.existsSync(artifactDir) ? artifactDir : resolveActiveDocumentDir()
    const document = buildDocument(targetArtifactDir)
    const normalizedConversationId = conversationId || `conv-${Date.now()}`
    const summaryPrompt = userPrompt || `请总结论文《${document.paperTitle}》。整体结构按既定大纲输出，但每一节内部内容请根据论文实际证据灵活组织，不要默认固定三点贡献，也不要机械写成模块一模块二模块三。`
    appendConversationMessage({
      conversationId: normalizedConversationId,
      artifactDir: targetArtifactDir,
      paperTitle: document.paperTitle,
      title: resolveConversationTitle({ userText: summaryPrompt, paperTitle: document.paperTitle }),
      message: {
        id: `msg-user-${Date.now()}`,
        role: 'user',
        content: summaryPrompt,
        createdAt: new Date().toISOString(),
        status: 'done',
      },
    })

    if (stream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()
      const assistantId = `msg-assistant-${Date.now()}`
      appendConversationMessage({
        conversationId: normalizedConversationId,
        artifactDir: targetArtifactDir,
        paperTitle: document.paperTitle,
        message: {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          status: 'streaming',
        },
      })
      await streamPaperSummary({
        artifactDir: targetArtifactDir,
        history,
        userPrompt: summaryPrompt,
        res,
        conversationId: normalizedConversationId,
        assistantMessageId: assistantId,
      })
      res.end()
      return
    }

    const result = await requestPaperSummary({ artifactDir: targetArtifactDir, history, userPrompt: summaryPrompt })
    appendConversationMessage({
      conversationId: normalizedConversationId,
      artifactDir: targetArtifactDir,
      paperTitle: result.paperTitle,
      message: {
        id: `msg-assistant-${Date.now()}`,
        role: 'assistant',
        content: result.answer,
        createdAt: new Date().toISOString(),
        status: 'done',
        citations: result.citations,
      },
    })
    res.json({ ...result, conversationId: normalizedConversationId })
  } catch (error) {
    if (stream && !res.headersSent) {
      res.status(500)
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    }

    if (stream) {
      writeJsonLine(res, { type: 'error', error: error instanceof Error ? error.message : 'paper summary failed' })
      res.end()
      return
    }

    res.status(500).json({ error: error instanceof Error ? error.message : 'paper summary failed' })
  }
})

app.get('/api/conversations', (_req, res) => {
  const store = readConversationsStore()
  res.json(store.conversations.map(toConversationSummary))
})

app.post('/api/conversations', (req, res) => {
  const artifactDir = typeof req.body?.artifactDir === 'string' ? req.body.artifactDir.trim() : resolveActiveDocumentDir()
  const paperTitle = typeof req.body?.paperTitle === 'string' ? req.body.paperTitle.trim() : ''
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  const conversation = createConversationRecord({ artifactDir, paperTitle, title })
  const store = readConversationsStore()
  store.conversations.unshift(conversation)
  writeConversationsStore(store)
  res.json({ ...toConversationSummary(conversation), messages: conversation.messages })
})

app.get('/api/conversations/:conversationId', (req, res) => {
  const { conversation } = getConversationRecord(req.params.conversationId)
  if (!conversation) {
    res.status(404).json({ error: 'conversation not found' })
    return
  }
  res.json({ ...toConversationSummary(conversation), messages: conversation.messages })
})

app.post('/api/model/test', async (_req, res) => {
  try {
    const result = await requestModelTest()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'model test failed' })
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
