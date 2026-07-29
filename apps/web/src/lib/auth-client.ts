'use client';

import { createAuthClient } from 'better-auth/react';

/** Browser-side client for the AuthService endpoints mounted at /api/auth. */
export const authClient = createAuthClient({
  basePath: '/api/auth',
});
