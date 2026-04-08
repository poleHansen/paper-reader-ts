import { stat } from 'node:fs/promises';
import path from 'node:path';

export interface LocalPaperFileInfo {
  relativePath: string;
  absolutePath: string;
  size: number;
}

export async function getLocalPaperFileInfo(relativePath: string | null | undefined): Promise<LocalPaperFileInfo | null> {
  if (!relativePath) {
    return null;
  }

  const normalizedRelativePath = normalizeRelativePaperPath(relativePath);

  if (!normalizedRelativePath) {
    return null;
  }

  const absolutePath = path.join(process.cwd(), normalizedRelativePath);
  const fileStat = await stat(absolutePath).catch(() => null);

  if (!fileStat?.isFile()) {
    return null;
  }

  return {
    relativePath: normalizedRelativePath,
    absolutePath,
    size: fileStat.size,
  };
}

export function normalizeRelativePaperPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').trim().replace(/^\/+/, '');

  if (!normalized.startsWith('storage/papers/')) {
    return null;
  }

  if (normalized.includes('..')) {
    return null;
  }

  return normalized;
}
