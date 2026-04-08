export interface SectionChunkInput {
  paperId: string;
  sectionId: string | null;
  sectionKey: string;
  sectionType: string;
  content: string;
  startChunkIndex: number;
}

export interface BuiltChunk {
  paperId: string;
  sectionId: string | null;
  chunkKey: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embeddingStatus: string;
  metadataJson: string;
}

const MAX_CHUNK_LENGTH = 1600;
const MIN_CHUNK_LENGTH = 500;
const OVERLAP_LENGTH = 220;

export function buildSectionChunks({
  paperId,
  sectionId,
  sectionKey,
  sectionType,
  content,
  startChunkIndex,
}: SectionChunkInput): BuiltChunk[] {
  const normalized = content.trim();

  if (!normalized) {
    return [];
  }

  const chunks = splitTextForChunks(normalized);

  return chunks.map((chunk, index) => ({
    paperId,
    sectionId,
    chunkKey: `${sectionKey}-chunk-${index + 1}`,
    chunkIndex: startChunkIndex + index,
    content: chunk,
    tokenCount: countTokens(chunk),
    embeddingStatus: 'pending',
    metadataJson: JSON.stringify({
      sectionKey,
      sectionType,
      localChunkIndex: index,
      charLength: chunk.length,
    }),
  }));
}

function splitTextForChunks(text: string) {
  const paragraphs = text
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_LENGTH) {
      flushCurrentChunk(chunks, current);
      current = '';

      const sentenceChunks = splitLargeParagraph(paragraph);
      for (const sentenceChunk of sentenceChunks) {
        chunks.push(sentenceChunk);
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;

    if (next.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = buildOverlapPrefix(current, paragraph);
    } else {
      current = next;
    }
  }

  flushCurrentChunk(chunks, current);

  return mergeShortChunks(chunks);
}

function splitLargeParagraph(paragraph: string) {
  const sentences = paragraph
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return splitByLength(paragraph);
  }

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = buildOverlapPrefix(current, sentence, ' ');
    } else {
      current = next;
    }
  }

  flushCurrentChunk(chunks, current);

  return chunks.flatMap((chunk) => (chunk.length > MAX_CHUNK_LENGTH ? splitByLength(chunk) : [chunk]));
}

function splitByLength(text: string) {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_LENGTH, text.length);
    const slice = text.slice(start, end).trim();

    if (slice) {
      chunks.push(slice);
    }

    if (end >= text.length) {
      break;
    }

    start = Math.max(end - OVERLAP_LENGTH, start + 1);
  }

  return chunks;
}

function buildOverlapPrefix(previous: string, nextUnit: string, separator = '\n\n') {
  const overlap = previous.slice(-OVERLAP_LENGTH).trim();
  return overlap ? `${overlap}${separator}${nextUnit}` : nextUnit;
}

function flushCurrentChunk(chunks: string[], current: string) {
  const value = current.trim();
  if (value) {
    chunks.push(value);
  }
}

function mergeShortChunks(chunks: string[]) {
  if (chunks.length <= 1) {
    return chunks;
  }

  const merged: string[] = [];

  for (const chunk of chunks) {
    const previous = merged.at(-1);

    if (previous && (chunk.length < MIN_CHUNK_LENGTH || previous.length < MIN_CHUNK_LENGTH) && previous.length + chunk.length + 2 <= MAX_CHUNK_LENGTH) {
      merged[merged.length - 1] = `${previous}\n\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}

function countTokens(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}
