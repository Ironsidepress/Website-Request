import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// Makes Cloudflare bindings (D1, vars, .dev.vars secrets) available through
// getCloudflareContext() during `next dev`.
void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Linting runs once at the repository root (eslint.config.mjs); `next build`
  // must not require a second, framework-local ESLint setup.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
