import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { generateTextWithDefaultModel } from '@/lib/llm/generate';

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

    await prisma.paper.update({
      where: { id: paperId },
      data: {
        status: 'parsing',
        parseStatus: 'running',
      },
    });

    const generated = await generateTextWithDefaultModel({
      system: 'You are a scientific paper reading assistant. Return concise academic markdown.',
      prompt: [`Summarize the following paper abstract into three parts:`, `1. Core problem`, `2. Main approach`, `3. Key contribution`, '', `Title: ${paper.title ?? 'Untitled paper'}`, '', `Abstract:`, abstract].join('\n'),
    });

    const updatedPaper = await prisma.$transaction(async (tx) => {
      await tx.paperSection.deleteMany({
        where: { paperId },
      });

      await tx.paperSection.create({
        data: {
          paperId,
          sectionType: 'abstract_summary',
          sectionKey: 'abstract-summary',
          title: sectionTitle,
          orderNo: 1,
          content: generated.text,
          tokenCount: generated.text.split(/\s+/).filter(Boolean).length,
        },
      });

      return tx.paper.update({
        where: { id: paperId },
        data: {
          status: 'ready',
          parseStatus: 'completed',
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
