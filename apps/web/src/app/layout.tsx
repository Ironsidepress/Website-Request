import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Website Factory',
  description: 'Multi-tenant website production platform — control plane',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div>
            <a className="brand" href="/">
              Website<span>Factory</span>
            </a>
            <span className="tagline">Your website, produced for you</span>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          Website Factory — from questionnaire to launch, with human approval at every gate.
        </footer>
      </body>
    </html>
  );
}
