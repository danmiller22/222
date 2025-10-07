import './globals.css';
import type { Metadata } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://hook-drop-form.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Trailer Hook-Drop — Mandatory Form',
  description: 'Drop / Hook mandatory form',
  openGraph: {
    title: 'Trailer Hook-Drop — Mandatory Form',
    description: 'Drop / Hook mandatory form',
    url: '/',
    siteName: 'US Team Fleet',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Trailer Hook-Drop — Mandatory Form',
    description: 'Drop / Hook mandatory form',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
