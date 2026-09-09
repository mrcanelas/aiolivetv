import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import './global.css';

export const metadata: Metadata = {
  title: {
    template: '%s | AIOLiveTV',
    default: 'AIOLiveTV',
  },
  description:
    'Unified Live TV aggregator for Stremio. Combine XMLTV, M3U, Xtream and channel addons, with or without Native EPG.',
  icons: {
    icon: '/favicon.png',
    apple: '/logo.png',
  },
};

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
