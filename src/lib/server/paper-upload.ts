import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_PDF_FILE_SIZE = 25 * 1024 * 1024;

export interface SavedUploadFile {
  relativePath: string;
  absolutePath: string;
  fileName: string;
  size: number;
}

export async function saveUploadedPdf(file: File): Promise<SavedUploadFile> {
  if (file.type !== 'application/pdf') {
    throw new Error('Only PDF uploads are supported.');
  }

  if (file.size <= 0) {
    throw new Error('Uploaded PDF is empty.');
  }

  if (file.size > MAX_PDF_FILE_SIZE) {
    throw new Error('PDF exceeds the 25 MB upload limit.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return savePdfBuffer(buffer, file.name, file.size);
}

export async function downloadRemotePdf(pdfUrl: string, fileNameHint: string): Promise<SavedUploadFile> {
  const response = await fetch(pdfUrl, {
    headers: {
      Accept: 'application/pdf',
      'User-Agent': 'paper-reader-ts/0.1 (+https://arxiv.org)',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`PDF download failed with status ${response.status}.`);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!contentType.includes('application/pdf')) {
    throw new Error('Remote file is not a PDF.');
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);

  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_FILE_SIZE) {
    throw new Error('PDF exceeds the 25 MB upload limit.');
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength <= 0) {
    throw new Error('Downloaded PDF is empty.');
  }

  if (buffer.byteLength > MAX_PDF_FILE_SIZE) {
    throw new Error('PDF exceeds the 25 MB upload limit.');
  }

  return savePdfBuffer(buffer, `${fileNameHint}.pdf`, buffer.byteLength);
}

async function savePdfBuffer(buffer: Buffer, fileNameHint: string, size: number): Promise<SavedUploadFile> {
  const safeBaseName = sanitizePdfBaseName(fileNameHint);
  const folderName = createDatedFolderName(new Date());
  const fileName = `${safeBaseName}-${randomUUID()}.pdf`;
  const relativePath = path.join('storage', 'papers', folderName, fileName);
  const absolutePath = path.join(process.cwd(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer, { flag: 'wx' });

  return {
    relativePath: relativePath.split(path.sep).join('/'),
    absolutePath,
    fileName,
    size,
  };
}

function sanitizePdfBaseName(fileName: string) {
  const trimmed = path.basename(fileName, path.extname(fileName)).trim().toLowerCase();
  const normalized = trimmed.replace(/[^a-z0-9-_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'paper';
}

function createDatedFolderName(date: Date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
