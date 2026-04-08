import { NextRequest, NextResponse } from 'next/server';
import { searchArxiv } from '@/lib/arxiv';
import { searchQuerySchema } from '@/lib/schemas/search';

export async function GET(request: NextRequest) {
  const parsed = searchQuerySchema.safeParse({
    query: request.nextUrl.searchParams.get('query') ?? '',
    source: request.nextUrl.searchParams.get('source') ?? 'arxiv',
    sort: request.nextUrl.searchParams.get('sort') ?? 'relevance',
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid search parameters.',
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const items = await searchArxiv(parsed.data);

    return NextResponse.json({
      query: parsed.data,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to search papers.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 },
    );
  }
}
