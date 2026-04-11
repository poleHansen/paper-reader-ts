import type { ChatResponse, CondaEnvironmentsResponse, DocumentPayload, ParseTask, SettingsState, UploadImportResponse } from '../types'

const request = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const fetchPaperDocument = async (): Promise<DocumentPayload> => {
  return request<DocumentPayload>('/api/document')
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

export const createGithubSyncTask = async (imageDir: string): Promise<ParseTask> => {
  return request<ParseTask>('/api/github-sync', {
    method: 'POST',
    body: JSON.stringify({ imageDir }),
  })
}

export const askPaperQuestion = async (payload: {
  question: string
  page: number
  anchorId: string
}): Promise<ChatResponse> => {
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
