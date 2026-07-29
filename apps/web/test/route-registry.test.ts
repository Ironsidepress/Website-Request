import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ROUTE_CLASSIFICATIONS } from './route-classification';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/app');

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry === 'route.ts' || entry === 'route.tsx') {
      results.push(full);
    }
  }
  return results;
}

function routePathOf(file: string): string {
  return `/${path.relative(appDir, path.dirname(file)).split(path.sep).join('/')}`;
}

describe('API route registry (tenant-isolation manifest)', () => {
  const routeFiles = findRouteFiles(appDir);
  const discovered = routeFiles.map(routePathOf).sort();

  it('discovers the API surface', () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it('every route is classified — unregistered routes fail CI', () => {
    const registered = Object.keys(ROUTE_CLASSIFICATIONS).sort();
    expect(discovered).toEqual(registered);
  });

  it('non-auth routes resolve the principal through the shared helper', () => {
    for (const file of routeFiles) {
      const route = routePathOf(file);
      if (ROUTE_CLASSIFICATIONS[route] === 'auth') continue;
      const source = readFileSync(file, 'utf8');
      expect(source, `${route} must use requirePrincipal + handleApi`).toMatch(/requirePrincipal/);
      expect(source, `${route} must wrap handlers in handleApi`).toMatch(/handleApi/);
    }
  });

  it('tenant-scoped routes never build a TenantContext from raw params', () => {
    for (const file of routeFiles) {
      const route = routePathOf(file);
      if (ROUTE_CLASSIFICATIONS[route] !== 'tenant-scoped') continue;
      const source = readFileSync(file, 'utf8');
      // Route handlers must delegate to core services (which resolve membership);
      // constructing a tenant context in the handler is a review-blocking smell.
      expect(source, `${route} must not call tenantContext() directly`).not.toMatch(
        /tenantContext\(/,
      );
    }
  });
});
