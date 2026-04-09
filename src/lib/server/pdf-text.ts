import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

export interface ExtractedPdfSection {
  title: string;
  sectionType: string;
  content: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface ExtractedPdfBlockLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: 'text' | 'graphic';
}

export interface ExtractedPdfBlock {
  id: string;
  page: number;
  text: string;
  bbox: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
  hasGraphic?: boolean;
  graphicTypes?: string[];
  lines: ExtractedPdfBlockLine[];
}

export interface ExtractedPdfPage {
  page: number;
  width: number;
  height: number;
  blocks: ExtractedPdfBlock[];
}

export interface ExtractedPdfText {
  fullText: string;
  previewText: string;
  pageLikeSegments: string[];
  inferredSections: ExtractedPdfSection[];
  pageCount: number;
  pages: ExtractedPdfPage[];
}

const SECTION_PATTERNS = [
  { title: 'Abstract', sectionType: 'abstract', pattern: /^abstract$/i },
  { title: 'Introduction', sectionType: 'introduction', pattern: /^(introduction|overview)$/i },
  { title: 'Related Work', sectionType: 'related_work', pattern: /^(related work|background|prior work|literature review)$/i },
  { title: 'Method', sectionType: 'method', pattern: /^(method|approach|methodology|proposed method|framework|model|system|pipeline)$/i },
  { title: 'Experiments', sectionType: 'experiments', pattern: /^(experiment|experiments|experimental setup|evaluation|results|analysis|implementation details)$/i },
  { title: 'Discussion', sectionType: 'discussion', pattern: /^discussion$/i },
  { title: 'Conclusion', sectionType: 'conclusion', pattern: /^(conclusion|conclusions|limitations|future work)$/i },
  { title: 'Acknowledgements', sectionType: 'acknowledgements', pattern: /^(acknowledgements|acknowledgments)$/i },
  { title: 'References', sectionType: 'references', pattern: /^(references|bibliography)$/i },
  { title: 'Appendix', sectionType: 'appendix', pattern: /^(appendix|appendices|supplementary material|supplemental material)$/i },
] as const;

const MAX_SECTION_LENGTH = 20000;
const PREVIEW_LENGTH = 12000;
const MAX_PAGE_SEGMENTS = 12;
const execFileAsync = promisify(execFile);

const DISALLOWED_CONTROL_CHARACTERS = new Set(
  Array.from({ length: 32 }, (_, codePoint) => codePoint)
    .filter((codePoint) => codePoint !== 9 && codePoint !== 10 && codePoint !== 13)
    .map((codePoint) => String.fromCharCode(codePoint)),
);

const SECTION_HEADING_PREFIX = /^\d+(?:\.\d+)*[.)]?\s*/;

export async function extractPdfText(filePath: string): Promise<ExtractedPdfText> {
  const parsed = await extractWithPdfScript(filePath);
  const normalizedText = normalizePdfText(parsed.text);
  const pages = normalizePages(parsed.pages ?? []);
  const paragraphs = splitIntoParagraphs(normalizedText);
  const inferredSections = inferSections(paragraphs, parsed.total || 0, pages);
  const pageLikeSegments = splitIntoSegments(inferredSections, paragraphs);

  return {
    fullText: normalizedText,
    previewText: normalizedText.slice(0, PREVIEW_LENGTH),
    pageLikeSegments,
    inferredSections,
    pageCount: parsed.total || 0,
    pages,
  };
}

async function extractWithPdfScript(filePath: string) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'extract-pdf-text.mjs');
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, filePath], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  });

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  try {
    return JSON.parse(stdout) as { text: string; total?: number; pages?: ExtractedPdfPage[] };
  } catch (error) {
    throw new Error(`Failed to parse PDF extraction output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizePages(pages: ExtractedPdfPage[]) {
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks
      .map((block) => ({
        ...block,
        text: normalizePdfText(block.text),
        lines: block.lines
          .map((line) => ({
            ...line,
            text: normalizeLine(line.text),
          }))
          .filter((line) => line.kind === 'graphic' || Boolean(line.text)),
      }))
      .filter((block) => {
        if (block.hasGraphic) {
          return true;
        }

        return block.text && !isLikelyPageArtifact(block.text) && !isLikelyRunningHeader(block.text);
      }),
  }));
}

function normalizePdfText(value: string) {
  const cleaned = value
    .replace(/\r/g, '\n')
    .split('')
    .filter((character) => !DISALLOWED_CONTROL_CHARACTERS.has(character))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter((line) => !isLikelyPageArtifact(line))
    .filter((line) => !isLikelyRunningHeader(line))
    .filter((line, index, lines) => {
      if (!line) {
        return false;
      }

      const previous = lines[index - 1];
      return !(previous && previous === line && isLikelyRunningHeader(line));
    })
    .join('\n')
    .trim();
}

function splitIntoParagraphs(text: string) {
  if (!text) {
    return [];
  }

  return text
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitIntoSegments(sections: ExtractedPdfSection[], paragraphs: string[]) {
  const sectionSegments = sections
    .filter((section) => section.sectionType !== 'references')
    .map((section) => section.content)
    .filter(Boolean);

  if (sectionSegments.length > 0) {
    return sectionSegments.slice(0, MAX_PAGE_SEGMENTS);
  }

  const segments: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const nextChunk = current ? `${current}\n\n${paragraph}` : paragraph;

    if (nextChunk.length > 2200 && current) {
      segments.push(current);
      current = paragraph;
    } else {
      current = nextChunk;
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments.slice(0, MAX_PAGE_SEGMENTS);
}

function inferSections(paragraphs: string[], pageCount: number, pages: ExtractedPdfPage[]) {
  if (paragraphs.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const blockSections = inferSectionsFromBlocks(pages, pageCount);
  if (blockSections.length > 0) {
    return blockSections;
  }

  const structuredSections = inferSectionsFromLines(paragraphs, pageCount);
  if (structuredSections.length > 0) {
    return structuredSections;
  }

  const headingMatches = paragraphs
    .map((paragraph, index) => ({
      index,
      heading: extractHeading(paragraph),
    }))
    .filter((item): item is { index: number; heading: { title: string; sectionType: string } } => Boolean(item.heading));

  if (headingMatches.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const sections: ExtractedPdfSection[] = headingMatches
    .map((match, index) => {
      const start = match.index + 1;
      const end = (headingMatches[index + 1]?.index ?? paragraphs.length) - 1;
      const content = paragraphs.slice(start, end + 1).join('\n\n').trim();

      if (content.length < 120) {
        return null;
      }

      return {
        title: match.heading.title,
        sectionType: match.heading.sectionType,
        content: content.slice(0, MAX_SECTION_LENGTH),
      } satisfies ExtractedPdfSection;
    })
    .filter(isExtractedPdfSection);

  if (sections.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  return attachEstimatedPages(sections, pageCount);
}

function inferSectionsFromBlocks(pages: ExtractedPdfPage[], pageCount: number) {
  const orderedBlocks = pages
    .flatMap((page) => page.blocks.map((block) => ({ ...block, page: page.page, pageWidth: page.width, pageHeight: page.height })))
    .filter((block) => block.text)
    .filter((block) => !isLikelyIsolatedNumericBlock(block))
    .filter((block, index, blocks) => !isLikelyFigureAdjacentNoise(block, index, blocks))
    .filter((block) => !isLikelyCaptionOrFooter(block.text))
    .filter((block) => !isLikelyTabularLine(block.text));

  if (orderedBlocks.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const headings = orderedBlocks
    .flatMap((block, index) => detectHeadingsInBlock(block, index, orderedBlocks[index + 1], orderedBlocks[index - 1]))
    .filter((item): item is { index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } } => Boolean(item));

  if (headings.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const prioritizedHeadings = prioritizeHeadings(headings.map(({ index, heading }) => ({ index, heading })));
  if (prioritizedHeadings.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const sections: ExtractedPdfSection[] = [];

  for (const [index, match] of prioritizedHeadings.entries()) {
    const start = match.index + 1;
    const end = (prioritizedHeadings[index + 1]?.index ?? orderedBlocks.length) - 1;
    const contentBlocks = orderedBlocks
      .slice(start, end + 1)
      .filter((block) => !isLikelyIsolatedNumericBlock(block))
      .filter((block, blockIndex, blocks) => !isLikelyFigureAdjacentNoise(block, blockIndex, blocks));
    const content = joinSectionContent(contentBlocks.map((block) => block.text));

    if (content.length < 120) {
      continue;
    }

    sections.push({
      title: match.heading.title,
      sectionType: match.heading.sectionType,
      content: content.slice(0, MAX_SECTION_LENGTH),
      pageStart: contentBlocks[0]?.page ?? orderedBlocks[match.index]?.page,
      pageEnd: contentBlocks[contentBlocks.length - 1]?.page ?? orderedBlocks[match.index]?.page,
    });
  }

  const dedupedSections: ExtractedPdfSection[] = dedupeAdjacentSections(sections);

  return dedupedSections.length > 0 ? dedupedSections : attachEstimatedPages([], pageCount);
}

function detectHeadingsInBlock(
  block: ExtractedPdfBlock & { pageWidth?: number; pageHeight?: number },
  index: number,
  nextBlock?: ExtractedPdfBlock,
  previousBlock?: ExtractedPdfBlock,
) {
  const compactBlock = isCompactHeadingBlock(block);
  const candidateLines = compactBlock
    ? [normalizeLine(block.lines[0]?.text ?? block.text.split('\n')[0] ?? '')]
    : block.lines.slice(0, 8).map((line) => normalizeLine(line.text));

  return candidateLines.flatMap((candidate, lineIndex) => {
    if (!candidate || candidate.length > 160) {
      return [] as Array<{ index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } }>;
    }

    if (looksLikeAuthorLine(candidate) || isLikelyPageArtifact(candidate) || isLikelyCaptionOrFooter(candidate) || looksLikeFormulaOrTabularNoise(candidate) || isCompactSymbolicHeading(candidate)) {
      return [] as Array<{ index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } }>;
    }

    if (lineIndex > 0 && !isCompactHeadingBlock(block)) {
      const previousLine = block.lines[lineIndex - 1]?.text;
      if (previousLine && looksLikeBodyText(previousLine)) {
        return [] as Array<{ index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } }>;
      }
    }

    if (lineIndex === 0 && previousBlock && looksLikeBodyText(previousBlock.text.split('\n').at(-1) ?? previousBlock.text)) {
      return [] as Array<{ index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } }>;
    }

    const classified = classifySectionHeading(candidate.replace(/[:.\-–—]+$/, '').trim());
    if (classified) {
      return [{ index, block, heading: classified }];
    }

    if (!looksLikeHeading(candidate) || !isHeadingScaleCandidate(candidate, block)) {
      return [] as Array<{ index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } }>;
    }

    if (lineIndex === 0 && nextBlock && !looksLikeBodyText(nextBlock.text.split('\n')[0] ?? nextBlock.text)) {
      return [] as Array<{ index: number; block: ExtractedPdfBlock; heading: { title: string; sectionType: string } }>;
    }

    return [{
      index,
      block,
      heading: {
        title: stripHeadingNumber(candidate),
        sectionType: 'section',
      },
    }];
  });
}

function isCompactHeadingBlock(block: ExtractedPdfBlock & { pageWidth?: number; pageHeight?: number }) {
  const widthRatio = block.pageWidth ? block.bbox.width / block.pageWidth : 1;
  const heightRatio = block.pageHeight ? block.bbox.height / block.pageHeight : 1;
  return block.lines.length <= 4 && widthRatio <= 0.75 && heightRatio <= 0.12;
}

function isHeadingScaleCandidate(value: string, block: ExtractedPdfBlock & { pageWidth?: number; pageHeight?: number }) {
  if (looksLikeStructuredNoise(value) || looksLikeFormulaOrTabularNoise(value) || isCompactSymbolicHeading(value)) {
    return false;
  }

  const widthRatio = block.pageWidth ? block.bbox.width / block.pageWidth : 0;
  const heightRatio = block.pageHeight ? block.bbox.height / block.pageHeight : 0;

  if (block.lines.length > 12 || heightRatio > 0.22) {
    return false;
  }

  if (block.lines.length > 4 && widthRatio > 0.8) {
    return false;
  }

  return true;
}

function isCompactSymbolicHeading(value: string) {
  const compact = value.replace(/\s+/g, '');

  if (compact.length === 0 || compact.length > 18) {
    return false;
  }

  if (!/[A-Za-zΑ-Ωα-ω]/u.test(compact)) {
    return false;
  }

  return /[×÷=+\-/*Φφ]/u.test(compact);
}

function looksLikeFormulaOrTabularNoise(value: string) {
  if (!value) {
    return false;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  const numericRatio = tokens.filter((token) => /\d/.test(token)).length / tokens.length;
  const symbolRatio = tokens.filter((token) => /[=<>±×÷+/%]/.test(token)).length / tokens.length;
  const shortRatio = tokens.filter((token) => token.length <= 3).length / tokens.length;
  const mixedTokenRatio = tokens.filter((token) => /(?=.*[A-Za-z])(?=.*\d)|(?=.*\d)(?=.*[A-Za-z])/.test(token)).length / tokens.length;

  if (numericRatio >= 0.35 && symbolRatio >= 0.15) {
    return true;
  }

  if (shortRatio >= 0.7 && symbolRatio >= 0.15) {
    return true;
  }

  if (mixedTokenRatio >= 0.25) {
    return true;
  }

  return /^(?:top-?1|top-?5|acc|f1|auroc|precision|recall|map|fps|latency|flip)\b/i.test(value) && /\d/.test(value);
}

function inferSectionsFromLines(paragraphs: string[], pageCount: number) {
  const lines = paragraphs
    .flatMap((paragraph) => paragraph.split('\n'))
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .filter((line) => !isLikelyIsolatedNumericLine(line))
    .filter((line) => !isLikelyCaptionOrFooter(line))
    .filter((line) => !isLikelyTabularLine(line));

  if (lines.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const headings = lines
    .map((line, index) => {
      const heading = detectHeadingLine(line, lines[index + 1], lines[index - 1]);
      return heading ? { index, heading } : null;
    })
    .filter((item): item is { index: number; heading: { title: string; sectionType: string } } => Boolean(item));

  if (headings.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const prioritizedHeadings = prioritizeHeadings(headings);
  if (prioritizedHeadings.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const sections: ExtractedPdfSection[] = prioritizedHeadings
    .map((match, index) => {
      const start = match.index + 1;
      const end = (prioritizedHeadings[index + 1]?.index ?? lines.length) - 1;
      const content = joinSectionContent(lines.slice(start, end + 1));

      if (content.length < 120) {
        return null;
      }

      return {
        title: match.heading.title,
        sectionType: match.heading.sectionType,
        content: content.slice(0, MAX_SECTION_LENGTH),
      } satisfies ExtractedPdfSection;
    })
    .filter(isExtractedPdfSection);

  return attachEstimatedPages(dedupeAdjacentSections(sections), pageCount);
}

function detectHeadingLine(line: string, nextLine?: string, previousLine?: string) {
  const normalizedHeading = line.replace(/[:.\-–—]+$/, '').trim();

  if (!normalizedHeading || isLikelyPageArtifact(normalizedHeading)) {
    return null;
  }

  if (looksLikeAuthorLine(normalizedHeading)) {
    return null;
  }

  if (previousLine && !isLikelyRunningHeader(previousLine) && looksLikeBodyText(previousLine)) {
    return null;
  }

  const classified = classifySectionHeading(normalizedHeading);
  if (classified) {
    return classified;
  }

  if (!looksLikeHeading(normalizedHeading)) {
    return null;
  }

  if (nextLine && !looksLikeBodyText(nextLine)) {
    return null;
  }

  return {
    title: stripHeadingNumber(normalizedHeading),
    sectionType: 'section',
  };
}

function prioritizeHeadings(headings: Array<{ index: number; heading: { title: string; sectionType: string } }>) {
  const filtered = headings.filter(({ heading }, position) => {
    if (heading.sectionType === 'references') {
      return true;
    }

    const title = heading.title.trim();
    if (!title) {
      return false;
    }

    if (heading.sectionType !== 'section') {
      return true;
    }

    if (position <= 12) {
      return true;
    }

    const previous = headings[position - 1];
    const next = headings[position + 1];
    const nearbyStructuredHeading = [previous, next].some((candidate) => {
      if (!candidate) {
        return false;
      }

      return candidate.heading.sectionType !== 'section' || isNumberedHeading(candidate.heading.title);
    });

    return (
      isNumberedHeading(title)
      || looksLikeGenericAcademicHeading(title)
      || nearbyStructuredHeading
      || /^[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9-]*){0,7}$/.test(title)
      || title.split(/\s+/).length <= 7
    );
  });

  const referencesIndex = filtered.findIndex((item) => item.heading.sectionType === 'references');
  if (referencesIndex >= 0) {
    return filtered.slice(0, referencesIndex + 1);
  }

  return filtered;
}

function classifySectionHeading(value: string) {
  const normalized = stripHeadingNumber(value).toLowerCase();
  const definition = SECTION_PATTERNS.find((item) => item.pattern.test(normalized));

  if (!definition) {
    return null;
  }

  return {
    title: stripHeadingNumber(value, definition.title),
    sectionType: definition.sectionType,
  };
}

function isNumberedHeading(value: string) {
  return /^\d+(?:\.\d+)*[.)]?\s+/.test(value);
}

function looksLikeGenericAcademicHeading(value: string) {
  const normalized = stripHeadingNumber(value).toLowerCase();
  if (normalized.length < 3 || normalized.length > 80) {
    return false;
  }

  if (looksLikeStructuredNoise(normalized)) {
    return false;
  }

  return /\b(?:overview|task definition|dataset split|implementation details|evaluation metrics|main results|results breakdown|generalization|broader impact|conclusion|contents|comparison|data collection process|input modalities|model|method|results|discussion)\b/i.test(normalized);
}

function extractHeading(paragraph: string) {
  const lines = paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headingCandidate = lines[0]?.replace(/\s+/g, ' ').trim();

  if (!headingCandidate || lines.length > 6 || headingCandidate.length > 160) {
    return null;
  }

  const normalizedHeading = headingCandidate.replace(/[:.\-–—]+$/, '').trim();
  const classified = classifySectionHeading(normalizedHeading);

  if (classified) {
    return classified;
  }

  if (!looksLikeHeading(normalizedHeading)) {
    return null;
  }

  return {
    title: stripHeadingNumber(normalizedHeading),
    sectionType: 'section',
  };
}

function looksLikeHeading(value: string) {
  if (value.length < 3 || value.length > 90) {
    return false;
  }

  if (/[@]|https?:\/\//i.test(value)) {
    return false;
  }

  if (looksLikeStructuredNoise(value)) {
    return false;
  }

  if (/[.!?。！？]$/.test(value)) {
    return false;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 14) {
    return false;
  }

  const titleCaseRatio = words.filter((word) => /^[A-Z][a-z0-9-]+$/.test(word) || /^[A-Z]{2,}$/.test(word)).length / words.length;
  return /^\d+(?:\.\d+)*[.)]?\s+/.test(value) || titleCaseRatio >= 0.6 || words.length <= 4;
}

function looksLikeBodyText(value: string) {
  if (!value) {
    return false;
  }

  if (/https?:\/\//i.test(value)) {
    return false;
  }

  if (/^[[(]?\d+[)\]]?\s/.test(value)) {
    return true;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 6) {
    return false;
  }

  const lowerCaseWords = words.filter((word) => /^[a-z][a-z-]*$/.test(word)).length;
  return lowerCaseWords / words.length >= 0.35 || /[.!?。！？]$/.test(value);
}

function looksLikeStructuredNoise(value: string) {
  if (!/[A-Za-z]/.test(value)) {
    return true;
  }

  if (/\d{2,}[A-Za-z]|[A-Za-z]\d{2,}/.test(value)) {
    return true;
  }

  if (/^(figure|table)\s+\d+/i.test(value)) {
    return true;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  const numericLikeTokens = tokens.filter((token) => /^(?:[\d.+\-=%]+|[✗✓•�?]+|[A-Z]=?|[A-Z]\)|\(?\d+[A-Za-z]?\)?)$/.test(token)).length;
  const punctuationHeavyTokens = tokens.filter((token) => /[=<>±×÷_]/.test(token)).length;

  if (tokens.length > 0 && numericLikeTokens / tokens.length >= 0.45) {
    return true;
  }

  if (punctuationHeavyTokens >= 2) {
    return true;
  }

  if (/^[A-Z]\s*=/.test(value) || /\b(?:acc|f1|precision|recall|latency|hz|fps)\b/i.test(value) && /\d/.test(value)) {
    return true;
  }

  if (tokens.length <= 3 && tokens.some((token) => /^[A-Z]$/.test(token))) {
    return true;
  }

  return false;
}

function looksLikeAuthorLine(value: string) {
  if (!value.includes(',')) {
    return false;
  }

  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) {
    return false;
  }

  return parts.every((part) => /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}$/.test(part));
}

function isLikelyCaptionOrFooter(line: string) {
  if (!line) {
    return false;
  }

  if (/^(figure|fig\.?|table)\s+\d+[A-Za-z0-9.-]*[:.\-–—]?/i.test(line)) {
    return true;
  }

  if (/^(?:\d{1,2}(?:st|nd|rd|th)\s+)?conference on /i.test(line)) {
    return true;
  }

  if (/^neurips|^cvpr|^iccv|^eccv|^iclr|^arxiv preprint/i.test(line)) {
    return true;
  }

  return false;
}

function isLikelyTabularLine(line: string) {
  if (!line) {
    return false;
  }

  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) {
    return false;
  }

  const numericLikeTokens = tokens.filter((token) => /^(?:[\d.+\-=%]+|[✗✓•�?]+|[A-Z]=?|\(?\d+[A-Za-z]?\)?)$/.test(token)).length;
  if (numericLikeTokens / tokens.length >= 0.55) {
    return true;
  }

  if (/\b(?:acc|f1|precision|recall|latency|freq|duration|model size|train|test)\b/i.test(line) && /\d/.test(line)) {
    return true;
  }

  return false;
}

function isLikelyIsolatedNumericLine(line: string) {
  if (!line) {
    return false;
  }

  const normalized = line.replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ').filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  if (tokens.length === 1) {
    return /^(?:\d+(?:\.\d+)?|\d+\.\d+%?)$/.test(tokens[0]);
  }

  const numericTokenRatio = tokens.filter((token) => /^(?:\d+(?:\.\d+)?%?|\d+[x×]\d+|[A-Z]?\d+(?:\.\d+)?)$/.test(token)).length / tokens.length;
  const alphaCharCount = normalized.replace(/[^A-Za-z]/g, '').length;

  if (alphaCharCount === 0 && numericTokenRatio >= 0.5) {
    return true;
  }

  return tokens.length <= 4 && numericTokenRatio >= 0.75;
}

function isLikelyIsolatedNumericBlock(block: ExtractedPdfBlock) {
  if (!block.text) {
    return false;
  }

  const lines = block.text
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  if (lines.length === 0) {
    return true;
  }

  const isolatedNumericLines = lines.filter((line) => isLikelyIsolatedNumericLine(line)).length;
  if (isolatedNumericLines === lines.length) {
    return true;
  }

  const joined = lines.join(' ');
  const alphaCharCount = joined.replace(/[^A-Za-z]/g, '').length;
  return lines.length <= 4 && isolatedNumericLines / lines.length >= 0.6 && alphaCharCount <= 10;
}

function isLikelyFigureAdjacentNoise(
  block: ExtractedPdfBlock,
  index: number,
  blocks: Array<ExtractedPdfBlock & { page?: number }>,
) {
  if (!block.text) {
    return false;
  }

  const neighbors = [blocks[index - 1], blocks[index + 1]].filter((candidate): candidate is ExtractedPdfBlock & { page?: number } => Boolean(candidate));
  const nearCaption = neighbors.some((candidate) => candidate.page === block.page && isLikelyCaptionOrFooter(candidate.text));
  const nearGraphic = neighbors.some((candidate) => candidate.page === block.page && Boolean(candidate.hasGraphic));

  if (!nearCaption && !nearGraphic) {
    return false;
  }

  const compact = block.text.replace(/\s+/g, ' ').trim();
  return isLikelyIsolatedNumericLine(compact) || isLikelyTabularLine(compact) || looksLikeStructuredNoise(compact) || looksLikeChartPollutionBlock(compact);
}

function looksLikeChartPollutionBlock(value: string) {
  if (!value) {
    return false;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  const chartTerms = [
    /zero-shot/i,
    /top-?1 accuracy/i,
    /model parameters/i,
    /log-scale/i,
    /imagenet(?:-1k)?(?: val)?/i,
    /openclip/i,
    /eva-0\d-cl(?:ip)?/i,
    /^\d+(?:\.\d+)?$/,
  ];
  const matchedChartTerms = chartTerms.filter((pattern) => pattern.test(normalized)).length;
  const numericMatches = normalized.match(/\b\d+(?:\.\d+)?\b/g) ?? [];

  if (matchedChartTerms >= 2) {
    return true;
  }

  return numericMatches.length >= 3 && matchedChartTerms >= 1;
}

function isLikelyPageArtifact(line: string) {
  if (!line) {
    return true;
  }

  if (/^arxiv:\d{4}\.\d{4,5}(?:v\d+)?/i.test(line)) {
    return true;
  }

  if (/^(?:page\s+)?\d+(?:\s+of\s+\d+)?$/i.test(line)) {
    return true;
  }

  return false;
}

function joinSectionContent(lines: string[]) {
  const cleanedLines = lines
    .map((line) => normalizeLine(line))
    .filter((line) => !isLikelyPageArtifact(line))
    .filter((line) => !isLikelyCaptionOrFooter(line))
    .filter((line) => !isLikelyTabularLine(line))
    .filter((line) => !isLikelyIsolatedNumericLine(line))
    .filter((line) => !looksLikeChartPollutionBlock(line));
  if (cleanedLines.length === 0) {
    return '';
  }

  const chunks: string[] = [];
  let current = '';

  for (const line of cleanedLines) {
    if (looksLikeHeading(line) && current.length >= 200) {
      chunks.push(current.trim());
      current = line;
      continue;
    }

    current = current ? `${current}\n${line}` : line;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.join('\n\n').trim();
}

function dedupeAdjacentSections(sections: ExtractedPdfSection[]) {
  return sections.filter((section, index) => {
    const previous = sections[index - 1];
    return !previous || previous.title !== section.title || previous.content !== section.content;
  });
}

function isExtractedPdfSection(section: ExtractedPdfSection | null): section is ExtractedPdfSection {
  return section !== null;
}

function attachEstimatedPages(sections: ExtractedPdfSection[], pageCount: number) {
  if (pageCount <= 0 || sections.length === 0) {
    return sections;
  }

  return sections.map((section, index) => {
    const start = Math.max(1, Math.floor((index / sections.length) * pageCount) + 1);
    const end = index === sections.length - 1 ? pageCount : Math.max(start, Math.floor(((index + 1) / sections.length) * pageCount));

    return {
      ...section,
      pageStart: start,
      pageEnd: end,
    };
  });
}

function normalizeLine(line: string) {
  return line
    .replace(/\s+/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/([a-z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(?=\d{2,}(?:\s|$))/g, '$1 ')
    .replace(/(\d)(?=[A-Za-z]{2,})/g, '$1 ')
    .replace(/([,.;:])([A-Za-z])/g, '$1 $2')
    .trim();
}

function isLikelyRunningHeader(line: string) {
  if (line.length > 160) {
    return false;
  }

  if (/©|copyright/i.test(line)) {
    return true;
  }

  if (/^(?:arxiv|preprint|conference|journal)(?:\b|:)/i.test(line)) {
    return true;
  }

  if (/^(?:page\s+\d+|\d+)$/i.test(line)) {
    return true;
  }

  return /\b(?:accepted at|published as|proceedings of|transactions on|international conference on|conference on computer vision|advances in neural information processing systems)\b/i.test(line);
}

function stripHeadingNumber(value: string, fallback?: string) {
  const stripped = value.replace(SECTION_HEADING_PREFIX, '').trim();
  return stripped || fallback || value;
}
