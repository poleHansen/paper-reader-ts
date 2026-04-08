import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { generateTextWithDefaultModel } from '@/lib/llm/generate';
import { getLocalPaperFileInfo } from '@/lib/server/paper-file';
import { buildPersistedPaperContent } from '@/lib/server/paper-processing';
import { extractPdfText } from '@/lib/server/pdf-text';

interface RouteContext {
  params: Promise<{ paperId: string }>;
}

export async function POST(_: Request, context: RouteContext) {
  const { paperId } = await context.params;

  try {
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: {
        id: true,
        title: true,
        abstract: true,
        originalFilePath: true,
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

    const abstract = paper.abstract?.trim() || 'No abstract available for this paper yet.';
    const sectionTitle = paper.title ? `${paper.title} summary` : 'Imported paper summary';
    const localFile = await getLocalPaperFileInfo(paper.originalFilePath);
    const extractedPdf = localFile ? await extractPdfText(localFile.absolutePath) : null;
    const promptSections = [
      'Summarize the following paper context into three parts:',
      '1. Core problem',
      '2. Main approach',
      '3. Key contribution',
      '',
      `Title: ${paper.title ?? 'Untitled paper'}`,
      '',
    ];

    if (localFile) {
      promptSections.push(`Local PDF path: ${localFile.relativePath}`);
      promptSections.push(`Local PDF size: ${localFile.size} bytes`);
      promptSections.push(`Estimated pages: ${extractedPdf?.pageCount ?? 0}`);
      promptSections.push('');
    }

    if (extractedPdf?.inferredSections.length) {
      promptSections.push('Detected sections:');
      extractedPdf.inferredSections.forEach((section) => {
        promptSections.push(`## ${section.title}`);
        promptSections.push(section.content.slice(0, 2500));
        promptSections.push('');
      });
    } else if (extractedPdf?.previewText) {
      promptSections.push('PDF extracted text preview:');
      promptSections.push(extractedPdf.previewText);
      promptSections.push('');
    }

    promptSections.push('Abstract:');
    promptSections.push(abstract);

    await prisma.paper.update({
      where: { id: paperId },
      data: {
        status: 'parsing',
        parseStatus: 'running',
      },
    });

    const generated = await generateTextWithDefaultModel({
      system: 'You are a scientific paper reading assistant. Return concise academic markdown. If extracted PDF text is noisy, rely on the abstract and any readable fragments only.',
      prompt: promptSections.join('\n'),
    });

    const updatedPaper = await prisma.$transaction(async (tx) => {
      await tx.paperChunk.deleteMany({
        where: { paperId },
      });

      await tx.paperSection.deleteMany({
        where: {
          paperId,
          sectionType: {
            not: 'abstract_summary',
          },
        },
      });

      await tx.paperSection.updateMany({
        where: {
          paperId,
          sectionType: 'abstract_summary',
        },
        data: {
          title: sectionTitle,
          content: generated.text,
          tokenCount: generated.text.split(/\s+/).filter(Boolean).length,
          orderNo: 1,
        },
      });

      const persistedContent = buildPersistedPaperContent({
        paperId,
        title: paper.title ?? 'Imported paper',
        abstract: undefined,
        extractedPdf,
      });

      const refinedSections = persistedContent.sections
        .filter((section) => section.sectionType !== 'abstract_summary')
        .map((section, index) => ({
          ...section,
          orderNo: index + 2,
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
            .filter((chunk) => chunk.sectionKey !== 'abstract-summary')
            .map(({ sectionKey, ...chunk }) => ({
              ...chunk,
              sectionId: sectionIdByKey.get(sectionKey) ?? null,
            })),
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
      meta: {
        provider: generated.provider,
        model: generated.model,
      },
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
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
