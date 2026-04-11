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
  kind?: 'task' | 'chat'
  citations?: string[]
}

export type FigureItem = {
  id: string
  page: number
  src: string
  caption: string
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

export type ChatResponse = {
  answer: string
  paperTitle: string
  citations: string[]
}
