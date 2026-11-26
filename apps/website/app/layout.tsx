import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zennia - The Arc look for Zen Browser',
  description:
    "Zennia gives Zen Browser Arc's lavender sidebar, centered address bar, library, auto-archive and animated downloads. Free, local and removable in one click.",
  applicationName: 'Zennia',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#f8f7f5' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
