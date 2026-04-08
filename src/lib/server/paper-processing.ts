import { buildSectionChunks, type BuiltChunk } from '@/lib/server/paper-chunks';
import type { ExtractedPdfSection, ExtractedPdfText } from '@/lib/server/pdf-text';

export interface BuiltSection {
  paperId: string;
  sectionType: string;
  sectionKey: string;
  title: string;
  orderNo: number;
  content: string;
  tokenCount: number;
  pageStart?: number;
  pageEnd?: number;
}

export interface BuildPersistedPaperContentInput {
  paperId: string;
  title: string;
  abstract?: string | null;
  extractedPdf: ExtractedPdfText | null;
}

export interface PersistedPaperContent {
  sections: BuiltSection[];
  chunks: Array<Omit<BuiltChunk, 'sectionId'> & { sectionKey: string }>;
}

export function buildPersistedPaperContent({ paperId, title, abstract, extractedPdf }: BuildPersistedPaperContentInput): PersistedPaperContent {
  const sections: BuiltSection[] = [];
  let orderNo = 1;

  if (abstract?.trim()) {
    sections.push({
      paperId,
      sectionType: 'abstract_summary',
      sectionKey: 'abstract-summary',
      title: `${title} abstract`,
      orderNo,
      content: abstract.trim(),
      tokenCount: countTokens(abstract),
    });
    orderNo += 1;
  }

  if (extractedPdf?.previewText) {
    sections.push({
      paperId,
      sectionType: 'pdf_text_preview',
      sectionKey: 'pdf-text-preview',
      title: 'Extracted PDF text preview',
      orderNo,
      content: extractedPdf.previewText,
      tokenCount: countTokens(extractedPdf.previewText),
      pageStart: 1,
      pageEnd: extractedPdf.pageCount || undefined,
    });
    orderNo += 1;
  }

  const sectionCounts = new Map<string, number>();

  extractedPdf?.inferredSections.forEach((section) => {
    const count = (sectionCounts.get(section.sectionType) ?? 0) + 1;
    sectionCounts.set(section.sectionType, count);

    sections.push({
      paperId,
      sectionType: section.sectionType,
      sectionKey: buildSectionKey(section, count),
      title: section.title,
      orderNo,
      content: section.content,
      tokenCount: countTokens(section.content),
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
    });
    orderNo += 1;
  });

  if (sections.length === 0 && extractedPdf?.fullText) {
    sections.push({
      paperId,
      sectionType: 'full_text',
      sectionKey: 'full-text',
      title: 'Full text',
      orderNo,
      content: extractedPdf.fullText,
      tokenCount: countTokens(extractedPdf.fullText),
      pageStart: 1,
      pageEnd: extractedPdf.pageCount || undefined,
    });
  }

  const chunks: Array<Omit<BuiltChunk, 'sectionId'> & { sectionKey: string }> = [];
  let chunkIndex = 0;

  sections.forEach((section) => {
    const sectionChunks = buildSectionChunks({
      paperId,
      sectionId: null,
      sectionKey: section.sectionKey,
      sectionType: section.sectionType,
      content: section.content,
      startChunkIndex: chunkIndex,
    }).map(({ sectionId: _sectionId, ...chunk }) => ({
      ...chunk,
      sectionKey: section.sectionKey,
    }));

    chunks.push(...sectionChunks);
    chunkIndex += sectionChunks.length;
  });

  return {
    sections,
    chunks,
  };
}

function buildSectionKey(section: ExtractedPdfSection, count: number) {
  const slug = slugify(section.title);
  const suffix = count > 1 ? `-${count}` : '';
  return `${section.sectionType}-${slug || 'section'}${suffix}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function countTokens(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}
