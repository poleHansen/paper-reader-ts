import type { Route } from 'next';
import Link from 'next/link';

interface NavigationItem {
  href: Route;
  label: string;
}

interface AppShellProps {
  brand: React.ReactNode;
  navigation: NavigationItem[];
  children: React.ReactNode;
}

export function AppShell({ brand, navigation, children }: AppShellProps) {
  return (
    <div style={{ padding: '24px' }}>
      <div
        className="card"
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '18px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '20px',
          position: 'sticky',
          top: '16px',
          zIndex: 20,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '20px' }}>{brand}</div>
        <nav style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '10px 14px',
                borderRadius: '999px',
                color: '#6c5b4f',
                fontWeight: 600,
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <main style={{ maxWidth: '1400px', margin: '32px auto 48px' }}>{children}</main>
    </div>
  );
}
