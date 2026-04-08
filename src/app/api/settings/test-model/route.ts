import { NextRequest, NextResponse } from 'next/server';
import { testModelConnection } from '@/lib/llm/test';
import { modelConnectionTestSchema } from '@/lib/schemas/settings-test';

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

  const parsed = modelConnectionTestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid model test payload.',
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await testModelConnection({
      provider: parsed.data.provider,
      apiMode: parsed.data.apiMode,
      model: parsed.data.model,
      baseUrl: parsed.data.baseUrl || undefined,
      apiKey: parsed.data.apiKey,
    });

    return NextResponse.json({
      ok: true,
      message: `Connected to ${result.provider} successfully. Sample response: ${result.text.slice(0, 80)}`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    const status = /unsupported provider|base url is required|configuration/i.test(detail) ? 400 : 502;

    return NextResponse.json(
      {
        ok: false,
        error: 'Model connection test failed.',
        detail,
      },
      { status },
    );
  }
}
