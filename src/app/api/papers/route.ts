import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_USER_ID } from '@/lib/constants/app';
import { prisma } from '@/lib/db/prisma';
import { listPapers } from '@/lib/repositories/paper-repository';
import { createPaperSchema } from '@/lib/schemas/paper';
import { buildPersistedPaperContent } from '@/lib/server/paper-processing';
import { extractPdfText } from '@/lib/server/pdf-text';
import { downloadRemotePdf } from '@/lib/server/paper-upload';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const papers = await listPapers();

    return NextResponse.json({
      items: papers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to list papers.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid JSON body.',
      },
      { status: 400 },
    );
  }

  const parsed = createPaperSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid paper payload.',
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    await prisma.user.upsert({
      where: { id: DEFAULT_USER_ID },
      update: {},
      create: {
        id: DEFAULT_USER_ID,
        displayName: 'Local User',
      },
    });

    const existingPaper =
      parsed.data.sourcePlatform && parsed.data.externalPaperId
        ? await prisma.paper.findFirst({
            where: {
              userId: DEFAULT_USER_ID,
              sourcePlatform: parsed.data.sourcePlatform,
              externalPaperId: parsed.data.externalPaperId,
            },
            select: {
              id: true,
              title: true,
              abstract: true,
              status: true,
              updatedAt: true,
              sourcePlatform: true,
            },
          })
        : null;

    if (existingPaper) {
      return NextResponse.json({ item: existingPaper, duplicate: true });
    }

    const shouldFetchPdf = Boolean(parsed.data.pdfUrl);
    const savedFile = shouldFetchPdf ? await downloadRemotePdf(parsed.data.pdfUrl!, parsed.data.externalPaperId ?? parsed.data.title) : null;
    const extractedPdf = savedFile ? await extractPdfText(savedFile.absolutePath).catch(() => null) : null;
    const hasStructuredSections = Boolean(extractedPdf?.inferredSections.some((section) => section.sectionType !== 'references' && section.content.trim().length >= 120));
    const normalizedSourcePlatform = parsed.data.sourcePlatform ?? inferSourcePlatform(parsed.data.sourceUrl, parsed.data.pdfUrl);

    const paper = await prisma.$transaction(async (tx) => {
      const createdPaper = await tx.paper.create({
        data: {
          userId: DEFAULT_USER_ID,
          sourceType: parsed.data.sourceType,
          sourcePlatform: normalizedSourcePlatform,
          externalPaperId: parsed.data.externalPaperId,
          sourceUrl: parsed.data.sourceUrl,
          title: parsed.data.title,
          abstract: parsed.data.abstract,
          authorsJson: JSON.stringify(parsed.data.authors),
          year: parsed.data.year,
          originalFilePath: savedFile?.relativePath,
          status: 'uploaded',
          parseStatus: hasStructuredSections ? 'completed' : 'pending',
          analysisStatus: 'pending',
          ragStatus: hasStructuredSections ? 'ready' : 'pending',
        },
        select: {
          id: true,
          title: true,
          abstract: true,
          status: true,
          updatedAt: true,
          sourcePlatform: true,
          originalFilePath: true,
        },
      });

      const persistedContent = buildPersistedPaperContent({
        paperId: createdPaper.id,
        extractedPdf,
      });

      if (persistedContent.sections.length > 0) {
        await tx.paperSection.createMany({
          data: persistedContent.sections,
        });
      }

      if (persistedContent.chunks.length > 0) {
        const createdSections = await tx.paperSection.findMany({
          where: { paperId: createdPaper.id },
          select: {
            id: true,
            sectionKey: true,
          },
        });
        const sectionIdByKey = new Map(createdSections.map((section) => [section.sectionKey ?? '', section.id]));

        await tx.paperChunk.createMany({
          data: persistedContent.chunks.map(({ sectionKey, ...chunk }) => ({
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

      return createdPaper;
    });

    return NextResponse.json({ item: paper }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to create paper.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

function inferSourcePlatform(sourceUrl?: string, pdfUrl?: string) {
  const candidate = `${sourceUrl ?? ''} ${pdfUrl ?? ''}`.toLowerCase();

  if (candidate.includes('arxiv.org')) {
    return 'arxiv';
  }

  if (candidate.includes('.pdf')) {
    return 'pdf_url';
  }

  return 'url_import';
}
