'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function UploadPaperForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [abstractText, setAbstractText] = useState('');
  const [authorsText, setAuthorsText] = useState('');
  const [year, setYear] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setStatus('error');
      setErrorMessage('Please choose a PDF file.');
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.set('title', title);
      formData.set('abstract', abstractText);
      formData.set('authors', authorsText);
      formData.set('year', year);
      formData.set('file', file);

      const response = await fetch('/api/papers/upload', {
        method: 'POST',
        body: formData,
      });

      const data = (await response.json().catch(() => null)) as { item?: { id: string }; error?: string; detail?: string } | null;

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Upload failed.');
      }

      if (!data?.item?.id) {
        throw new Error('Created paper id is missing.');
      }

      router.push(`/papers/${data.item.id}`);
      router.refresh();
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed.');
      return;
    }

    setStatus('idle');
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: '24px', display: 'grid', gap: '16px' }}>
      <div style={{ display: 'grid', gap: '8px' }}>
        <span className="pill">PDF upload</span>
        <h2 style={{ margin: 0, fontSize: '28px' }}>Upload local PDF</h2>
        <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.6 }}>
          Save the original PDF into local storage and create a paper record for the parse step.
        </p>
      </div>

      <label style={labelStyle}>
        <span>PDF file</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          style={fieldStyle}
        />
      </label>

      <label style={labelStyle}>
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} style={fieldStyle} placeholder="Paper title" />
      </label>

      <label style={labelStyle}>
        <span>Abstract</span>
        <textarea
          value={abstractText}
          onChange={(event) => setAbstractText(event.target.value)}
          style={textAreaStyle}
          placeholder="Optional for now, but useful before real PDF parsing is added"
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
          {status === 'submitting' ? 'Uploading...' : 'Upload PDF'}
        </button>
        <span style={{ color: 'var(--muted)', fontSize: '14px' }}>PDF only, up to 25 MB.</span>
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
