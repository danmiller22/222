import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Drop / Hook — Simple Form',
  description: '10 photos required, Apple-like minimalist UI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
