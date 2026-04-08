import './globals.css';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Serif } from 'next/font/google';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const serif = IBM_Plex_Serif({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Paper Reader TS',
  description: 'A local-first multi-agent paper reading workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${sans.variable} ${serif.variable}`}>
        <AppShell
          brand={<Link href="/">Paper Reader TS</Link>}
          navigation={[
            { href: '/', label: 'Papers' },
            { href: '/search', label: 'Search & Upload' },
            { href: '/settings', label: 'Settings' },
          ]}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
