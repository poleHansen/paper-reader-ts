import { XMLParser } from 'fast-xml-parser';
import type { SearchQuery } from '@/lib/schemas/search';

interface ArxivApiEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: Array<{ name?: string }> | { name?: string };
}

interface ArxivApiFeed {
  feed?: {
    entry?: ArxivApiEntry[] | ArxivApiEntry;
  };
}

export interface ArxivSearchItem {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  year?: number;
  source: 'arXiv';
  sourcePlatform: 'arxiv';
  sourceUrl: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export async function searchArxiv(query: SearchQuery): Promise<ArxivSearchItem[]> {
  const searchQuery = encodeURIComponent(query.query);
  const sortBy = query.sort === 'latest' ? 'submittedDate' : 'relevance';
  const sortOrder = 'descending';
  const url = `https://export.arxiv.org/api/query?search_query=all:${searchQuery}&start=0&max_results=10&sortBy=${sortBy}&sortOrder=${sortOrder}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`arXiv request failed with status ${response.status}`);
  }

  const xml = await response.text();
  const data = parser.parse(xml) as ArxivApiFeed;
  const entries = normalizeEntries(data.feed?.entry);

  return entries
    .map((entry) => toSearchItem(entry))
    .filter((item): item is ArxivSearchItem => item !== null);
}

function normalizeEntries(entry?: ArxivApiEntry | ArxivApiEntry[]): ArxivApiEntry[] {
  if (!entry) {
    return [];
  }

  return Array.isArray(entry) ? entry : [entry];
}

function toSearchItem(entry: ArxivApiEntry): ArxivSearchItem | null {
  const rawId = entry.id?.trim();
  const title = normalizeWhitespace(entry.title);
  const abstract = normalizeWhitespace(entry.summary);

  if (!rawId || !title || !abstract) {
    return null;
  }

  const id = rawId.split('/').pop() ?? rawId;
  const authors = normalizeAuthors(entry.author);
  const publishedYear = entry.published ? new Date(entry.published).getUTCFullYear() : undefined;

  return {
    id,
    title,
    abstract,
    authors,
    year: typeof publishedYear === 'number' && Number.isFinite(publishedYear) ? publishedYear : undefined,
    source: 'arXiv',
    sourcePlatform: 'arxiv',
    sourceUrl: rawId,
  };
}

function normalizeAuthors(author: ArxivApiEntry['author']): string[] {
  if (!author) {
    return [];
  }

  const authors = Array.isArray(author) ? author : [author];
  return authors
    .map((item) => normalizeWhitespace(item.name))
    .filter((name): name is string => Boolean(name));
}

function normalizeWhitespace(value?: string): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}
