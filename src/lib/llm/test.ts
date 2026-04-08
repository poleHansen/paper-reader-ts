import { buildProviderTextRequest, extractProviderText, resolveProviderConfig, type SupportedProvider } from '@/lib/llm/providers';

interface TestModelConnectionInput {
  provider: SupportedProvider;
  apiMode: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

export async function testModelConnection(input: TestModelConnectionInput) {
  const provider = resolveProviderConfig(input.provider);

  if (!provider) {
    throw new Error('Unsupported provider.');
  }

  const requestConfig = buildProviderTextRequest({
    provider: input.provider,
    apiMode: input.apiMode,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    system: 'Reply briefly for connection testing.',
    prompt: 'Return exactly: ok',
    temperature: 0,
    maxTokens: 16,
  });

  const response = await fetch(requestConfig.url, {
    method: requestConfig.method,
    headers: requestConfig.headers,
    body: JSON.stringify(requestConfig.body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 500) || 'Model test failed.');
  }

  const payload = (await response.json()) as unknown;
  const text = extractProviderText(input.provider, payload)?.trim();

  if (!text) {
    throw new Error('Model returned an empty response.');
  }

  return {
    provider: provider.label,
    text,
  };
}
