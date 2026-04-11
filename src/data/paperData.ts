import documentPages from '../../工业缺陷零样本分割2026/auto/工业缺陷零样本分割2026_content_list_v2.json'
import type { FigureItem, OutlineItem, Page, ParseTask } from '../types'

const rawPages = documentPages as unknown as Page[]

const textFromItems = (items: unknown): string => {
  if (!Array.isArray(items)) {
    return ''
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return ''
      }
      const value = (item as { content?: unknown }).content
      return typeof value === 'string' ? value : ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const pages = rawPages

export const outline: OutlineItem[] = rawPages.flatMap((page, pageIndex) =>
  page
    .filter((block) => block.type === 'title')
    .map((block, index) => {
      const content = block.content as {
        title_content?: unknown
        level?: number
      }

      return {
        id: `outline-${pageIndex}-${index}`,
        level: content.level ?? 1,
        title: textFromItems(content.title_content),
        page: pageIndex + 1,
      }
    }),
)

export const figures: FigureItem[] = rawPages.flatMap((page, pageIndex) =>
  page
    .filter((block) => block.type === 'image')
    .map((block, index) => {
      const content = block.content as {
        image_source?: { path?: string }
        image_caption?: unknown
      }

      return {
        id: `figure-${pageIndex}-${index}`,
        page: pageIndex + 1,
        src: `/工业缺陷零样本分割2026/auto/${content.image_source?.path ?? ''}`,
        caption: textFromItems(content.image_caption),
      }
    }),
)

export const taskFeed: ParseTask[] = [
  {
    id: 'task-1',
    title: 'Conda 环境就绪',
    detail: '已连接 daling-test，准备复用本地 GPU 与 MinerU pipeline。',
    status: 'starting-env',
    timestamp: '10:14',
  },
  {
    id: 'task-2',
    title: '解析完成',
    detail: '已生成 markdown、content_list_v2、middle.json、model.json 和图片目录。',
    status: 'ready',
    timestamp: '10:16',
  },
  {
    id: 'task-3',
    title: 'GitHub 同步待接入',
    detail: '当前界面先读取本地产物，下一步接 GitHub 图片双写与远程 URL manifest。',
    status: 'queued',
    timestamp: '10:17',
  },
]

export const summaryCards = [
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
    value: String(rawPages.length).padStart(2, '0'),
  },
]
