import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Linting runs once at the repository root (eslint.config.mjs); `next build`
  // must not require a second, framework-local ESLint setup.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
