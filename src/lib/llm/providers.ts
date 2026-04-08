export type SupportedProvider = 'openai' | 'openai-compatible' | 'anthropic' | 'google';

export interface ProviderDefinition {
  id: SupportedProvider;
  label: string;
  defaultApiMode: string;
  defaultModel: string;
  defaultBaseUrl: string;
  requiresBaseUrl: boolean;
  testPath: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
}

interface BuildTextRequestInput {
  provider: SupportedProvider;
  apiMode: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ProviderTextRequest {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const providerDefinitions: Record<SupportedProvider, ProviderDefinition> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultApiMode: 'responses',
    defaultModel: 'gpt-4.1-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresBaseUrl: false,
    testPath: '/models',
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
    }),
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    defaultApiMode: 'chat-completions',
    defaultModel: '',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    testPath: '/models',
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
    }),
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultApiMode: 'messages',
    defaultModel: 'claude-3-5-haiku-latest',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    requiresBaseUrl: false,
    testPath: '/models',
    buildHeaders: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
  google: {
    id: 'google',
    label: 'Google AI Studio',
    defaultApiMode: 'generate-content',
    defaultModel: 'gemini-2.0-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresBaseUrl: false,
    testPath: '/models',
    buildHeaders: () => ({}),
  },
};

export const providerOptions = Object.values(providerDefinitions).map(({ id, label }) => ({
  value: id,
  label,
}));

export function isSupportedProvider(value: string): value is SupportedProvider {
  return value in providerDefinitions;
}

export function resolveProviderConfig(provider: string) {
  if (!isSupportedProvider(provider)) {
    return null;
  }

  return providerDefinitions[provider];
}

export function resolveProviderBaseUrl(provider: SupportedProvider, baseUrl?: string) {
  const definition = providerDefinitions[provider];
  const candidate = (baseUrl || definition.defaultBaseUrl).trim();
  return candidate.replace(/\/+$/, '');
}

export function buildProviderTestRequest(provider: SupportedProvider, apiKey: string, baseUrl?: string) {
  const definition = providerDefinitions[provider];
  const normalizedBaseUrl = resolveProviderBaseUrl(provider, baseUrl);

  if (definition.requiresBaseUrl && !normalizedBaseUrl) {
    throw new Error('Base URL is required for this provider.');
  }

  if (provider === 'google') {
    const url = new URL(`${normalizedBaseUrl}${definition.testPath}`);
    url.searchParams.set('key', apiKey);

    return {
      url: url.toString(),
      headers: definition.buildHeaders(apiKey),
    };
  }

  return {
    url: `${normalizedBaseUrl}${definition.testPath}`,
    headers: definition.buildHeaders(apiKey),
  };
}

export function buildProviderTextRequest(input: BuildTextRequestInput): ProviderTextRequest {
  const normalizedBaseUrl = resolveProviderBaseUrl(input.provider, input.baseUrl);

  if (!normalizedBaseUrl) {
    throw new Error('Base URL is required for this provider.');
  }

  if (input.provider === 'anthropic') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...providerDefinitions.anthropic.buildHeaders(input.apiKey),
    };

    return {
      method: 'POST',
      url: `${normalizedBaseUrl}/messages`,
      headers,
      body: {
        model: input.model,
        system: input.system,
        max_tokens: input.maxTokens ?? 1024,
        temperature: input.temperature,
        messages: [{ role: 'user', content: input.prompt }],
      },
    };
  }

  if (input.provider === 'google') {
    const url = new URL(`${normalizedBaseUrl}/models/${encodeURIComponent(input.model)}:generateContent`);
    url.searchParams.set('key', input.apiKey);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    return {
      method: 'POST',
      url: url.toString(),
      headers,
      body: {
        systemInstruction: input.system
          ? {
              parts: [{ text: input.system }],
            }
          : undefined,
        generationConfig: {
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens ?? undefined,
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: input.prompt }],
          },
        ],
      },
    };
  }

  if (input.apiMode === 'responses' && input.provider === 'openai') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...providerDefinitions.openai.buildHeaders(input.apiKey),
    };

    return {
      method: 'POST',
      url: `${normalizedBaseUrl}/responses`,
      headers,
      body: {
        model: input.model,
        temperature: input.temperature,
        max_output_tokens: input.maxTokens ?? undefined,
        input: [
          ...(input.system ? [{ role: 'system', content: [{ type: 'input_text', text: input.system }] }] : []),
          { role: 'user', content: [{ type: 'input_text', text: input.prompt }] },
        ],
      },
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`,
  };

  return {
    method: 'POST',
    url: `${normalizedBaseUrl}/chat/completions`,
    headers,
    body: {
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.maxTokens ?? undefined,
      messages: [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: input.prompt },
      ],
    },
  };
}

export function extractProviderText(provider: SupportedProvider, payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (provider === 'anthropic') {
    const content = (payload as { content?: Array<{ type?: string; text?: string }> }).content;
    return content?.find((item) => item.type === 'text')?.text ?? null;
  }

  if (provider === 'google') {
    const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
    return candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n').trim() || null;
  }

  const responseOutput = (payload as { output_text?: string }).output_text;

  if (typeof responseOutput === 'string' && responseOutput.trim()) {
    return responseOutput;
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices;
    return choices?.[0]?.message?.content ?? null;
}
