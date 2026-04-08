import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_USER_ID } from '@/lib/constants/app';
import { prisma } from '@/lib/db/prisma';
import { listPapers } from '@/lib/repositories/paper-repository';
import { createPaperSchema } from '@/lib/schemas/paper';

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

    const paper = await prisma.paper.create({
      data: {
        userId: DEFAULT_USER_ID,
        sourceType: parsed.data.sourceType,
        sourcePlatform: parsed.data.sourcePlatform,
        externalPaperId: parsed.data.externalPaperId,
        sourceUrl: parsed.data.sourceUrl,
        title: parsed.data.title,
        abstract: parsed.data.abstract,
        authorsJson: JSON.stringify(parsed.data.authors),
        year: parsed.data.year,
        status: 'uploaded',
        parseStatus: 'pending',
        analysisStatus: 'pending',
      },
      select: {
        id: true,
        title: true,
        abstract: true,
        status: true,
        updatedAt: true,
        sourcePlatform: true,
      },
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
