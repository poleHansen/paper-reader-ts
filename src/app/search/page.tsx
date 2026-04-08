import { headers } from 'next/headers';
import { ImportPaperButton } from '@/components/search/import-paper-button';
import { UploadPaperForm } from '@/components/search/upload-paper-form';

interface SearchPageProps {
  searchParams: Promise<{
    query?: string;
    source?: string;
    sort?: string;
  }>;
}

interface SearchResultItem {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  year?: number;
  source: string;
  sourcePlatform: string;
  sourceUrl: string;
  pdfUrl?: string;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = resolvedSearchParams.query?.trim() || 'agentic paper reading';
  const source = resolvedSearchParams.source === 'arxiv' ? 'arxiv' : 'arxiv';
  const sort = resolvedSearchParams.sort === 'latest' ? 'latest' : 'relevance';

  let items: SearchResultItem[] = [];
  let searchError: string | null = null;
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const baseUrl = host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  try {
    const response = await fetch(
      `${baseUrl}/api/search?query=${encodeURIComponent(query)}&source=${source}&sort=${sort}`,
      { cache: 'no-store' },
    );

    if (!response.ok) {
      throw new Error('Search request failed.');
    }

    const data = (await response.json()) as { items?: SearchResultItem[] };
    items = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    searchError = error instanceof Error ? error.message : 'Unknown error';
  }

  return (
    <div className="page-stack">
      <section className="card" style={{ padding: '28px', display: 'grid', gap: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <span className="pill">Search import</span>
            <h1 style={{ margin: '12px 0 0', fontSize: '40px' }}>Open-platform paper search</h1>
          </div>
          <div style={{ color: 'var(--muted)', maxWidth: '460px', lineHeight: 1.6 }}>
            Search live arXiv results, then import them into local SQLite so the list and detail pages read real paper records.
          </div>
        </div>
        <form style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '12px' }}>
          <input name="query" defaultValue={query} style={fieldStyle} />
          <select name="source" defaultValue={source} style={fieldStyle}>
            <option value="arxiv">arXiv</option>
          </select>
          <select name="sort" defaultValue={sort} style={fieldStyle}>
            <option value="relevance">Relevance</option>
            <option value="latest">Latest</option>
          </select>
          <button type="submit" style={{ ...fieldStyle, background: 'var(--accent)', color: '#fff7f0', fontWeight: 700 }}>
            Search
          </button>
        </form>
      </section>

      {searchError ? (
        <section className="card" style={{ padding: '24px', color: 'var(--accent)' }}>
          Search failed: {searchError}
        </section>
      ) : null}

      <UploadPaperForm />

      <section className="page-stack">
        {items.map((result) => (
          <article key={result.id} className="card" style={{ padding: '24px', display: 'grid', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: '6px' }}>
                <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.15 }}>{result.title}</h2>
                <div style={{ color: 'var(--muted)' }}>
                  {result.authors.join(', ') || 'Unknown authors'} · {result.year ?? 'Unknown year'} · {result.source}
                </div>
              </div>
              <ImportPaperButton
                payload={{
                  sourceType: 'search_import',
                  sourcePlatform: result.sourcePlatform,
                  externalPaperId: result.id,
                  sourceUrl: result.sourceUrl,
                  pdfUrl: result.pdfUrl,
                  title: result.title,
                  abstract: result.abstract,
                  authors: result.authors,
                  year: result.year,
                }}
              />
            </div>
            <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.7 }}>{result.abstract}</p>
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}>Import payload</summary>
              <pre
                style={{
                  margin: '12px 0 0',
                  padding: '16px',
                  borderRadius: '16px',
                  background: '#fffaf1',
                  border: '1px solid var(--border)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(
                  {
                    sourceType: 'search_import',
                    sourcePlatform: result.sourcePlatform,
                    externalPaperId: result.id,
                    sourceUrl: result.sourceUrl,
                    pdfUrl: result.pdfUrl,
                    title: result.title,
                    abstract: result.abstract,
                    authors: result.authors,
                    year: result.year,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  minHeight: '48px',
  padding: '0 14px',
  borderRadius: '16px',
  border: '1px solid var(--border)',
  background: 'var(--surface-strong)',
  color: 'var(--foreground)',
};
