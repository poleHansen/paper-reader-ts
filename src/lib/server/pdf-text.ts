import { readFile } from 'node:fs/promises';

export interface ExtractedPdfSection {
  title: string;
  sectionType: string;
  content: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface ExtractedPdfText {
  fullText: string;
  previewText: string;
  pageLikeSegments: string[];
  inferredSections: ExtractedPdfSection[];
  pageCount: number;
}

const SECTION_PATTERNS = [
  { title: 'Abstract', sectionType: 'abstract', pattern: /^abstract$/i },
  { title: 'Introduction', sectionType: 'introduction', pattern: /^(\d+(?:\.\d+)*[.)]?\s*)?introduction$/i },
  { title: 'Related Work', sectionType: 'related_work', pattern: /^(\d+(?:\.\d+)*[.)]?\s*)?(related work|background|literature review)$/i },
  { title: 'Method', sectionType: 'method', pattern: /^(\d+(?:\.\d+)*[.)]?\s*)?(method|approach|methodology|proposed method|framework)$/i },
  { title: 'Experiments', sectionType: 'experiments', pattern: /^(\d+(?:\.\d+)*[.)]?\s*)?(experiment|experiments|evaluation|results|analysis)$/i },
  { title: 'Discussion', sectionType: 'discussion', pattern: /^(\d+(?:\.\d+)*[.)]?\s*)?discussion$/i },
  { title: 'Conclusion', sectionType: 'conclusion', pattern: /^(\d+(?:\.\d+)*[.)]?\s*)?conclusion[s]?$/i },
  { title: 'References', sectionType: 'references', pattern: /^references$/i },
  { title: 'Appendix', sectionType: 'appendix', pattern: /^(appendix|appendices|supplementary material)$/i },
] as const;

const MAX_SECTION_LENGTH = 20000;
const PREVIEW_LENGTH = 12000;
const MAX_PAGE_SEGMENTS = 12;

export async function extractPdfText(filePath: string): Promise<ExtractedPdfText> {
  const buffer = await readFile(filePath);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });

  try {
    const parsed = await parser.getText();
    const normalizedText = normalizePdfText(parsed.text);
    const paragraphs = splitIntoParagraphs(normalizedText);
    const inferredSections = inferSections(paragraphs, parsed.total || 0);
    const pageLikeSegments = splitIntoSegments(inferredSections, paragraphs);

    return {
      fullText: normalizedText,
      previewText: normalizedText.slice(0, PREVIEW_LENGTH),
      pageLikeSegments,
      inferredSections,
      pageCount: parsed.total || 0,
    };
  } finally {
    await parser.destroy();
  }
}

function normalizePdfText(value: string) {
  const cleaned = value
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned
    .split('\n')
    .map((line) => normalizeLine(line))
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

function inferSections(paragraphs: string[], pageCount: number) {
  if (paragraphs.length === 0) {
    return [] as ExtractedPdfSection[];
  }

  const headingMatches = paragraphs
    .map((paragraph, index) => ({
      index,
      heading: extractHeading(paragraph),
    }))
    .filter((item): item is { index: number; heading: { title: string; sectionType: string } } => Boolean(item.heading));

  if (headingMatches.length === 0) {
    return buildFallbackSections(paragraphs, pageCount);
  }

  const sections = headingMatches
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
    .filter((section): section is ExtractedPdfSection => Boolean(section));

  if (sections.length === 0) {
    return buildFallbackSections(paragraphs, pageCount);
  }

  return attachEstimatedPages(sections, pageCount);
}

function extractHeading(paragraph: string) {
  const lines = paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headingCandidate = lines[0];

  if (!headingCandidate || lines.length > 3 || headingCandidate.length > 120) {
    return null;
  }

  const normalizedHeading = headingCandidate.replace(/[:.\-–—]+$/, '').trim();
  const definition = SECTION_PATTERNS.find((item) => item.pattern.test(normalizedHeading));

  if (definition) {
    return {
      title: stripHeadingNumber(normalizedHeading, definition.title),
      sectionType: definition.sectionType,
    };
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

  if (/[.!?。！？]$/.test(value)) {
    return false;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 14) {
    return false;
  }

  const headingCore = stripHeadingNumber(value);
  const titleCaseRatio = words.filter((word) => /^[A-Z][a-z0-9-]+$/.test(word) || /^[A-Z]{2,}$/.test(word)).length / words.length;
  return /^\d+(?:\.\d+)*[.)]?\s+/.test(value) || titleCaseRatio >= 0.6 || words.length <= 4;
}

function buildFallbackSections(paragraphs: string[], pageCount: number) {
  const content = paragraphs.join('\n\n').trim();

  if (!content) {
    return [];
  }

  const fallback: ExtractedPdfSection[] = [
    {
      title: 'Full text',
      sectionType: 'full_text',
      content: content.slice(0, MAX_SECTION_LENGTH),
    },
  ];

  return attachEstimatedPages(fallback, pageCount);
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
    .trim();
}

function isLikelyRunningHeader(line: string) {
  return line.length <= 80 && /^(arxiv|preprint|conference|journal|page \d+|\d+)$|©|copyright/i.test(line);
}

function stripHeadingNumber(value: string, fallback?: string) {
  const stripped = value.replace(/^\d+(?:\.\d+)*[.)]?\s*/, '').trim();
  return stripped || fallback || value;
}
