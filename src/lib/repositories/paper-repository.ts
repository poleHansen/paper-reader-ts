import { prisma } from '@/lib/db/prisma';

export async function listPapers() {
  return prisma.paper.findMany({
    orderBy: {
      updatedAt: 'desc',
    },
    select: {
      id: true,
      title: true,
      abstract: true,
      status: true,
      updatedAt: true,
      sourcePlatform: true,
    },
    take: 20,
  });
}

export async function getPaperById(paperId: string) {
  return prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      sections: {
        orderBy: {
          orderNo: 'asc',
        },
      },
      figures: {
        orderBy: {
          orderNo: 'asc',
        },
      },
      references: {
        orderBy: {
          orderNo: 'asc',
        },
      },
      agentRuns: true,
      literatureCard: true,
    },
  });
}
