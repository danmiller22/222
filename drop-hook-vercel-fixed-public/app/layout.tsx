// app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://hook-drop-form.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Trailer Hook-Drop — Mandatory Form',
  // без description
  openGraph: {
    title: 'Trailer Hook-Drop — Mandatory Form',
    url: '/',
    siteName: 'US Team Fleet',
    type: 'website',
    // без description
  },
  twitter: {
    card: 'summary',
    title: 'Trailer Hook-Drop — Mandatory Form',
    // без description
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
