import { z } from 'zod';

export const supportedProviderSchema = z.enum(['openai', 'openai-compatible', 'anthropic', 'google']);

export type SupportedProvider = z.infer<typeof supportedProviderSchema>;
