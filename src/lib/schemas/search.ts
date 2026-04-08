import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
  source: z.enum(['arxiv']).default('arxiv'),
  sort: z.enum(['relevance', 'latest']).default('relevance'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
