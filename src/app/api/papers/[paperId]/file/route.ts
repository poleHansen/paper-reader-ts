import { readFile, stat } from 'node:fs/promises';
import { prisma } from '@/lib/db/prisma';
import { getLocalPaperFileInfo } from '@/lib/server/paper-file';

interface RouteContext {
  params: Promise<{ paperId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const { paperId } = await context.params;

    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: {
        originalFilePath: true,
        title: true,
      },
    });

    if (!paper) {
      return new Response('Paper not found.', { status: 404 });
    }

    const localFile = await getLocalPaperFileInfo(paper.originalFilePath);

    if (!localFile) {
      return new Response('PDF file not found.', { status: 404 });
    }

    const fileStat = await stat(localFile.absolutePath).catch(() => null);

    if (!fileStat?.isFile()) {
      return new Response('PDF file not found.', { status: 404 });
    }

    const fileBuffer = await readFile(localFile.absolutePath);
    const fileName = `${(paper.title || 'paper').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'paper'}.pdf`;

    return new Response(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(fileBuffer.byteLength),
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: 'Failed to load local PDF.', detail }, { status: 500 });
  }
}
