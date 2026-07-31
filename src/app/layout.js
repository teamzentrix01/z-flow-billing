import './globals.css';
import { RootClientWrapper } from './RootClientWrapper';

export const metadata = {
  title: 'Z Flow',
  description: 'Smarter billing. Stronger business.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/z-flow-icon.svg',
    shortcut: '/z-flow-icon.svg',
    apple: '/z-flow-icon.svg',
  },
  appleWebApp: {
    capable: true,
    title: 'Z Flow',
    statusBarStyle: 'default',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0d12',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="icon" href="/z-flow-icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/z-flow-icon.svg" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css"
        />
      </head>
      <body>
        <RootClientWrapper>{children}</RootClientWrapper>
      </body>
    </html>
  );
}
