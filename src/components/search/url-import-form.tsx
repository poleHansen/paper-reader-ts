'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UrlImportForm() {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [title, setTitle] = useState('');
  const [abstractText, setAbstractText] = useState('');
  const [authorsText, setAuthorsText] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/papers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: 'url',
          sourcePlatform: 'url_import',
          sourceUrl,
          pdfUrl: pdfUrl || undefined,
          title,
          abstract: abstractText,
          authors: authorsText
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          year: year ? Number.parseInt(year, 10) : undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as { item?: { id: string }; error?: string; detail?: string } | null;

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Import failed.');
      }

      if (!data?.item?.id) {
        throw new Error('Created paper id is missing.');
      }

      router.push(`/papers/${data.item.id}`);
      router.refresh();
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Import failed.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: '24px', display: 'grid', gap: '16px' }}>
      <div style={{ display: 'grid', gap: '8px' }}>
        <span className="pill">URL import</span>
        <h2 style={{ margin: 0, fontSize: '28px' }}>Import from URL</h2>
        <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.6 }}>
          Create a paper from an open paper page or direct PDF link. If you provide a PDF URL, the app will try to download and parse it.
        </p>
      </div>

      <label style={labelStyle}>
        <span>Paper URL</span>
        <input
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          style={fieldStyle}
          placeholder="https://arxiv.org/abs/2401.00001"
          required
        />
      </label>

      <label style={labelStyle}>
        <span>PDF URL</span>
        <input
          value={pdfUrl}
          onChange={(event) => setPdfUrl(event.target.value)}
          style={fieldStyle}
          placeholder="https://arxiv.org/pdf/2401.00001.pdf"
        />
      </label>

      <label style={labelStyle}>
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} style={fieldStyle} placeholder="Paper title" required />
      </label>

      <label style={labelStyle}>
        <span>Abstract</span>
        <textarea
          value={abstractText}
          onChange={(event) => setAbstractText(event.target.value)}
          style={textAreaStyle}
          placeholder="Paste the abstract from the paper page"
          required
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
        <label style={labelStyle}>
          <span>Authors</span>
          <input
            value={authorsText}
            onChange={(event) => setAuthorsText(event.target.value)}
            style={fieldStyle}
            placeholder="Comma-separated authors"
          />
        </label>
        <label style={labelStyle}>
          <span>Year</span>
          <input value={year} onChange={(event) => setYear(event.target.value)} style={fieldStyle} placeholder="2025" />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={status === 'submitting'} style={submitButtonStyle}>
          {status === 'submitting' ? 'Importing...' : 'Import URL'}
        </button>
        <span style={{ color: 'var(--muted)', fontSize: '14px' }}>Only open public URLs are supported.</span>
      </div>

      {errorMessage ? <div style={{ color: 'var(--accent)', lineHeight: 1.5 }}>{errorMessage}</div> : null}
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
};

const fieldStyle: React.CSSProperties = {
  minHeight: '48px',
  padding: '0 14px',
  borderRadius: '16px',
  border: '1px solid var(--border)',
  background: 'var(--surface-strong)',
  color: 'var(--foreground)',
};

const textAreaStyle: React.CSSProperties = {
  ...fieldStyle,
  minHeight: '140px',
  padding: '14px',
  resize: 'vertical',
};

const submitButtonStyle: React.CSSProperties = {
  minHeight: '48px',
  padding: '0 18px',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  background: 'var(--accent)',
  color: '#fff7f0',
  fontWeight: 700,
};
