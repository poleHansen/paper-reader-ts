import { DEFAULT_USER_ID } from '@/lib/constants/app';
import { prisma } from '@/lib/db/prisma';
import { decodeSecret } from '@/lib/security/secrets';
import { buildProviderTextRequest, extractProviderText, resolveProviderConfig, type SupportedProvider } from '@/lib/llm/providers';

interface GenerateTextInput {
  prompt: string;
  system?: string;
}

export async function generateTextWithDefaultModel(input: GenerateTextInput) {
  const modelConfig = await prisma.modelConfig.findFirst({
    where: {
      userId: DEFAULT_USER_ID,
      isDefault: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!modelConfig) {
    throw new Error('No default model is configured.');
  }

  const provider = resolveProviderConfig(modelConfig.provider);

  if (!provider) {
    throw new Error('Unsupported provider configuration.');
  }

  const apiKey = decodeSecret(modelConfig.encryptedApiKey)?.trim();

  if (!apiKey) {
    throw new Error('Model API key is not configured.');
  }

  const requestConfig = buildProviderTextRequest({
    provider: modelConfig.provider as SupportedProvider,
    apiMode: modelConfig.apiMode,
    model: modelConfig.model,
    baseUrl: modelConfig.baseUrl ?? undefined,
    apiKey,
    prompt: input.prompt,
    system: input.system,
    temperature: modelConfig.temperature ?? undefined,
    maxTokens: modelConfig.maxTokens ?? undefined,
  });

  const response = await fetch(requestConfig.url, {
    method: requestConfig.method,
    headers: requestConfig.headers,
    body: JSON.stringify(requestConfig.body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 500) || 'Model request failed.');
  }

  const data = (await response.json()) as unknown;
  const text = extractProviderText(provider.id, data)?.trim();

  if (!text) {
    throw new Error('Model returned an empty response.');
  }

  return {
    text,
    model: modelConfig.model,
    provider: provider.label,
  };
}
