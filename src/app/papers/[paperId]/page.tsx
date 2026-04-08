import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ParsePaperButton } from '@/components/paper/parse-paper-button';
import { getPaperById } from '@/lib/repositories/paper-repository';

export default async function PaperDetailPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  const paper = await getPaperById(paperId);

  if (!paper) {
    notFound();
  }

  const authors = parseJsonArray(paper.authorsJson);

  return (
    <div className="page-stack">
      <section className="card" style={{ padding: '28px', display: 'grid', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: '10px' }}>
            <span className="pill">Paper detail</span>
            <h1 style={{ margin: 0, fontSize: '42px' }}>{paper.title ?? 'Untitled paper'}</h1>
            <p style={{ margin: 0, color: 'var(--muted)', maxWidth: '760px', lineHeight: 1.7 }}>
              {paper.abstract ?? 'No abstract yet.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'start', flexWrap: 'wrap' }}>
            <ParsePaperButton paperId={paper.id} />
            <Link href="/search" style={secondaryButton}>
              Import more papers
            </Link>
            <Link href="/" style={primaryButton}>
              Back to list
            </Link>
          </div>
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '220px minmax(0, 1fr) 300px',
          gap: '18px',
          alignItems: 'start',
        }}
      >
        <aside className="card" style={{ padding: '20px', display: 'grid', gap: '12px' }}>
          {['Overview', 'Sections', 'Figures', 'References', 'Agent runs', 'Notes'].map((item, index) => (
            <div key={item} style={{ fontWeight: index === 0 ? 700 : 500, color: index === 0 ? 'var(--accent)' : 'inherit' }}>
              {item}
            </div>
          ))}
        </aside>

        <div className="page-stack">
          <section className="card" style={{ padding: '24px', display: 'grid', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <span className="pill">Overview</span>
                <h2 style={{ margin: '10px 0 0', fontSize: '30px' }}>Paper metadata</h2>
              </div>
              <div style={{ color: 'var(--accent)', fontWeight: 700 }}>Status: {paper.status}</div>
            </div>
            <div
              style={{
                minHeight: '280px',
                borderRadius: '20px',
                background: '#fffaf1',
                border: '1px solid var(--border)',
                padding: '18px',
                lineHeight: 1.75,
                color: 'var(--foreground)',
                display: 'grid',
                gap: '12px',
              }}
            >
              <div>
                <strong>Source</strong>
                <div>{paper.sourcePlatform ?? 'local'}{paper.externalPaperId ? ` · ${paper.externalPaperId}` : ''}</div>
              </div>
              <div>
                <strong>Year</strong>
                <div>{paper.year ?? 'Unknown'}</div>
              </div>
              <div>
                <strong>Authors</strong>
                <div>{authors.length > 0 ? authors.join(', ') : 'No authors imported yet.'}</div>
              </div>
              <div>
                <strong>Original link</strong>
                <div>
                  {paper.sourceUrl ? (
                    <a href={paper.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 700 }}>
                      Open source
                    </a>
                  ) : (
                    'No source URL yet.'
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="card" style={{ padding: '24px', display: 'grid', gap: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '24px' }}>Parsed sections</h3>
            <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
              Sections: {paper.sections.length} · Figures: {paper.figures.length} · References: {paper.references.length} · Agent runs: {paper.agentRuns.length}
            </div>
            {paper.sections.length === 0 ? (
              <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
                No parsed sections yet. Run parse to generate the first summary section from the imported abstract.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {paper.sections.map((section) => (
                  <article
                    key={section.id}
                    style={{
                      padding: '16px',
                      borderRadius: '18px',
                      border: '1px solid var(--border)',
                      background: '#fffaf1',
                      display: 'grid',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                      <strong>{section.title ?? 'Untitled section'}</strong>
                      <span style={{ color: 'var(--muted)', fontSize: '14px' }}>{section.sectionType}</span>
                    </div>
                    <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>{section.content}</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="page-stack">
          <section className="card" style={{ padding: '20px', display: 'grid', gap: '12px' }}>
            <span className="pill">Run status</span>
            <strong>{paper.analysisStatus ?? 'pending'}</strong>
            <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Parse: {paper.parseStatus ?? 'pending'}
            </div>
          </section>
          <section className="card" style={{ padding: '20px', display: 'grid', gap: '10px' }}>
            <span className="pill">Timestamps</span>
            <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Created: {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(paper.createdAt)}
            </div>
            <div style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
              Updated: {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(paper.updatedAt)}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

const primaryButton: React.CSSProperties = {
  padding: '13px 18px',
  borderRadius: '999px',
  border: 'none',
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
