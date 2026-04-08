import { z } from 'zod';

export const createPaperSchema = z.object({
  sourceType: z.enum(['search_import', 'url', 'upload']).default('search_import'),
  sourcePlatform: z.string().trim().min(1).max(50).optional(),
  externalPaperId: z.string().trim().min(1).max(100).optional(),
  sourceUrl: z.string().trim().url().max(2048).optional(),
  pdfUrl: z.string().trim().url().max(2048).optional(),
  title: z.string().trim().min(1).max(500),
  abstract: z.string().trim().min(1).max(20000),
  authors: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  year: z.number().int().min(1900).max(2100).optional(),
});

export type CreatePaperInput = z.infer<typeof createPaperSchema>;
