import { NextResponse } from 'next/server';
import { DEFAULT_USER_ID } from '@/lib/constants/app';
import { prisma } from '@/lib/db/prisma';
import { buildPersistedPaperContent } from '@/lib/server/paper-processing';
import { saveUploadedPdf } from '@/lib/server/paper-upload';
import { extractPdfText } from '@/lib/server/pdf-text';

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid multipart form data.',
      },
      { status: 400 },
    );
  }

  const fileEntry = formData.get('file');
  const title = normalizeText(formData.get('title'));
  const abstract = normalizeText(formData.get('abstract'));
  const authors = normalizeAuthors(formData.get('authors'));
  const year = normalizeYear(formData.get('year'));

  if (!(fileEntry instanceof File)) {
    return NextResponse.json(
      {
        error: 'PDF file is required.',
      },
      { status: 400 },
    );
  }

  if (!title) {
    return NextResponse.json(
      {
        error: 'Title is required for uploaded PDFs.',
      },
      { status: 400 },
    );
  }

  try {
    const savedFile = await saveUploadedPdf(fileEntry);
    const extractedPdf = await extractPdfText(savedFile.absolutePath).catch(() => null);
    const hasStructuredSections = Boolean(extractedPdf?.inferredSections.some((section) => section.sectionType !== 'references' && section.content.trim().length >= 120));

    await prisma.user.upsert({
      where: { id: DEFAULT_USER_ID },
      update: {},
      create: {
        id: DEFAULT_USER_ID,
        displayName: 'Local User',
      },
    });

    const paper = await prisma.$transaction(async (tx) => {
      const createdPaper = await tx.paper.create({
        data: {
          userId: DEFAULT_USER_ID,
          sourceType: 'upload',
          sourcePlatform: 'local_pdf',
          title,
          abstract,
          authorsJson: JSON.stringify(authors),
          year,
          originalFilePath: savedFile.relativePath,
          status: 'uploaded',
          parseStatus: hasStructuredSections ? 'completed' : 'pending',
          analysisStatus: 'pending',
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

      if (persistedContent.figures.length > 0) {
        await tx.paperFigure.createMany({
          data: persistedContent.figures,
        });
      }

      if (persistedContent.references.length > 0) {
        await tx.referenceItem.createMany({
          data: persistedContent.references,
        });
      }

      if (persistedContent.chunks.length > 0 && persistedContent.sections.length > 0) {
        const sectionRows = await tx.paperSection.findMany({
          where: { paperId: createdPaper.id },
          select: { id: true, sectionKey: true },
        });

        const sectionIdByKey = new Map(sectionRows.map((section) => [section.sectionKey, section.id]));

        await tx.paperChunk.createMany({
          data: persistedContent.chunks.map(({ sectionKey, ...chunk }) => ({
            ...chunk,
            sectionId: sectionIdByKey.get(sectionKey) ?? null,
          })),
        });
      }

      return createdPaper;
    });

    return NextResponse.json({ item: paper }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    const status = /only pdf|empty|25 mb/i.test(detail) ? 400 : 500;

    return NextResponse.json(
      {
        error: 'Failed to upload PDF.',
        detail,
      },
      { status },
    );
  }
}

function normalizeText(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function normalizeAuthors(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') {
    return [] as string[];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function normalizeYear(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const parsedYear = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100 ? parsedYear : undefined;
}
