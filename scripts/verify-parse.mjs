import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const paperId = 'cmnq1qb2b0007tlo0py89p9uo';

try {
  const [sections, figures, references, chunks] = await Promise.all([
    prisma.paperSection.count({ where: { paperId } }),
    prisma.paperFigure.count({ where: { paperId } }),
    prisma.referenceItem.count({ where: { paperId } }),
    prisma.paperChunk.count({ where: { paperId } }),
  ]);

  const sectionList = await prisma.paperSection.findMany({
    where: { paperId },
    orderBy: { orderNo: 'asc' },
    select: { title: true, sectionType: true, pageStart: true, pageEnd: true },
  });

  console.log(JSON.stringify({ counts: { sections, figures, references, chunks }, sections: sectionList }, null, 2));
} finally {
  await prisma.$disconnect();
}
