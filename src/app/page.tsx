import Link from 'next/link';
import { listPapers } from '@/lib/repositories/paper-repository';

export default async function HomePage() {
  let papers = [] as Awaited<ReturnType<typeof listPapers>>;
  let loadError: string | null = null;

  try {
    papers = await listPapers();
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unknown error';
  }

  const latestPaper = papers[0];

  return (
    <div className="page-stack">
      <section
        className="card"
        style={{ padding: '36px', display: 'grid', gap: '16px', overflow: 'hidden' }}
      >
        <span className="pill">Local-first workspace</span>
        <div style={{ display: 'grid', gap: '12px', maxWidth: '760px' }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-serif), serif',
              fontSize: 'clamp(40px, 7vw, 72px)',
              lineHeight: 0.95,
            }}
          >
            Read papers with a gated multi-agent workflow.
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '18px', lineHeight: 1.7 }}>
            Search arXiv, import papers into local storage, and use the paper detail page as the next handoff point for parsing and agent runs.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Link href="/search" style={primaryButton}>
            Search arXiv
          </Link>
          {latestPaper ? (
            <Link href={`/papers/${latestPaper.id}`} style={secondaryButton}>
              Open latest paper
            </Link>
          ) : null}
        </div>
      </section>

      {loadError ? (
        <section className="card" style={{ padding: '28px', display: 'grid', gap: '12px' }}>
          <span className="pill">Database setup needed</span>
          <h2 style={{ margin: 0, fontSize: '28px' }}>Prisma is not ready yet</h2>
          <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.7 }}>
            The app could not read papers from SQLite. Check your environment file and run the Prisma setup commands before loading data.
          </p>
          <pre
            style={{
              margin: 0,
              padding: '16px',
              borderRadius: '16px',
              background: '#fffaf1',
              border: '1px solid var(--border)',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--muted)',
            }}
          >
            {loadError}
          </pre>
        </section>
      ) : papers.length === 0 ? (
        <section className="card" style={{ padding: '28px', display: 'grid', gap: '12px' }}>
          <span className="pill">No papers yet</span>
          <h2 style={{ margin: 0, fontSize: '28px' }}>Import your first paper</h2>
          <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.7 }}>
            Start from search, then save a result into the local database. The paper list and detail page will update from SQLite instead of fixtures.
          </p>
        </section>
      ) : (
        <section className="page-stack" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {papers.map((paper) => (
            <article key={paper.id} className="card" style={{ padding: '24px', display: 'grid', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span className="pill">{paper.status}</span>
                <span style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  {new Intl.DateTimeFormat('zh-CN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(paper.updatedAt)}
                </span>
              </div>
              <div style={{ display: 'grid', gap: '8px' }}>
                <h2 style={{ margin: 0, fontSize: '24px', lineHeight: 1.2 }}>
                  {paper.title ?? 'Untitled paper'}
                </h2>
                <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.6 }}>
                  {paper.abstract ?? 'No abstract yet.'}
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                <strong>{paper.sourcePlatform ?? 'local'}</strong>
                <Link href={`/papers/${paper.id}`} style={textLink}>
                  Open detail
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: '999px',
  background: 'var(--accent)',
  color: '#fff7f0',
  fontWeight: 700,
};

const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  background: 'transparent',
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
};

const textLink: React.CSSProperties = {
  color: 'var(--accent)',
  fontWeight: 700,
};
