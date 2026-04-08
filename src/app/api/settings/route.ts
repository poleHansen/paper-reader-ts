import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_USER_ID } from '@/lib/constants/app';
import { prisma } from '@/lib/db/prisma';
import { decodeSecret, encodeSecret } from '@/lib/security/secrets';
import { settingsPayloadSchema } from '@/lib/schemas/settings';

export async function GET() {
  try {
    const user = await prisma.user.findUnique({
      where: { id: DEFAULT_USER_ID },
      include: {
        modelConfigs: {
          where: { isDefault: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        githubConfig: true,
      },
    });

    const modelConfig = user?.modelConfigs[0] ?? null;

    return NextResponse.json({
      profile: {
        displayName: user?.displayName ?? '',
        role: user?.role ?? '',
        researchDirection: user?.researchDirection ?? '',
        researchInterests: user?.researchInterests ?? '',
        keywords: parseKeywords(user?.keywordsJson),
      },
      model: {
        provider: modelConfig?.provider ?? 'openai',
        apiMode: modelConfig?.apiMode ?? 'responses',
        model: modelConfig?.model ?? 'gpt-4.1-mini',
        baseUrl: modelConfig?.baseUrl ?? '',
        apiKey: decodeSecret(modelConfig?.encryptedApiKey),
        temperature: modelConfig?.temperature ?? 0.2,
        maxTokens: modelConfig?.maxTokens ?? 4000,
      },
      github: {
        owner: user?.githubConfig?.owner ?? '',
        repo: user?.githubConfig?.repo ?? '',
        branch: user?.githubConfig?.branch ?? 'main',
        basePath: user?.githubConfig?.basePath ?? '',
        token: decodeSecret(user?.githubConfig?.encryptedToken),
        isEnabled: user?.githubConfig?.isEnabled ?? false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load settings.',
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

  const parsed = settingsPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid settings payload.',
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({
        where: { id: DEFAULT_USER_ID },
        update: {
          displayName: parsed.data.profile.displayName || null,
          role: parsed.data.profile.role || null,
          researchDirection: parsed.data.profile.researchDirection || null,
          researchInterests: parsed.data.profile.researchInterests || null,
          keywordsJson: JSON.stringify(parsed.data.profile.keywords),
        },
        create: {
          id: DEFAULT_USER_ID,
          displayName: parsed.data.profile.displayName || null,
          role: parsed.data.profile.role || null,
          researchDirection: parsed.data.profile.researchDirection || null,
          researchInterests: parsed.data.profile.researchInterests || null,
          keywordsJson: JSON.stringify(parsed.data.profile.keywords),
        },
      });

      await tx.modelConfig.updateMany({
        where: {
          userId: DEFAULT_USER_ID,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });

      await tx.modelConfig.create({
        data: {
          userId: DEFAULT_USER_ID,
          provider: parsed.data.model.provider,
          apiMode: parsed.data.model.apiMode,
          model: parsed.data.model.model,
          baseUrl: parsed.data.model.baseUrl || null,
          encryptedApiKey: encodeSecret(parsed.data.model.apiKey),
          temperature: parsed.data.model.temperature ?? null,
          maxTokens: parsed.data.model.maxTokens ?? null,
          isDefault: true,
        },
      });

      await tx.gitHubConfig.upsert({
        where: { userId: DEFAULT_USER_ID },
        update: {
          owner: parsed.data.github.owner,
          repo: parsed.data.github.repo,
          branch: parsed.data.github.branch || 'main',
          basePath: parsed.data.github.basePath || null,
          encryptedToken: encodeSecret(parsed.data.github.token),
          isEnabled: parsed.data.github.isEnabled,
        },
        create: {
          userId: DEFAULT_USER_ID,
          owner: parsed.data.github.owner,
          repo: parsed.data.github.repo,
          branch: parsed.data.github.branch || 'main',
          basePath: parsed.data.github.basePath || null,
          encryptedToken: encodeSecret(parsed.data.github.token),
          isEnabled: parsed.data.github.isEnabled,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to save settings.',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

function parseKeywords(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
