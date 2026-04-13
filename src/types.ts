export type InlineText = {
  type: string
  content: string
}

export type Block = {
  type: string
  bbox?: number[]
  content: Record<string, unknown>
}

export type Page = Block[]

export type ParseTaskStatus =
  | 'failed'
  | 'ready'
  | 'starting-env'
  | 'parsing'
  | 'writing-artifacts'
  | 'uploading-images'
  | 'queued'

export type ParseTask = {
  id: string
  title: string
  detail: string
  status: ParseTaskStatus
  timestamp: string
  logs?: string[]
  paperId?: string
  inputPath?: string
  outputDir?: string
  error?: string
  kind?: 'task' | 'chat' | 'summary'
  citations?: string[]
}

export type ChatMessageRole = 'user' | 'assistant' | 'system'

export type ChatMessageStatus = 'streaming' | 'done' | 'error'

export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  createdAt: string
  status?: ChatMessageStatus
  citations?: string[]
  mode?: 'page' | 'rag'
  question?: string
  error?: string
  retrievedChunks?: RagChunkItem[]
  imageEvidence?: ImageEvidenceItem[]
}

export type ConversationSummary = {
  id: string
  title: string
  artifactDir: string
  paperTitle: string
  updatedAt: string
  messageCount: number
}

export type ConversationDetail = ConversationSummary & {
  messages: ChatMessage[]
}

export type FigureItem = {
  id: string
  page: number
  src: string
  caption: string
  remoteUrl?: string
}

export type ImageEvidenceItem = {
  id: string
  page: number
  caption: string
  src?: string
  remoteUrl?: string
}

export type AnchorItem = {
  id: string
  page: number
  text: string
  bbox: number[]
  type: string
}

export type AnchorBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type PageMeta = {
  page: number
  width: number
  height: number
}

export type DocumentPayload = {
  pages: Page[]
  outline: OutlineItem[]
  figures: FigureItem[]
  anchors: AnchorItem[]
  pageMetas: PageMeta[]
  assetBasePath: string
  paperTitle: string
  markdown: string
  pdfUrl: string
}

export type LibraryDocument = {
  id: string
  paperTitle: string
  artifactDir: string
  assetBasePath: string
  updatedAt: string
  source: 'bundled' | 'workspace-run'
  isActive: boolean
  status: 'ready' | 'processing' | 'failed'
  taskId?: string
  detail?: string
  inputPath?: string
}

export type OutlineItem = {
  id: string
  level: number
  title: string
  page: number
}

export type SettingsState = {
  provider: string
  model: string
  openaiApiMode: 'chat' | 'responses'
  apiBaseUrl: string
  apiKey: string
  githubRepo: string
  githubBranch: string
  condaEnv: string
  condaExePath: string
  pythonExePath: string
  mineruRoot: string
  outputRoot: string
  githubToken: string
  deviceMode: string
  executionMode: 'api-first' | 'cli-first'
  mineruModelSource: 'huggingface' | 'modelscope' | 'local'
  mineruConfigPath: string
  ragEnabled: boolean
  ragAutoBuild: boolean
  ragModelName: string
  ragModelPath: string
  ragTopK: number
  ragChunkSize: number
  ragChunkOverlap: number
  ragBatchSize: number
}

export type CondaEnvironmentItem = {
  name: string
  path: string
}

export type CondaEnvironmentsResponse = {
  condaExePath: string
  activeEnv: string
  envs: CondaEnvironmentItem[]
  error: string
}

export type UploadImportResponse = {
  filePath: string
  task: ParseTask
}

export type RetryImportResponse = {
  task: ParseTask
}

export type SelectLibraryResponse = {
  ok: boolean
  document: DocumentPayload
  library: LibraryDocument[]
}

export type ChatResponse = {
  answer: string
  paperTitle: string
  citations: string[]
  mode: 'page' | 'rag'
  retrievedChunks?: RagChunkItem[]
  imageEvidence?: ImageEvidenceItem[]
}

export type PaperSummaryResponse = {
  answer: string
  paperTitle: string
  citations: string[]
  sections: Array<{
    title: string
    coverage: 'good' | 'partial'
  }>
}

export type StreamMetaEvent = {
  type: 'meta'
  paperTitle?: string
  citations?: string[]
  mode?: 'page' | 'rag'
  retrievedChunks?: RagChunkItem[]
  imageEvidence?: ImageEvidenceItem[]
  sections?: Array<{
    title: string
    coverage: 'good' | 'partial'
  }>
}

export type StreamDeltaEvent = {
  type: 'delta'
  delta: string
  answer: string
  stage?: string
}

export type StreamDoneEvent = {
  type: 'done'
  answer: string
  paperTitle?: string
  citations?: string[]
  mode?: 'page' | 'rag'
  retrievedChunks?: RagChunkItem[]
  imageEvidence?: ImageEvidenceItem[]
  sections?: Array<{
    title: string
    coverage: 'good' | 'partial'
  }>
}

export type StreamErrorEvent = {
  type: 'error'
  error: string
}

export type StreamEvent = StreamMetaEvent | StreamDeltaEvent | StreamDoneEvent | StreamErrorEvent

export type ConversationRequestMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type RagChunkItem = {
  id: string
  text: string
  page: number
  pageStart?: number
  pageEnd?: number
  pages?: number[]
  sectionPath?: string
  bbox?: number[]
  blockTypes?: string[]
  score?: number
}

export type RagIndexStatus = {
  artifactDir: string
  ragDir: string
  indexed: boolean
  chunkCount: number
  builtAt: string
  model: string
  missingFiles: string[]
}

export type RagRetrieveResponse = {
  ok: boolean
  artifactDir: string
  ragDir: string
  chunks: RagChunkItem[]
  model: string
}

export type ModelTestResponse = {
  ok: boolean
  provider: string
  model: string
  reply: string
  payloadPreview?: string
}
