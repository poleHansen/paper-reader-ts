import { z } from 'zod';
import { supportedProviderSchema } from '@/lib/schemas/provider';

export const modelConnectionTestSchema = z.object({
  provider: supportedProviderSchema,
  apiMode: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().max(2048).optional().or(z.literal('')),
  apiKey: z.string().trim().min(1).max(500),
});

export const githubConnectionTestSchema = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  branch: z.string().trim().min(1).max(100),
  token: z.string().trim().min(1).max(500),
});
