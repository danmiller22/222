import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'US Team Fleet',
  description: 'Mobile-first: ровно 10 фото, сразу на почту, без хранения.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
