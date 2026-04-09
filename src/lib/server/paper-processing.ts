import { buildSectionChunks, type BuiltChunk } from '@/lib/server/paper-chunks';
import type { ExtractedPdfBlock, ExtractedPdfSection, ExtractedPdfText } from '@/lib/server/pdf-text';

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

export interface BuiltReference {
  paperId: string;
  rawText: string;
  title?: string;
  authorsJson?: string;
  year?: number;
  url?: string;
  arxivId?: string;
  orderNo: number;
}

export interface BuiltFigure {
  paperId: string;
  figureType: 'figure' | 'table';
  label?: string;
  caption?: string;
  contextBefore?: string;
  contextAfter?: string;
  pageNo?: number;
  orderNo: number;
}

export interface BuildPersistedPaperContentInput {
  paperId: string;
  extractedPdf: ExtractedPdfText | null;
}

export interface PersistedPaperContent {
  sections: BuiltSection[];
  chunks: Array<Omit<BuiltChunk, 'sectionId'> & { sectionKey: string }>;
  references: BuiltReference[];
  figures: BuiltFigure[];
}

export function buildPersistedPaperContent({ paperId, extractedPdf }: BuildPersistedPaperContentInput): PersistedPaperContent {
  const sections: BuiltSection[] = [];
  let orderNo = 1;

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

  const references = buildReferences(paperId, extractedPdf);
  const figures = buildFigures(paperId, extractedPdf);

  return {
    sections,
    chunks,
    references,
    figures,
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

function buildReferences(paperId: string, extractedPdf: ExtractedPdfText | null): BuiltReference[] {
  const referenceContent = getReferencesContent(extractedPdf);

  if (!referenceContent) {
    return [];
  }

  return splitReferenceEntries(referenceContent)
    .slice(0, 100)
    .map((rawText, index) => {
      const normalized = rawText.replace(/\s+/g, ' ').trim();
      const title = extractReferenceTitle(normalized);
      const authors = extractReferenceAuthors(normalized);
      const year = extractReferenceYear(normalized);
      const url = extractReferenceUrl(normalized);
      const arxivId = extractArxivId(normalized);

      return {
        paperId,
        rawText: normalized,
        title,
        authorsJson: authors.length > 0 ? JSON.stringify(authors) : undefined,
        year,
        url,
        arxivId,
        orderNo: index + 1,
      } satisfies BuiltReference;
    });
}

function getReferencesContent(extractedPdf: ExtractedPdfText | null) {
  const referencesSection = extractedPdf?.inferredSections.find((section) => section.sectionType === 'references');
  if (referencesSection?.content) {
    return referencesSection.content;
  }

  const blocks = extractedPdf?.pages.flatMap((page) => page.blocks) ?? [];
  const referencesIndex = blocks.findIndex((block) => /^references$/im.test(block.text.trim()));

  if (referencesIndex < 0) {
    return '';
  }

  return blocks
    .slice(referencesIndex + 1)
    .map((block) => block.text)
    .join('\n\n')
    .trim();
}

function splitReferenceEntries(content: string) {
  const normalized = content
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    return [] as string[];
  }

  const numberedMatches = [...normalized.matchAll(/(?:^|\n)(?:\[(\d+)\]|(\d+)\.|(\d+)\))\s+/gm)];

  if (numberedMatches.length >= 2) {
    return numberedMatches
      .map((match, index) => {
        const start = match.index ?? 0;
        const end = numberedMatches[index + 1]?.index ?? normalized.length;
        return normalized.slice(start, end).replace(/^(?:\[(\d+)\]|(\d+)\.|(\d+)\))\s+/, '').trim();
      })
      .filter((item) => item.length >= 20);
  }

  return normalized
    .split(/\n\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20);
}

function extractReferenceTitle(value: string) {
  const quoted = value.match(/[“"]([^”"]{8,300})[”"]/);

  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const parts = value.split(/\.\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1].slice(0, 300) : undefined;
}

function extractReferenceAuthors(value: string) {
  const beforeYear = value.split(/\((?:19|20)\d{2}\)|(?:19|20)\d{2}/)[0]?.trim();

  if (!beforeYear) {
    return [] as string[];
  }

  return beforeYear
    .split(/,|\band\b|;/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 80)
    .slice(0, 12);
}

function extractReferenceYear(value: string) {
  const match = value.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function extractReferenceUrl(value: string) {
  const match = value.match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[).,;]+$/, '') : undefined;
}

function extractArxivId(value: string) {
  const match = value.match(/arXiv\s*:?\s*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  return match?.[1];
}

function buildFigures(paperId: string, extractedPdf: ExtractedPdfText | null): BuiltFigure[] {
  if (!extractedPdf) {
    return [];
  }

  const blockEntries = buildFiguresFromBlocks(paperId, extractedPdf.pages.flatMap((page) => page.blocks));
  if (blockEntries.length > 0) {
    return dedupeFigures(blockEntries)
      .slice(0, 30)
      .map((figure, index) => ({
        ...figure,
        orderNo: index + 1,
      }));
  }

  const entries = extractedPdf.inferredSections.flatMap((section) => {
    const paragraphs = section.content
      .split(/\n\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    return paragraphs.flatMap((paragraph, index) => {
      const match = paragraph.match(/^((?:Figure|Fig\.)\s*\d+[A-Za-z0-9.-]*|Table\s*\d+[A-Za-z0-9.-]*)[:.\-–—]?\s+([\s\S]{10,400})$/im);

      if (!match) {
        return [] as Array<Omit<BuiltFigure, 'orderNo'>>;
      }

      const label = match[1]?.replace(/\s+/g, ' ').trim();
      const caption = match[2]?.replace(/\s+/g, ' ').trim();
      const figureType = /^table/i.test(label ?? '') ? 'table' : 'figure';
      const contextBefore = paragraphs[index - 1]?.replace(/\s+/g, ' ').trim();
      const contextAfter = paragraphs[index + 1]?.replace(/\s+/g, ' ').trim();

      return [
        {
          paperId,
          figureType,
          label,
          caption,
          contextBefore,
          contextAfter,
          pageNo: section.pageStart,
        } satisfies Omit<BuiltFigure, 'orderNo'>,
      ];
    });
  });

  return dedupeFigures(entries)
    .slice(0, 30)
    .map((figure, index) => ({
      ...figure,
      orderNo: index + 1,
    }));
}

function buildFiguresFromBlocks(paperId: string, blocks: ExtractedPdfBlock[]) {
  const directCaptionMatches: Array<Omit<BuiltFigure, 'orderNo'>> = blocks.flatMap((block, index) => {
    const captionMatch = matchCaptionBlock(block.text);

    if (!captionMatch) {
      return [] as Array<Omit<BuiltFigure, 'orderNo'>>;
    }

    return [
      {
        paperId,
        figureType: captionMatch.figureType,
        label: captionMatch.label,
        caption: captionMatch.caption,
        contextBefore: blocks[index - 1]?.text.replace(/\s+/g, ' ').trim(),
        contextAfter: blocks[index + 1]?.text.replace(/\s+/g, ' ').trim(),
        pageNo: block.page,
      } satisfies Omit<BuiltFigure, 'orderNo'>,
    ];
  });

  const graphicAnchoredMatches: Array<Omit<BuiltFigure, 'orderNo'>> = blocks.flatMap((block, index) => {
    if (!block.hasGraphic) {
      return [] as Array<Omit<BuiltFigure, 'orderNo'>>;
    }

    const captionSource = blocks
      .filter((candidate) => candidate.page === block.page && !candidate.hasGraphic)
      .filter((candidate) => isNearbyCaptionBlock(block, candidate))
      .sort((left, right) => scoreCaptionDistance(block, left) - scoreCaptionDistance(block, right))[0];

    const captionMatch = captionSource ? matchCaptionBlock(buildCaptionText(blocks, captionSource)) : null;

    if (!captionMatch) {
      return [] as Array<Omit<BuiltFigure, 'orderNo'>>;
    }

    return [
      {
        paperId,
        figureType: captionMatch.figureType,
        label: captionMatch.label,
        caption: captionMatch.caption,
        contextBefore: blocks[index - 1]?.text.replace(/\s+/g, ' ').trim(),
        contextAfter: blocks[index + 1]?.text.replace(/\s+/g, ' ').trim(),
        pageNo: block.page,
      } satisfies Omit<BuiltFigure, 'orderNo'>,
    ];
  });

  return [...directCaptionMatches, ...graphicAnchoredMatches];
}

function matchCaptionBlock(text: string) {
  const normalized = text
    .replace(/-\s*\n\s*/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/^((?:Figure|Fig\.)\s*\d+[A-Za-z0-9.-]*|Table\s*\d+[A-Za-z0-9.-]*)[:.\-–—]?\s+([\s\S]{10,400})$/i);

  if (!match) {
    return null;
  }

  const label = match[1]?.replace(/\s+/g, ' ').trim();
  const caption = match[2]?.replace(/\s+/g, ' ').trim();
  const figureType: BuiltFigure['figureType'] = /^table/i.test(label ?? '') ? 'table' : 'figure';

  return {
    label,
    caption,
    figureType,
  };
}

function isNearbyCaptionBlock(graphicBlock: ExtractedPdfBlock, candidate: ExtractedPdfBlock) {
  if (candidate.hasGraphic) {
    return false;
  }

  const normalizedText = candidate.text.replace(/-\s*\n\s*/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const captionMatch = matchCaptionBlock(normalizedText);
  if (!captionMatch) {
    return false;
  }

  const verticallyClose = Math.abs(graphicBlock.bbox.bottom - candidate.bbox.top) <= 64 || Math.abs(candidate.bbox.bottom - graphicBlock.bbox.top) <= 64;
  const horizontalOverlap = !(graphicBlock.bbox.right < candidate.bbox.left || candidate.bbox.right < graphicBlock.bbox.left);

  return verticallyClose && horizontalOverlap;
}

function scoreCaptionDistance(graphicBlock: ExtractedPdfBlock, candidate: ExtractedPdfBlock) {
  const verticalGap = Math.min(
    Math.abs(graphicBlock.bbox.bottom - candidate.bbox.top),
    Math.abs(candidate.bbox.bottom - graphicBlock.bbox.top),
  );
  const horizontalPenalty = graphicBlock.bbox.right < candidate.bbox.left || candidate.bbox.right < graphicBlock.bbox.left ? 1000 : 0;

  return verticalGap + horizontalPenalty;
}

function buildCaptionText(blocks: ExtractedPdfBlock[], captionStart: ExtractedPdfBlock) {
  const samePageBlocks = blocks.filter((block) => block.page === captionStart.page);
  const startIndex = samePageBlocks.findIndex((block) => block.id === captionStart.id);
  const parts = [captionStart.text.trim()];

  for (let offset = 1; offset <= 2; offset += 1) {
    const next = samePageBlocks[startIndex + offset];
    if (!next || next.hasGraphic) {
      break;
    }

    const normalized = next.text.replace(/\s+/g, ' ').trim();
    if (!normalized || /^(?:\d+(?:\.\d+)*[.)]?\s+[A-Z]|Abstract|Introduction|Related Work|Method|Experiments|Results|Discussion|Conclusion|References)\b/i.test(normalized)) {
      break;
    }

    if (/^(?:Figure|Fig\.?|Table)\s*\d+/i.test(normalized)) {
      break;
    }

    parts.push(normalized);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function dedupeFigures(figures: Array<Omit<BuiltFigure, 'orderNo'>>) {
  const seen = new Set<string>();

  return figures.filter((figure) => {
    const key = `${figure.figureType}:${figure.label ?? ''}:${figure.caption ?? ''}`.toLowerCase();

    if (!figure.caption || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
