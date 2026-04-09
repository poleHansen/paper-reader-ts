import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const paperId = process.argv[2];
const filePathArg = process.argv[3];

if (!paperId || !filePathArg) {
  console.error('Usage: node scripts/debug-parse.mjs <paperId> <pdfAbsolutePath>');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const pdfTextModule = await import(pathToFileURL(path.join(root, 'src/lib/server/pdf-text.ts')).href);
  const result = await pdfTextModule.extractPdfText(filePathArg);

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      sections: true,
      figures: true,
      references: true,
      chunks: true,
    },
  });

  console.log(JSON.stringify({
    extraction: {
      pageCount: result.pageCount,
      sectionCount: result.inferredSections.length,
      segmentCount: result.pageLikeSegments.length,
      preview: result.previewText.slice(0, 400),
      firstSections: result.inferredSections.slice(0, 5).map((section) => ({
        title: section.title,
        type: section.sectionType,
        len: section.content.length,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
      })),
    },
    paper: {
      exists: Boolean(paper),
      parseStatus: paper?.parseStatus,
      status: paper?.status,
      originalFilePath: paper?.originalFilePath,
      counts: {
        sections: paper?.sections.length ?? 0,
        figures: paper?.figures.length ?? 0,
        references: paper?.references.length ?? 0,
        chunks: paper?.chunks.length ?? 0,
      },
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
