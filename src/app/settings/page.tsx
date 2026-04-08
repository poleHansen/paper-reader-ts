import { headers } from 'next/headers';
import { SettingsForm } from '@/components/settings/settings-form';

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

const fallbackSettings: SettingsData = {
  profile: {
    displayName: '',
    role: '',
    researchDirection: '',
    researchInterests: '',
    keywords: [],
  },
  model: {
    provider: 'openai',
    apiMode: 'responses',
    model: 'gpt-4.1-mini',
    baseUrl: '',
    apiKey: '',
    temperature: 0.2,
    maxTokens: 4000,
  },
  github: {
    owner: '',
    repo: '',
    branch: 'main',
    basePath: '',
    token: '',
    isEnabled: false,
  },
};

export default async function SettingsPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const baseUrl = host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  let settings = fallbackSettings;
  let loadError: string | null = null;

  try {
    const response = await fetch(`${baseUrl}/api/settings`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error('Failed to load settings.');
    }

    settings = (await response.json()) as SettingsData;
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unknown error';
  }

  return (
    <div className="page-stack">
      <section className="card" style={{ padding: '28px', display: 'grid', gap: '12px' }}>
        <span className="pill">Settings</span>
        <h1 style={{ margin: 0, fontSize: '42px' }}>Configuration surfaces</h1>
        <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.7, maxWidth: '760px' }}>
          Configure your research profile, default model, and GitHub image hosting target from one local settings page.
        </p>
      </section>

      {loadError ? (
        <section className="card" style={{ padding: '24px', color: 'var(--accent)' }}>
          Settings failed to load: {loadError}
        </section>
      ) : null}

      <SettingsForm initialData={settings} />
    </div>
  );
}
