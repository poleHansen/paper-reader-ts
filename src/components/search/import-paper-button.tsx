'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ImportPaperButtonProps {
  payload: {
    sourceType: 'search_import';
    sourcePlatform: string;
    externalPaperId: string;
    sourceUrl: string;
    pdfUrl?: string;
    title: string;
    abstract: string;
    authors: string[];
    year?: number;
  };
}

export function ImportPaperButton({ payload }: ImportPaperButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleImport() {
    setStatus('submitting');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/papers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
        throw new Error(data?.detail || data?.error || 'Import failed.');
      }

      const data = (await response.json()) as { item?: { id: string }; duplicate?: boolean };

      if (!data.item?.id) {
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
    <div style={{ display: 'grid', gap: '8px' }}>
      <button
        type="button"
        onClick={handleImport}
        disabled={status === 'submitting'}
        style={{
          minHeight: '48px',
          minWidth: '120px',
          padding: '0 14px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          background: 'var(--accent)',
          color: '#fff7f0',
          fontWeight: 700,
          cursor: status === 'submitting' ? 'progress' : 'pointer',
          opacity: status === 'submitting' ? 0.8 : 1,
        }}
      >
        {status === 'submitting' ? 'Importing...' : 'Import'}
      </button>
      {errorMessage ? (
        <div style={{ color: 'var(--accent)', fontSize: '14px', maxWidth: '220px', lineHeight: 1.5 }}>{errorMessage}</div>
      ) : null}
    </div>
  );
}
