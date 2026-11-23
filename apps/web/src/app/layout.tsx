import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Instrument_Sans, Newsreader } from 'next/font/google';
import { AppFrame } from '@/components/app-frame';
import { Providers } from './providers';
import './globals.css';

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument-sans',
  weight: ['400', '500', '600'],
});

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  weight: ['400', '500'],
  style: ['normal', 'italic'],
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'QuickCart — Scan. Pay. Go.',
  description:
    'Supermarket self-checkout, POS and real-time inventory platform. QuickMart demo store.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#047857',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${newsreader.variable} ${geistMono.variable}`}
    >
      <body className="min-h-dvh font-sans">
        <Providers>
          <AppFrame>{children}</AppFrame>
        </Providers>
      </body>
    </html>
  );
}
