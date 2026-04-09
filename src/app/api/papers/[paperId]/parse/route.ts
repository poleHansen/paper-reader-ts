import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getLocalPaperFileInfo } from '@/lib/server/paper-file';
import { buildPersistedPaperContent } from '@/lib/server/paper-processing';
import { extractPdfText } from '@/lib/server/pdf-text';
import { downloadRemotePdf } from '@/lib/server/paper-upload';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ paperId: string }>;
}

export async function POST(_: Request, context: RouteContext) {
  const { paperId } = await context.params;
  let failureStage = 'load-paper';
  let extractionError: string | null = null;

  try {
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: {
        id: true,
        title: true,
        abstract: true,
        originalFilePath: true,
        sourcePlatform: true,
        sourceUrl: true,
        externalPaperId: true,
      },
    });

    if (!paper) {
      return NextResponse.json(
        {
          error: 'Paper not found.',
        },
        { status: 404 },
      );
    }

    failureStage = 'resolve-local-file';
    let localFile = await getLocalPaperFileInfo(paper.originalFilePath);

    if (!localFile) {
      const remotePdfUrl = buildRemotePdfUrl(paper.sourcePlatform, paper.sourceUrl, paper.externalPaperId);

      if (remotePdfUrl) {
        failureStage = 'download-remote-pdf';
        const downloadedFile = await downloadRemotePdf(remotePdfUrl, paper.externalPaperId ?? paper.title ?? paper.id);

        await prisma.paper.update({
          where: { id: paperId },
          data: {
            originalFilePath: downloadedFile.relativePath,
          },
        });

        localFile = downloadedFile;
      }
    }

    failureStage = 'extract-pdf';
    let extractedPdf = null;

    if (localFile) {
      try {
        extractedPdf = await extractPdfText(localFile.absolutePath);
      } catch (error) {
        extractionError = error instanceof Error ? error.message : String(error);
        console.warn('[parse-paper] PDF extraction failed', {
          paperId,
          filePath: localFile.relativePath,
          error: extractionError,
        });
      }
    }

    await prisma.paper.update({
      where: { id: paperId },
      data: {
        status: 'parsing',
        parseStatus: 'running',
      },
    });

    if (localFile && !extractedPdf) {
      throw new Error(extractionError ?? 'PDF extraction returned no content.');
    }

    if (localFile && extractedPdf) {
      const nonReferenceSections = extractedPdf.inferredSections.filter(
        (section) => section.sectionType !== 'references' && section.content.trim().length >= 120,
      );

      if (nonReferenceSections.length < 2) {
        throw new Error(
          `Section segmentation produced only ${nonReferenceSections.length} non-reference section(s).`,
        );
      }
    }

    failureStage = 'persist-results';
    const updatedPaper = await prisma.$transaction(async (tx) => {
      await tx.paperChunk.deleteMany({
        where: { paperId },
      });

      await tx.referenceItem.deleteMany({
        where: { paperId },
      });

      await tx.paperFigure.deleteMany({
        where: { paperId },
      });

      await tx.paperSection.deleteMany({
        where: {
          paperId,
        },
      });

      const persistedContent = buildPersistedPaperContent({
        paperId,
        extractedPdf,
      });

      const refinedSections = persistedContent.sections
        .map((section, index) => ({
          ...section,
          orderNo: index + 1,
        }));

      if (refinedSections.length > 0) {
        await tx.paperSection.createMany({
          data: refinedSections,
        });
      }

      if (persistedContent.chunks.length > 0) {
        const createdSections = await tx.paperSection.findMany({
          where: { paperId },
          select: {
            id: true,
            sectionKey: true,
          },
        });
        const sectionIdByKey = new Map(createdSections.map((section) => [section.sectionKey ?? '', section.id]));

        await tx.paperChunk.createMany({
          data: persistedContent.chunks
            .map(({ sectionKey, ...chunk }) => ({
              ...chunk,
              sectionId: sectionIdByKey.get(sectionKey) ?? null,
            })),
        });
      }

      if (persistedContent.references.length > 0) {
        await tx.referenceItem.createMany({
          data: persistedContent.references,
        });
      }

      if (persistedContent.figures.length > 0) {
        await tx.paperFigure.createMany({
          data: persistedContent.figures,
        });
      }

      return tx.paper.update({
        where: { id: paperId },
        data: {
          status: 'ready',
          parseStatus: 'completed',
          ragStatus: 'ready',
        },
        select: {
          id: true,
          status: true,
          parseStatus: true,
        },
      });
    });

    return NextResponse.json({
      item: updatedPaper,
    });
  } catch (error) {
    await prisma.paper.update({
      where: { id: paperId },
      data: {
        status: 'failed',
        parseStatus: 'failed',
      },
    }).catch(() => undefined);

    return NextResponse.json(
      {
        error: 'Failed to parse paper.',
        detail: error instanceof Error ? `[${failureStage}] ${error.message}` : `[${failureStage}] Unknown error`,
      },
      { status: 500 },
    );
  }
}

function buildRemotePdfUrl(sourcePlatform?: string | null, sourceUrl?: string | null, externalPaperId?: string | null) {
  const normalizedPlatform = sourcePlatform?.toLowerCase();

  if (normalizedPlatform === 'arxiv') {
    const arxivId = normalizeArxivId(externalPaperId) ?? normalizeArxivId(sourceUrl);

    if (arxivId) {
      return `https://arxiv.org/pdf/${arxivId}.pdf`;
    }
  }

  if (sourceUrl?.toLowerCase().endsWith('.pdf')) {
    return sourceUrl;
  }

  return null;
}

function normalizeArxivId(value?: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const matched = trimmed.match(/(?:arxiv\.org\/(?:abs|pdf)\/)?([^/?#]+?)(?:\.pdf)?$/i);
  return matched?.[1] ?? trimmed;
}
