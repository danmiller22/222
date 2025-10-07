// app/layout.tsx  — замените целиком

import './globals.css';
import type { Metadata } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://hook-drop-form.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Mandatory Trailer Hook/Drop Form',
  description:
    'US Team Fleet — upload exactly 10 photos for every hook or drop.',
  openGraph: {
    title: 'Mandatory Trailer Hook/Drop Form',
    description:
      'US Team Fleet — upload exactly 10 photos for every hook or drop.',
    url: '/',
    siteName: 'US Team Fleet',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Mandatory Trailer Hook/Drop Form',
    description:
      'US Team Fleet — upload exactly 10 photos for every hook or drop.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
