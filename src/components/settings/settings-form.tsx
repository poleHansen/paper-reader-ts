'use client';

import { useMemo, useState } from 'react';
import { providerDefinitions, providerOptions, type SupportedProvider } from '@/lib/llm/providers';

interface SettingsData {
  profile: {
    displayName: string;
    role: string;
    researchDirection: string;
    researchInterests: string;
    keywords: string[];
  };
  model: {
    provider: string;
    apiMode: string;
    model: string;
    baseUrl: string;
    apiKey: string;
    temperature: number | null;
    maxTokens: number | null;
  };
  github: {
    owner: string;
    repo: string;
    branch: string;
    basePath: string;
    token: string;
    isEnabled: boolean;
  };
}

interface SettingsFormProps {
  initialData: SettingsData;
}

export function SettingsForm({ initialData }: SettingsFormProps) {
  const [formData, setFormData] = useState(initialData);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modelTestStatus, setModelTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [modelTestMessage, setModelTestMessage] = useState<string | null>(null);
  const [githubTestStatus, setGitHubTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [githubTestMessage, setGitHubTestMessage] = useState<string | null>(null);
  const modelProvider = useMemo(() => providerDefinitions[formData.model.provider as SupportedProvider] ?? providerDefinitions.openai, [formData.model.provider]);

  function handleProviderChange(provider: SupportedProvider) {
    const definition = providerDefinitions[provider];
    const currentBaseUrl = formData.model.baseUrl.trim();

    setFormData({
      ...formData,
      model: {
        ...formData.model,
        provider,
        apiMode: definition.defaultApiMode,
        model: definition.defaultModel,
        baseUrl: currentBaseUrl || definition.defaultBaseUrl,
      },
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('saving');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
        throw new Error(data?.detail || data?.error || 'Save failed.');
      }

      setStatus('saved');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Save failed.');
    }
  }

  async function handleModelTest() {
    setModelTestStatus('testing');
    setModelTestMessage(null);

    try {
      const response = await fetch('/api/settings/test-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: formData.model.provider,
          apiMode: formData.model.apiMode,
          model: formData.model.model,
          baseUrl: formData.model.baseUrl,
          apiKey: formData.model.apiKey,
        }),
      });

      const data = (await response.json().catch(() => null)) as { message?: string; error?: string; detail?: string } | null;

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Model test failed.');
      }

      setModelTestStatus('success');
      setModelTestMessage(data?.message || 'Model connection succeeded.');
    } catch (error) {
      setModelTestStatus('error');
      setModelTestMessage(error instanceof Error ? error.message : 'Model test failed.');
    }
  }

  async function handleGitHubTest() {
    setGitHubTestStatus('testing');
    setGitHubTestMessage(null);

    try {
      const response = await fetch('/api/settings/test-github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owner: formData.github.owner,
          repo: formData.github.repo,
          branch: formData.github.branch,
          token: formData.github.token,
        }),
      });

      const data = (await response.json().catch(() => null)) as { message?: string; error?: string; detail?: string } | null;

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'GitHub test failed.');
      }

      setGitHubTestStatus('success');
      setGitHubTestMessage(data?.message || 'GitHub connection succeeded.');
    } catch (error) {
      setGitHubTestStatus('error');
      setGitHubTestMessage(error instanceof Error ? error.message : 'GitHub test failed.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="page-stack">
      <section className="card" style={{ padding: '24px', display: 'grid', gap: '16px' }}>
        <div>
          <span className="pill">Research profile</span>
          <h2 style={{ margin: '12px 0 0', fontSize: '28px' }}>User context</h2>
        </div>
        <div style={gridStyle}>
          <label style={labelStyle}>
            <span>Display name</span>
            <input
              value={formData.profile.displayName}
              onChange={(event) => setFormData({ ...formData, profile: { ...formData.profile, displayName: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Role</span>
            <input
              value={formData.profile.role}
              onChange={(event) => setFormData({ ...formData, profile: { ...formData.profile, role: event.target.value } })}
              style={fieldStyle}
            />
          </label>
        </div>
        <label style={labelStyle}>
          <span>Research direction</span>
          <textarea
            value={formData.profile.researchDirection}
            onChange={(event) => setFormData({ ...formData, profile: { ...formData.profile, researchDirection: event.target.value } })}
            style={textAreaStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>Research interests</span>
          <textarea
            value={formData.profile.researchInterests}
            onChange={(event) => setFormData({ ...formData, profile: { ...formData.profile, researchInterests: event.target.value } })}
            style={textAreaStyle}
          />
        </label>
        <label style={labelStyle}>
          <span>Keywords</span>
          <input
            value={formData.profile.keywords.join(', ')}
            onChange={(event) =>
              setFormData({
                ...formData,
                profile: {
                  ...formData.profile,
                  keywords: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                },
              })
            }
            style={fieldStyle}
            placeholder="llm, scientific reading, agents"
          />
        </label>
      </section>

      <section className="card" style={{ padding: '24px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'start', flexWrap: 'wrap' }}>
          <div>
            <span className="pill">Model configuration</span>
            <h2 style={{ margin: '12px 0 0', fontSize: '28px' }}>Default model</h2>
          </div>
          <div style={{ display: 'grid', gap: '8px', justifyItems: 'end' }}>
            <button type="button" onClick={handleModelTest} disabled={modelTestStatus === 'testing'} style={secondaryButtonStyle}>
              {modelTestStatus === 'testing' ? 'Testing model...' : 'Test model'}
            </button>
            {modelTestMessage ? (
              <div style={{ color: modelTestStatus === 'error' ? 'var(--accent)' : 'var(--muted)', fontSize: '14px', lineHeight: 1.5, maxWidth: '260px' }}>
                {modelTestMessage}
              </div>
            ) : null}
          </div>
        </div>
        <div style={gridStyle}>
          <label style={labelStyle}>
            <span>Provider</span>
            <select
              value={formData.model.provider}
              onChange={(event) => handleProviderChange(event.target.value as SupportedProvider)}
              style={fieldStyle}
            >
              {providerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            <span>API mode</span>
            <input value={formData.model.apiMode} readOnly style={{ ...fieldStyle, opacity: 0.75, cursor: 'not-allowed' }} />
          </label>
          <label style={labelStyle}>
            <span>Model</span>
            <input
              value={formData.model.model}
              onChange={(event) => setFormData({ ...formData, model: { ...formData.model, model: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Base URL</span>
            <input
              value={formData.model.baseUrl}
              onChange={(event) => setFormData({ ...formData, model: { ...formData.model, baseUrl: event.target.value } })}
              style={fieldStyle}
              placeholder={modelProvider.defaultBaseUrl || 'https://your-provider.example/v1'}
            />
          </label>
          <label style={labelStyle}>
            <span>API key</span>
            <input
              type="password"
              value={formData.model.apiKey}
              onChange={(event) => setFormData({ ...formData, model: { ...formData.model, apiKey: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Temperature</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={formData.model.temperature ?? ''}
              onChange={(event) =>
                setFormData({
                  ...formData,
                  model: {
                    ...formData.model,
                    temperature: event.target.value === '' ? null : Number(event.target.value),
                  },
                })
              }
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Max tokens</span>
            <input
              type="number"
              min="1"
              step="1"
              value={formData.model.maxTokens ?? ''}
              onChange={(event) =>
                setFormData({
                  ...formData,
                  model: {
                    ...formData.model,
                    maxTokens: event.target.value === '' ? null : Number(event.target.value),
                  },
                })
              }
              style={fieldStyle}
            />
          </label>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.6 }}>
          {modelProvider.defaultBaseUrl
            ? `Default endpoint: ${modelProvider.defaultBaseUrl}. You can override it with a relay or proxy URL.`
            : 'Enter the full provider endpoint. Relay and proxy URLs are supported.'}
        </div>
      </section>

      <section className="card" style={{ padding: '24px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'start', flexWrap: 'wrap' }}>
          <div>
            <span className="pill">GitHub image hosting</span>
            <h2 style={{ margin: '12px 0 0', fontSize: '28px' }}>Repository target</h2>
          </div>
          <div style={{ display: 'grid', gap: '8px', justifyItems: 'end' }}>
            <button type="button" onClick={handleGitHubTest} disabled={githubTestStatus === 'testing'} style={secondaryButtonStyle}>
              {githubTestStatus === 'testing' ? 'Testing GitHub...' : 'Test GitHub'}
            </button>
            {githubTestMessage ? (
              <div style={{ color: githubTestStatus === 'error' ? 'var(--accent)' : 'var(--muted)', fontSize: '14px', lineHeight: 1.5, maxWidth: '260px' }}>
                {githubTestMessage}
              </div>
            ) : null}
          </div>
        </div>
        <div style={gridStyle}>
          <label style={labelStyle}>
            <span>Owner</span>
            <input
              value={formData.github.owner}
              onChange={(event) => setFormData({ ...formData, github: { ...formData.github, owner: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Repo</span>
            <input
              value={formData.github.repo}
              onChange={(event) => setFormData({ ...formData, github: { ...formData.github, repo: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Branch</span>
            <input
              value={formData.github.branch}
              onChange={(event) => setFormData({ ...formData, github: { ...formData.github, branch: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Base path</span>
            <input
              value={formData.github.basePath}
              onChange={(event) => setFormData({ ...formData, github: { ...formData.github, basePath: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={labelStyle}>
            <span>Token</span>
            <input
              type="password"
              value={formData.github.token}
              onChange={(event) => setFormData({ ...formData, github: { ...formData.github, token: event.target.value } })}
              style={fieldStyle}
            />
          </label>
          <label style={{ ...labelStyle, justifyContent: 'end' }}>
            <span>Enable upload target</span>
            <input
              type="checkbox"
              checked={formData.github.isEnabled}
              onChange={(event) => setFormData({ ...formData, github: { ...formData.github, isEnabled: event.target.checked } })}
              style={{ width: '18px', height: '18px' }}
            />
          </label>
        </div>
      </section>

      <section className="card" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ color: status === 'error' ? 'var(--accent)' : 'var(--muted)' }}>
          {status === 'saved'
            ? 'Settings saved.'
            : status === 'saving'
              ? 'Saving...'
              : status === 'error'
                ? errorMessage
                : 'Save your local profile, model, and GitHub settings here.'}
        </div>
        <button
          type="submit"
          disabled={status === 'saving'}
          style={{
            padding: '13px 18px',
            borderRadius: '999px',
            border: 'none',
            background: 'var(--accent)',
            color: '#fff7f0',
            fontWeight: 700,
            cursor: status === 'saving' ? 'progress' : 'pointer',
            opacity: status === 'saving' ? 0.8 : 1,
          }}
        >
          {status === 'saving' ? 'Saving...' : 'Save settings'}
        </button>
      </section>
    </form>
  );
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '16px',
};

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  fontWeight: 600,
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
  minHeight: '120px',
  padding: '14px',
  borderRadius: '16px',
  border: '1px solid var(--border)',
  background: 'var(--surface-strong)',
  color: 'var(--foreground)',
  resize: 'vertical',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--foreground)',
  fontWeight: 700,
  cursor: 'pointer',
};
