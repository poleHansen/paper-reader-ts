import type {
  ChatResponse,
  ConversationDetail,
  ConversationRequestMessage,
  ConversationSummary,
  CondaEnvironmentsResponse,
  DocumentPayload,
  LibraryDocument,
  ModelTestResponse,
  PaperSummaryResponse,
  ParseTask,
  RagIndexStatus,
  RagRetrieveResponse,
  RetryImportResponse,
  SelectLibraryResponse,
  SettingsState,
  StreamEvent,
  UploadImportResponse,
} from '../types'

const request = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })

  if (!response.ok) {
    let detail = ''

    try {
      const payload = await response.json() as { error?: unknown; message?: unknown }
      detail = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
          ? payload.message
          : ''
    } catch {
      try {
        detail = await response.text()
      } catch {
        detail = ''
      }
    }

    throw new Error(detail ? `Request failed: ${response.status} ${detail}` : `Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const fetchPaperDocument = async (): Promise<DocumentPayload> => {
  return request<DocumentPayload>('/api/document')
}

export const fetchLibraryDocuments = async (): Promise<LibraryDocument[]> => {
  return request<LibraryDocument[]>('/api/library')
}

export const selectLibraryDocument = async (artifactDir: string): Promise<SelectLibraryResponse> => {
  return request<SelectLibraryResponse>('/api/library/select', {
    method: 'POST',
    body: JSON.stringify({ artifactDir }),
  })
}

export const fetchTaskFeed = async (): Promise<ParseTask[]> => {
  return request<ParseTask[]>('/api/tasks')
}

export const subscribeTaskFeed = (onMessage: (tasks: ParseTask[]) => void): (() => void) => {
  const eventSource = new EventSource('/api/tasks/stream')

  eventSource.onmessage = (event) => {
    onMessage(JSON.parse(event.data) as ParseTask[])
  }

  eventSource.onerror = () => {
    eventSource.close()
  }

  return () => {
    eventSource.close()
  }
}

export const fetchSettings = async (): Promise<SettingsState> => {
  return request<SettingsState>('/api/settings')
}

export const saveSettings = async (settings: SettingsState): Promise<SettingsState> => {
  return request<SettingsState>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export const fetchCondaEnvironments = async (): Promise<CondaEnvironmentsResponse> => {
  return request<CondaEnvironmentsResponse>('/api/conda-envs')
}

export const createImportTask = async (filePath: string): Promise<ParseTask> => {
  return request<ParseTask>('/api/import', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  })
}

export const retryImportTask = async (filePath: string): Promise<RetryImportResponse> => {
  return request<RetryImportResponse>('/api/import/retry', {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  })
}

export const uploadAndImportPdf = async (file: File): Promise<UploadImportResponse> => {
  const formData = new FormData()
  formData.append('paper', file)

  const response = await fetch('/api/import-upload', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`)
  }

  return response.json() as Promise<UploadImportResponse>
}

export const createGithubSyncTask = async (payload: {
  imageDir?: string
  artifactDir?: string
}): Promise<ParseTask> => {
  return request<ParseTask>('/api/github-sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const askPaperQuestion = async (payload: {
  question: string
  page?: number
  anchorId?: string
  useRag?: boolean
  topK?: number
  artifactDir?: string
}): Promise<ChatResponse> => {
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

const streamRequest = async (
  input: string,
  payload: Record<string, unknown>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> => {
  const response = await fetch(input, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, stream: true }),
  })

  if (!response.ok || !response.body) {
    let detail = ''

    try {
      detail = await response.text()
    } catch {
      detail = ''
    }

    throw new Error(detail ? `Request failed: ${response.status} ${detail}` : `Request failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      const event = JSON.parse(trimmed) as StreamEvent
      onEvent(event)

      if (event.type === 'error') {
        throw new Error(event.error)
      }
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    const event = JSON.parse(trailing) as StreamEvent
    onEvent(event)

    if (event.type === 'error') {
      throw new Error(event.error)
    }
  }
}

export const streamPaperQuestion = async (payload: {
  question: string
  page?: number
  anchorId?: string
  useRag?: boolean
  topK?: number
  artifactDir?: string
  conversationId?: string
  history?: ConversationRequestMessage[]
}, onEvent: (event: StreamEvent) => void): Promise<void> => {
  return streamRequest('/api/chat', payload, onEvent)
}

export const summarizePaper = async (payload?: {
  artifactDir?: string
}): Promise<PaperSummaryResponse> => {
  return request<PaperSummaryResponse>('/api/paper/summary', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export const streamPaperSummary = async (payload: {
  artifactDir?: string
  conversationId?: string
  history?: ConversationRequestMessage[]
}, onEvent: (event: StreamEvent) => void): Promise<void> => {
  return streamRequest('/api/paper/summary', payload, onEvent)
}

export const fetchConversations = async (): Promise<ConversationSummary[]> => {
  return request<ConversationSummary[]>('/api/conversations')
}

export const fetchConversation = async (conversationId: string): Promise<ConversationDetail> => {
  return request<ConversationDetail>(`/api/conversations/${encodeURIComponent(conversationId)}`)
}

export const createConversation = async (payload?: {
  artifactDir?: string
  paperTitle?: string
  title?: string
}): Promise<ConversationDetail> => {
  return request<ConversationDetail>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export const fetchRagIndexStatus = async (artifactDir?: string): Promise<RagIndexStatus> => {
  const query = artifactDir ? `?artifactDir=${encodeURIComponent(artifactDir)}` : ''
  return request<RagIndexStatus>(`/api/rag/index-status${query}`)
}

export const buildRagIndex = async (payload?: {
  artifactDir?: string
  rebuild?: boolean
}): Promise<RagIndexStatus & { ok: boolean }> => {
  return request<RagIndexStatus & { ok: boolean }>('/api/rag/index', {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export const retrieveRagChunks = async (payload: {
  question: string
  artifactDir?: string
  topK?: number
}): Promise<RagRetrieveResponse> => {
  return request<RagRetrieveResponse>('/api/rag/retrieve', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const testModelConnection = async (): Promise<ModelTestResponse> => {
  return request<ModelTestResponse>('/api/model/test', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
