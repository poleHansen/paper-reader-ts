import { NextRequest, NextResponse } from 'next/server';
import { githubConnectionTestSchema } from '@/lib/schemas/settings-test';

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

  const parsed = githubConnectionTestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid GitHub test payload.',
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(parsed.data.owner)}/${encodeURIComponent(parsed.data.repo)}/branches/${encodeURIComponent(parsed.data.branch)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${parsed.data.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        {
          ok: false,
          error: 'GitHub connection test failed.',
          detail: detail.slice(0, 500),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Connected to ${parsed.data.owner}/${parsed.data.repo} successfully.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: 'GitHub connection test failed.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 },
    );
  }
}
