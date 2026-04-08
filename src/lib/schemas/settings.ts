import { z } from 'zod';
import { supportedProviderSchema } from '@/lib/schemas/provider';

export const settingsPayloadSchema = z.object({
  profile: z.object({
    displayName: z.string().trim().max(100).optional().default(''),
    role: z.string().trim().max(100).optional().default(''),
    researchDirection: z.string().trim().max(500).optional().default(''),
    researchInterests: z.string().trim().max(1000).optional().default(''),
    keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  }),
  model: z.object({
    provider: supportedProviderSchema,
    apiMode: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    baseUrl: z.string().trim().url().max(2048).optional().or(z.literal('')),
    apiKey: z.string().max(500).optional().default(''),
    temperature: z.number().min(0).max(2).nullable().optional(),
    maxTokens: z.number().int().min(1).max(200000).nullable().optional(),
  }),
  github: z.object({
    owner: z.string().trim().max(100).optional().default(''),
    repo: z.string().trim().max(100).optional().default(''),
    branch: z.string().trim().max(100).optional().default('main'),
    basePath: z.string().trim().max(500).optional().default(''),
    token: z.string().max(500).optional().default(''),
    isEnabled: z.boolean().default(false),
  }),
});

export type SettingsPayload = z.infer<typeof settingsPayloadSchema>;
