'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ParsePaperButtonProps {
  paperId: string;
}

export function ParsePaperButton({ paperId }: ParsePaperButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleParse() {
    setStatus('submitting');
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/papers/${paperId}/parse`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
        throw new Error(data?.detail || data?.error || 'Parse failed.');
      }

      router.refresh();
      setStatus('idle');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Parse failed.');
    }
  }

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <button
        type="button"
        onClick={handleParse}
        disabled={status === 'submitting'}
        style={{
          padding: '13px 18px',
          borderRadius: '999px',
          border: '1px solid var(--border)',
          background: 'var(--accent)',
          color: '#fff7f0',
          fontWeight: 700,
          cursor: status === 'submitting' ? 'progress' : 'pointer',
          opacity: status === 'submitting' ? 0.8 : 1,
        }}
      >
        {status === 'submitting' ? 'Parsing...' : 'Run parse'}
      </button>
      {errorMessage ? (
        <div style={{ color: 'var(--accent)', fontSize: '14px', lineHeight: 1.5, maxWidth: '220px' }}>{errorMessage}</div>
      ) : null}
    </div>
  );
}
