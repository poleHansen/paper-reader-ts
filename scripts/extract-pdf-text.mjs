import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const pdfJsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
const pdfjs = await import(pathToFileURL(pdfJsPath).href);
const DEBUG_GRAPHICS = process.env.DEBUG_PDF_GRAPHICS === '1';

if ('GlobalWorkerOptions' in pdfjs && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node scripts/extract-pdf-text.mjs <pdf-path>');
  process.exit(1);
}

const buffer = await readFile(filePath);
const loadingTask = pdfjs.getDocument({
  data: new Uint8Array(buffer),
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
  disableFontFace: true,
});

const document = await loadingTask.promise;

try {
  const pageTexts = [];
  const pageBlocks = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);

    try {
      const content = await page.getTextContent();
      const operatorList = await page.getOperatorList();
      const viewport = page.getViewport({ scale: 1 });
      const items = [];

      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') {
          continue;
        }

        const text = item.str.replace(/\s+/g, ' ').trim();
        if (!text) {
          continue;
        }

        const transform = 'transform' in item && Array.isArray(item.transform) ? item.transform : null;
        const x = transform ? Number(transform[4]) : 0;
        const y = transform ? Number(transform[5]) : 0;
        const width = 'width' in item && typeof item.width === 'number' ? item.width : estimateWidth(text);
        const height = Math.abs(transform?.[3] ?? 10) || 10;

        items.push({
          text,
          x,
          y,
          width,
          height,
          left: x,
          right: x + width,
          top: y,
          bottom: y - height,
        });
      }

      const lines = buildLines(items);
      const graphicEntities = extractGraphicEntities({
        operatorList,
        viewport,
      });
      if (DEBUG_GRAPHICS) {
        console.error(JSON.stringify({
          page: pageIndex,
          lineCount: lines.length,
          graphicEntityCount: graphicEntities.length,
          graphicEntities: graphicEntities.slice(0, 20),
        }));
      }
      const textBlocks = recursiveXyCut(lines, {
        left: 0,
        right: viewport.width,
        top: viewport.height,
        bottom: 0,
      }).flatMap((block) => splitOversizedBlock(block, viewport));
      const graphicBlocks = graphicEntities
        .map((entity) => buildBlock([entity]))
        .filter(Boolean);
      const blocks = sortBlocksForOutput([...textBlocks, ...graphicBlocks]);
      const pageText = blocksToText(blocks).trim();
      pageBlocks.push({
        page: pageIndex,
        width: viewport.width,
        height: viewport.height,
        blocks: blocks
          .map((block, blockIndex) => {
            const hasGraphic = block.lines.some((line) => line.kind === 'graphic');
            return {
              id: `${pageIndex}-${blockIndex + 1}`,
              page: pageIndex,
              text: block.text,
              bbox: {
                left: block.left,
                right: block.right,
                top: block.top,
                bottom: block.bottom,
                width: block.right - block.left,
                height: block.top - block.bottom,
              },
              hasGraphic,
              graphicTypes: [...new Set(block.lines.filter((line) => line.kind === 'graphic').map((line) => line.graphicType))],
              lines: block.lines.map((line) => ({
                text: line.text,
                x: line.x,
                y: line.y,
                width: line.width,
                height: line.height,
                kind: line.kind,
              })),
            };
          })
          .filter((block) => block.text || block.hasGraphic),
      });

      if (pageText) {
        pageTexts.push(pageText);
      }
    } finally {
      page.cleanup();
    }
  }

  process.stdout.write(JSON.stringify({
    text: pageTexts.join('\n\n'),
    total: document.numPages,
    pages: pageBlocks,
  }));
} finally {
  await document.destroy();
}

function estimateWidth(text) {
  return Math.max(6, text.length * 5.5);
}

function buildLines(items) {
  const rows = new Map();

  for (const item of items) {
    const rowKey = String(Math.round(item.y / 3) * 3);
    const existing = rows.get(rowKey) ?? [];
    existing.push(item);
    rows.set(rowKey, existing);
  }

  return [...rows.values()]
    .map((rowItems) => buildLineFromItems(rowItems))
    .filter(Boolean)
    .map((line) => ({
      ...line,
      left: line.x,
      right: line.x + line.width,
      top: line.y,
      bottom: line.y - line.height,
    }));
}

function buildLineFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const ordered = [...items].sort((left, right) => left.x - right.x);
  let text = '';

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    const gap = previous ? current.x - previous.right : 0;
    const separator = previous && gap > 8 ? ' ' : '';
    text += `${separator}${current.text}`;
  }

  const left = ordered[0]?.left ?? 0;
  const right = ordered[ordered.length - 1]?.right ?? left;
  const top = Math.max(...ordered.map((item) => item.top));
  const bottom = Math.min(...ordered.map((item) => item.bottom));

  return {
    kind: 'text',
    text: text.replace(/\s+/g, ' ').trim(),
    x: left,
    y: top,
    width: right - left,
    height: Math.max(8, top - bottom),
    itemCount: ordered.length,
  };
}

function recursiveXyCut(lines, region, depth = 0) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  if (lines.length <= 6 || depth >= 8) {
    return [buildBlock(sortReadingOrder(lines))].filter(Boolean);
  }

  const verticalCut = findBestGap(lines, 'x', region);
  const horizontalCut = findBestGap(lines, 'y', region);

  if (!verticalCut && !horizontalCut) {
    return [buildBlock(sortReadingOrder(lines))].filter(Boolean);
  }

  const preferVertical = shouldPreferVerticalCut(verticalCut, horizontalCut, region);
  const chosenCut = preferVertical ? verticalCut : horizontalCut;

  if (!chosenCut) {
    return [buildBlock(sortReadingOrder(lines))].filter(Boolean);
  }

  const parts = splitByCut(lines, chosenCut);
  if (parts.length <= 1) {
    return [buildBlock(sortReadingOrder(lines))].filter(Boolean);
  }

  return parts.flatMap((part) => recursiveXyCut(part.lines, part.region, depth + 1));
}

function findBestGap(lines, axis, region) {
  const ranges = lines
    .map((line) => axis === 'x'
      ? { start: line.left, end: line.right }
      : { start: line.bottom, end: line.top })
    .sort((left, right) => left.start - right.start);

  if (ranges.length < 2) {
    return null;
  }

  const regionStart = axis === 'x' ? region.left : region.bottom;
  const regionEnd = axis === 'x' ? region.right : region.top;
  let previousEnd = regionStart;
  let bestGap = null;

  for (const range of ranges) {
    const gap = range.start - previousEnd;
    if (gap > (bestGap?.size ?? 0)) {
      bestGap = {
        axis,
        start: previousEnd,
        end: range.start,
        size: gap,
        position: previousEnd + gap / 2,
      };
    }

    previousEnd = Math.max(previousEnd, range.end);
  }

  const tailGap = regionEnd - previousEnd;
  if (tailGap > (bestGap?.size ?? 0)) {
    bestGap = {
      axis,
      start: previousEnd,
      end: regionEnd,
      size: tailGap,
      position: previousEnd + tailGap / 2,
    };
  }

  const threshold = axis === 'x'
    ? Math.max(18, (region.right - region.left) * 0.08)
    : Math.max(14, (region.top - region.bottom) * 0.035);

  return bestGap && bestGap.size >= threshold ? bestGap : null;
}

function shouldPreferVerticalCut(verticalCut, horizontalCut, region) {
  if (verticalCut && !horizontalCut) {
    return true;
  }

  if (!verticalCut) {
    return false;
  }

  const verticalScore = verticalCut.size / Math.max(1, region.right - region.left);
  const horizontalScore = horizontalCut ? horizontalCut.size / Math.max(1, region.top - region.bottom) : 0;
  return verticalScore >= horizontalScore;
}

function splitByCut(lines, cut) {
  if (cut.axis === 'x') {
    const left = lines.filter((line) => line.right <= cut.position || line.x < cut.position);
    const right = lines.filter((line) => line.left >= cut.position || line.x >= cut.position);
    const overlapping = lines.filter((line) => !left.includes(line) && !right.includes(line));

    if (overlapping.length > 0) {
      return [{ lines, region: getBounds(lines) }];
    }

    return [left, right]
      .filter((part) => part.length > 0)
      .map((part) => ({ lines: part, region: getBounds(part) }));
  }

  const top = lines.filter((line) => line.bottom >= cut.position || line.y >= cut.position);
  const bottom = lines.filter((line) => line.top <= cut.position || line.y < cut.position);
  const overlapping = lines.filter((line) => !top.includes(line) && !bottom.includes(line));

  if (overlapping.length > 0) {
    return [{ lines, region: getBounds(lines) }];
  }

  return [top, bottom]
    .filter((part) => part.length > 0)
    .map((part) => ({ lines: part, region: getBounds(part) }));
}

function getBounds(lines) {
  return {
    left: Math.min(...lines.map((line) => line.left)),
    right: Math.max(...lines.map((line) => line.right)),
    top: Math.max(...lines.map((line) => line.top)),
    bottom: Math.min(...lines.map((line) => line.bottom)),
  };
}

function sortReadingOrder(lines) {
  return [...lines].sort((left, right) => {
    const sameRow = Math.abs(left.y - right.y) < 8;
    if (sameRow) {
      return left.x - right.x;
    }

    return right.y - left.y;
  });
}

function blocksToText(lines) {
  return lines
    .map((block, index) => {
      const previous = lines[index - 1];
      const paragraphBreak = previous && Math.abs(previous.bottom - block.top) > 18;
      return `${paragraphBreak ? '\n' : ''}${block.text}`;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function sortBlocksForOutput(blocks) {
  return [...blocks].sort((left, right) => {
    const sameRow = Math.abs(left.top - right.top) < 8;
    if (sameRow) {
      return left.left - right.left;
    }

    return right.top - left.top;
  });
}

function buildBlock(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return null;
  }

  const orderedLines = sortReadingOrder(lines);
  return {
    text: orderedLines
      .filter((line) => line.kind !== 'graphic')
      .map((line) => line.text)
      .join('\n')
      .trim(),
    lines: orderedLines,
    left: Math.min(...orderedLines.map((line) => line.left)),
    right: Math.max(...orderedLines.map((line) => line.right)),
    top: Math.max(...orderedLines.map((line) => line.top)),
    bottom: Math.min(...orderedLines.map((line) => line.bottom)),
  };
}

function splitOversizedBlock(block, viewport) {
  if (!block || !Array.isArray(block.lines) || block.lines.length <= 6) {
    return block ? [block] : [];
  }

  if (block.lines.some((line) => line.kind === 'graphic')) {
    return [block];
  }

  const widthRatio = block.right - block.left > 0 ? (block.right - block.left) / Math.max(1, viewport.width) : 0;
  const heightRatio = block.top - block.bottom > 0 ? (block.top - block.bottom) / Math.max(1, viewport.height) : 0;

  if (block.lines.length <= 10 && widthRatio <= 0.78 && heightRatio <= 0.18) {
    return [block];
  }

  const groupedCandidates = splitByCaptionLines(block.lines);
  const candidateGroups = groupedCandidates.flatMap((group) => splitByProminentHeadingLines(group));
  const groups = [];
  for (const candidate of candidateGroups) {
    if (candidate.length === 0) {
      continue;
    }

    let current = [candidate[0]];

    for (let index = 1; index < candidate.length; index += 1) {
      const line = candidate[index];
      const previous = candidate[index - 1];
      const gap = previous.bottom - line.top;
      const indentDelta = Math.abs(line.left - previous.left);
      const breakBefore = shouldBreakBeforeLine(line, previous, {
        gap,
        indentDelta,
        viewport,
        current,
      });

      if (breakBefore && current.length > 0) {
        groups.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }

    if (current.length > 0) {
      groups.push(current);
    }
  }

  if (groups.length <= 1) {
    return [block];
  }

  return groups
    .map((group) => buildBlock(group))
    .filter(Boolean);
}

function splitByProminentHeadingLines(lines) {
  if (!Array.isArray(lines) || lines.length <= 4) {
    return [lines];
  }

  const bodyHeights = lines
    .map((line) => line.height)
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((left, right) => left - right);

  const medianHeight = bodyHeights[Math.floor(bodyHeights.length / 2)] ?? 10;
  const groups = [];
  let current = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind === 'graphic') {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }

      groups.push([line]);
      continue;
    }

    const prominentHeading = isProminentHeadingLine(line, medianHeight);

    if (prominentHeading) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }

      groups.push([line]);
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups.filter((group) => group.length > 0);
}

function splitByCaptionLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const groups = [];
  let current = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.kind === 'graphic') {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }

      groups.push([line]);
      continue;
    }

    const text = line.text.trim();
    const captionLike = isFigureCaptionLine(text);

    if (captionLike) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }

      const captionGroup = [line];
      let cursor = index + 1;
      while (cursor < lines.length && captionGroup.length < 6) {
        const next = lines[cursor];
        const gap = captionGroup[captionGroup.length - 1].bottom - next.top;
        const nextText = next.text.trim();
        if (gap > Math.max(18, next.height * 1.6) || isHardSectionHeading(nextText)) {
          break;
        }

        if (!isCaptionContinuationLine(nextText, captionGroup[captionGroup.length - 1].text.trim())) {
          break;
        }

        captionGroup.push(next);
        cursor += 1;
      }

      groups.push(captionGroup);
      index = cursor - 1;
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups.filter((group) => group.length > 0);
}

function isProminentHeadingLine(line, medianHeight) {
  const text = line.text.trim();

  if (!looksLikeSectionHeading(text) || looksLikeFormulaOrTableNoise(text)) {
    return false;
  }

  if (text.length > 120) {
    return false;
  }

  return line.height >= medianHeight * 1.2 || line.width <= 260;
}

function shouldBreakBeforeLine(line, previous, context) {
  if (line.kind === 'graphic' || previous.kind === 'graphic') {
    return true;
  }

  const currentText = line.text.trim();
  const previousText = previous.text.trim();
  const lineHeight = Math.max(line.height, previous.height, 8);
  const largeVerticalGap = context.gap > lineHeight * 0.9;
  const veryLargeGap = context.gap > lineHeight * 1.5;
  const indentShift = context.indentDelta > 18;
  const headingLike = looksLikeSectionHeading(currentText);
  const captionLike = isFigureCaptionLine(currentText);
  const currentChartNoise = isLikelyChartNoiseLine(currentText, line, context.viewport);
  const previousChartNoise = isLikelyChartNoiseLine(previousText, previous, context.viewport);
  const previousEndsParagraph = /[.!?]$/.test(previousText);
  const currentStartsBody = /^[A-Z([]?[A-Za-z].{20,}/.test(currentText);
  const shortCurrent = currentText.length <= 120;
  const currentGroupHeight = context.current.length;

  if (currentChartNoise !== previousChartNoise) {
    return true;
  }

  if ((headingLike || captionLike) && (largeVerticalGap || indentShift || currentGroupHeight >= 3)) {
    return true;
  }

  if (veryLargeGap && shortCurrent) {
    return true;
  }

  if (previousEndsParagraph && largeVerticalGap && currentStartsBody) {
    return true;
  }

  return false;
}

function isLikelyChartNoiseLine(text, line, viewport) {
  if (!text) {
    return false;
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ').filter(Boolean);
  const numericRatio = tokens.length > 0
    ? tokens.filter((token) => /^(?:\d+(?:\.\d+)?%?|\d+[x×]\d+|[A-Z]?\d+(?:\.\d+)?|top-?1|top-?5)$/i.test(token)).length / tokens.length
    : 0;
  const alphaCharCount = normalized.replace(/[^A-Za-z]/g, '').length;
  const narrowLine = viewport?.width ? line.width / Math.max(1, viewport.width) <= 0.42 : line.width <= 220;
  const sparseTokens = tokens.length <= 8;

  if (/^(?:zero-shot|top-?1 accuracy|model parameters|log-scale|imagenet(?:-1k)?(?: val)?|openclip|eva-0\d-cl(?:ip)?|clip-l\/14\+?)$/i.test(normalized)) {
    return true;
  }

  if (numericRatio >= 0.5 && sparseTokens && narrowLine) {
    return true;
  }

  return alphaCharCount <= 18 && numericRatio >= 0.34 && narrowLine;
}

function looksLikeSectionHeading(value) {
  if (!value || value.length < 3 || value.length > 140) {
    return false;
  }

  if (/[@]|https?:\/\//i.test(value)) {
    return false;
  }

  if (/[.!?]$/.test(value)) {
    return false;
  }

  if (isFigureCaptionLine(value)) {
    return false;
  }

  if (looksLikeFormulaOrTableNoise(value)) {
    return false;
  }

  if (isFormulaHeadingLike(value)) {
    return false;
  }

  if (/^\d+(?:\.\d+)*[.)]?\s+[A-Z]/.test(value)) {
    return true;
  }

  return /^(?:Abstract|Introduction|Related Work|Background|Method|Methodology|Approach|Experiments|Experimental Setup|Results|Discussion|Conclusion|References|Appendix)\b/i.test(value);
}

function isHardSectionHeading(value) {
  return looksLikeSectionHeading(value) && !isFormulaHeadingLike(value);
}

function isFigureCaptionLine(value) {
  return /^(?:Figure|Fig\.?|Table)\s*\d+[A-Za-z0-9.-]*(?:[:.\-–—]|\s)/i.test(value);
}

function looksLikeFormulaOrTableNoise(value) {
  if (!value) {
    return false;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  const numericHeavy = tokens.filter((token) => /\d/.test(token)).length / tokens.length;
  const symbolHeavy = tokens.filter((token) => /[=<>±×÷+/%]/.test(token)).length / tokens.length;
  const shortTokenHeavy = tokens.filter((token) => token.length <= 3).length / tokens.length;
  const mixedAlphaNumeric = tokens.filter((token) => /(?=.*[A-Za-z])(?=.*\d)|(?=.*\d)(?=.*[A-Za-z])/.test(token)).length / tokens.length;

  if (numericHeavy >= 0.35 && symbolHeavy >= 0.2) {
    return true;
  }

  if (mixedAlphaNumeric >= 0.3) {
    return true;
  }

  if (shortTokenHeavy >= 0.7 && symbolHeavy >= 0.15) {
    return true;
  }

  if (/^(?:top-?1|top-?5|acc|f1|auroc|precision|recall|map|fps|latency|flip)\b/i.test(value) && /\d/.test(value)) {
    return true;
  }

  return false;
}

function isFormulaHeadingLike(value) {
  if (!value) {
    return false;
  }

  const compact = value.replace(/\s+/g, '');

  if (compact.length <= 12 && /[×÷=+\-/*Φφ]/.test(compact)) {
    return true;
  }

  if (!/\s/.test(value) && /[A-Za-zΑ-Ωα-ω]/u.test(value) && /[×÷=+\-/*]/.test(value)) {
    return true;
  }

  return /^[A-Za-zΑ-Ωα-ω][×÷=+\-/*][A-Za-zΑ-Ωα-ω](?:[×÷=+\-/*][A-Za-zΑ-Ωα-ω])+$/u.test(compact);
}

function isCaptionContinuationLine(current, previous) {
  if (!current) {
    return false;
  }

  if (isFigureCaptionLine(current)) {
    return true;
  }

  if (isHardSectionHeading(current)) {
    return false;
  }

  if (/^[a-z([]/.test(current) || /^\(?[ivx]+\)?/i.test(current) || /^\d+[.)]/.test(current)) {
    return true;
  }

  if (previous.endsWith('-')) {
    return true;
  }

  return current.length >= 20 && !looksLikeFormulaOrTableNoise(current);
}

function extractGraphicEntities({ operatorList, viewport }) {
  if (!operatorList?.fnArray || !operatorList?.argsArray) {
    return [];
  }

  const entities = [];
  let currentTransform = [1, 0, 0, 1, 0, 0];
  const transformStack = [];
  let currentPathBounds = null;

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];

    if (fn === pdfjs.OPS.save) {
      transformStack.push([...currentTransform]);
      continue;
    }

    if (fn === pdfjs.OPS.restore) {
      currentTransform = transformStack.pop() ?? [1, 0, 0, 1, 0, 0];
      currentPathBounds = null;
      continue;
    }

    if (fn === pdfjs.OPS.transform) {
      currentTransform = multiplyTransforms(currentTransform, args);
      continue;
    }

    if (fn === pdfjs.OPS.constructPath) {
      currentPathBounds = getPathBounds(args, currentTransform);
      continue;
    }

    if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject || fn === pdfjs.OPS.paintImageMaskXObject) {
      const imageBounds = transformRect(currentTransform, { x: 0, y: 0, width: 1, height: 1 });
      const entity = buildGraphicEntity(imageBounds, viewport, 'image');
      if (entity) {
        entities.push(entity);
      }
      continue;
    }

    if (
      currentPathBounds &&
      [pdfjs.OPS.stroke, pdfjs.OPS.fill, pdfjs.OPS.fillStroke, pdfjs.OPS.closePath, pdfjs.OPS.closeStroke, pdfjs.OPS.closeFillStroke].includes(fn)
    ) {
      const entity = buildGraphicEntity(currentPathBounds, viewport, 'path');
      if (entity) {
        entities.push(entity);
      }
      currentPathBounds = null;
    }
  }

  return mergeGraphicEntities(entities);
}

function getPathBounds(args, transform) {
  const [, pathSegments, coordinates] = args;
  const numericCoordinates = extractNumericValues(coordinates);

  if (numericCoordinates.length >= 4) {
    const localRect = {
      x: numericCoordinates[0],
      y: numericCoordinates[1],
      width: numericCoordinates[2] - numericCoordinates[0],
      height: numericCoordinates[3] - numericCoordinates[1],
    };

    return transformRect(transform, localRect);
  }

  if (!Array.isArray(pathSegments) || pathSegments.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const segment of pathSegments) {
    const numbers = extractNumericValues(segment);
    for (let index = 0; index < numbers.length - 1; index += 2) {
      const point = applyTransform(transform, [numbers[index], numbers[index + 1]]);
      if (!point) {
        continue;
      }

      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    left: minX,
    right: maxX,
    bottom: minY,
    top: maxY,
  };
}

function extractNumericValues(value) {
  if (!value) {
    return [];
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value).filter((item) => Number.isFinite(item));
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractNumericValues(item));
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .filter((item) => Number.isFinite(item));
  }

  return Number.isFinite(value) ? [value] : [];
}

function buildGraphicEntity(bounds, viewport, type) {
  if (!bounds) {
    return null;
  }

  const left = Math.max(0, Math.min(bounds.left, bounds.right));
  const right = Math.min(viewport.width, Math.max(bounds.left, bounds.right));
  const bottom = Math.max(0, Math.min(bounds.bottom, bounds.top));
  const top = Math.min(viewport.height, Math.max(bounds.bottom, bounds.top));
  const width = right - left;
  const height = top - bottom;

  if (width < 12 || height < 12) {
    return null;
  }

  return {
    kind: 'graphic',
    graphicType: type,
    text: '',
    x: left,
    y: top,
    width,
    height,
    left,
    right,
    top,
    bottom,
  };
}

function mergeGraphicEntities(entities) {
  const merged = [];

  for (const entity of entities) {
    const last = merged[merged.length - 1];
    if (last && overlaps(last, entity, 10)) {
      last.left = Math.min(last.left, entity.left);
      last.right = Math.max(last.right, entity.right);
      last.top = Math.max(last.top, entity.top);
      last.bottom = Math.min(last.bottom, entity.bottom);
      last.x = last.left;
      last.y = last.top;
      last.width = last.right - last.left;
      last.height = last.top - last.bottom;
      continue;
    }

    merged.push({ ...entity });
  }

  return merged;
}

function overlaps(left, right, padding = 0) {
  return !(
    left.right + padding < right.left ||
    right.right + padding < left.left ||
    left.top + padding < right.bottom ||
    right.top + padding < left.bottom
  );
}

function multiplyTransforms(base, next) {
  if (!Array.isArray(next) || next.length < 6) {
    return base;
  }

  try {
    const transformed = pdfjs.Util.transform(base, next);
    return Array.isArray(transformed) && transformed.length >= 6 ? transformed : base;
  } catch {
    return base;
  }
}

function applyTransform(transform, point) {
  try {
    if (!Array.isArray(transform) || transform.length < 6 || !Array.isArray(point) || point.length < 2) {
      return null;
    }

    const [a, b, c, d, e, f] = transform;
    const [x, y] = point;
    const result = [
      a * x + c * y + e,
      b * x + d * y + f,
    ];

    return Number.isFinite(result[0]) && Number.isFinite(result[1]) ? result : null;
  } catch {
    return null;
  }
}

function transformRect(transform, rect) {
  const corners = [
    applyTransform(transform, [rect.x, rect.y]),
    applyTransform(transform, [rect.x + rect.width, rect.y]),
    applyTransform(transform, [rect.x, rect.y + rect.height]),
    applyTransform(transform, [rect.x + rect.width, rect.y + rect.height]),
  ];

  const validCorners = corners.filter((corner) => Array.isArray(corner) && corner.length >= 2);

  if (validCorners.length < 4) {
    return null;
  }

  return {
    left: Math.min(...validCorners.map((corner) => corner[0])),
    right: Math.max(...validCorners.map((corner) => corner[0])),
    bottom: Math.min(...validCorners.map((corner) => corner[1])),
    top: Math.max(...validCorners.map((corner) => corner[1])),
  };
}
