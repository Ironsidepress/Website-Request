import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * M8 hardening coverage (docs/acceptance-criteria.md):
 * - security headers + correlation ids on every response
 * - autosave conflict (409) behavior under concurrent edits (flow 3 load sanity)
 * - full submission → client timeline (flow 4)
 * - staff surface hidden from clients; admin dashboard for platform staff (§5)
 */

const ORIGIN = 'http://localhost:3000';
const runId = Date.now().toString(36);
const client = {
  name: 'E2E Hardened Client',
  email: `e2e-hard-${runId}@example.com`,
  password: 'a-strong-e2e-password',
};
// Fixed address so the ADR-0015 bootstrap (INITIAL_ADMIN_EMAIL in .dev.vars /
// CI env) promotes it; re-runs against persistent local state sign in instead.
const admin = {
  name: 'E2E Admin',
  email: 'e2e-admin@example.com',
  password: 'a-strong-e2e-admin-password',
};

const SECTIONS: Record<string, unknown> = {
  business: {
    legalName: 'E2E Hardening LLC',
    displayName: 'E2E Hardening Co',
    description: 'A letterpress print shop exercising the hardened API surface.',
    contact: { email: 'hello@example.com' },
    serviceArea: 'local',
  },
  services: { offerings: [{ name: 'Invitations', description: 'Letterpress suites' }] },
  audiences: {
    primaryAudience: { description: 'Engaged couples', problems: 'Stationery' },
    tone: 'friendly',
  },
  competitors: {},
  examples: {},
  domain: { ownsDomain: false, desiredNames: ['e2e-hardening.com'], purchaseConsent: true },
  branding: { hasBrandAssets: false, stylePreferences: ['classic'], needsLogoDesign: true },
  content: {
    contentReadiness: 'need_creation',
    needsCopywriting: true,
    needsPhotography: 'stock_ok',
  },
  functionality: { features: ['contact_form'], pageExpectations: 'up_to_5' },
};

async function verifyFromInbox(rq: APIRequestContext, email: string) {
  const inbox = await rq.get(`/api/dev/emails?to=${encodeURIComponent(email)}`);
  expect(inbox.ok()).toBeTruthy();
  const message = (await inbox.json()) as { text: string };
  const url = message.text.match(/https?:\/\/\S+/)?.[0];
  expect(url).toBeTruthy();
  await rq.get(url!);
}

async function signIn(rq: APIRequestContext, credentials: { email: string; password: string }) {
  const response = await rq.post('/api/auth/sign-in/email', {
    data: credentials,
    headers: { origin: ORIGIN },
  });
  expect(response.ok()).toBeTruthy();
}

/**
 * Idempotent auth for fixed accounts across persistent local state: duplicate
 * sign-ups return an enumeration-safe fake success WITHOUT sending email, so
 * never branch on the sign-up response. A failed sign-in (unverified account)
 * re-sends the verification email, so the inbox always ends up with a link.
 */
async function ensureSignedIn(
  rq: APIRequestContext,
  account: { name: string; email: string; password: string },
) {
  const attempt = await rq.post('/api/auth/sign-in/email', {
    data: { email: account.email, password: account.password },
    headers: { origin: ORIGIN },
  });
  if (attempt.ok()) return;
  await rq.post('/api/auth/sign-up/email', { data: account, headers: { origin: ORIGIN } });
  await verifyFromInbox(rq, account.email);
  await signIn(rq, { email: account.email, password: account.password });
}

test.describe.configure({ mode: 'serial' });

test('security headers and correlation ids on every response', async ({ request }) => {
  const home = await request.get('/');
  expect(home.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(home.headers()['x-content-type-options']).toBe('nosniff');
  expect(home.headers()['x-frame-options']).toBe('DENY');
  expect(home.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');

  const me = await request.get('/api/me');
  expect(me.status()).toBe(401);
  expect(me.headers()['x-correlation-id']).toBeTruthy();
  const body = (await me.json()) as { code: string; correlationId?: string };
  expect(body.code).toBe('unauthenticated');
  expect(body.correlationId).toBeTruthy();
});

test('client journey: autosave conflict, submission, timeline; staff surface hidden', async ({
  page,
}) => {
  const rq = page.request;

  const signup = await rq.post('/api/auth/sign-up/email', {
    data: client,
    headers: { origin: ORIGIN },
  });
  expect(signup.ok()).toBeTruthy();
  await verifyFromInbox(rq, client.email);
  await signIn(rq, client);

  const orgResponse = await rq.post('/api/organizations', {
    data: { name: 'E2E Hardening Co', contactEmail: client.email },
    headers: { origin: ORIGIN },
  });
  expect(orgResponse.status()).toBe(201);
  const org = (await orgResponse.json()) as { id: string };

  const draft = (await (await rq.get(`/api/organizations/${org.id}/intake`)).json()) as {
    revision: number;
  };

  // Two writers race on the same base revision: the second gets a truthful
  // 409 instead of silently losing data (multi-tab load sanity).
  const sectionUrl = `/api/organizations/${org.id}/intake/sections/business`;
  const first = await rq.patch(sectionUrl, {
    data: { baseRevision: draft.revision, data: SECTIONS.business },
    headers: { origin: ORIGIN },
  });
  expect(first.ok()).toBeTruthy();
  const second = await rq.patch(sectionUrl, {
    data: { baseRevision: draft.revision, data: SECTIONS.business },
    headers: { origin: ORIGIN },
  });
  expect(second.status()).toBe(409);
  expect(second.headers()['x-correlation-id']).toBeTruthy();
  expect(((await second.json()) as { code: string }).code).toBe('conflict');

  // Complete the questionnaire against the current revision and submit.
  let revision = ((await first.json()) as { revision: number }).revision;
  for (const [sectionId, data] of Object.entries(SECTIONS)) {
    if (sectionId === 'business') continue;
    const response = await rq.patch(`/api/organizations/${org.id}/intake/sections/${sectionId}`, {
      data: { baseRevision: revision, data },
      headers: { origin: ORIGIN },
    });
    expect(response.ok()).toBeTruthy();
    revision = ((await response.json()) as { revision: number }).revision;
  }
  const submit = await rq.post(`/api/organizations/${org.id}/intake/submit`, {
    data: { confirmAccuracy: true },
    headers: { origin: ORIGIN },
  });
  expect(submit.status()).toBe(201);
  const { projectId } = (await submit.json()) as { projectId: string };

  // The client timeline renders the created project.
  await page.goto(`/organizations/${org.id}/projects/${projectId}`);
  await expect(page.getByTestId('timeline-stages')).toContainText('Project created', {
    timeout: 30_000,
  });

  // The staff surface does not exist for clients.
  const staffApi = await rq.get('/api/staff/projects');
  expect(staffApi.status()).toBe(404);
  await page.goto('/staff');
  await expect(page.getByText('Not available')).toBeVisible();
});

test('platform admin sees the cross-tenant dashboard', async ({ browser }) => {
  const context = await browser.newContext();
  const rq = context.request;
  const page = await context.newPage();

  await ensureSignedIn(rq, admin);

  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff dashboard' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('staff-projects')).toContainText('E2E Hardening Co');

  // Project detail: the full internal record (history, agent runs, intake).
  await page
    .getByTestId('staff-projects')
    .getByRole('link', { name: /E2E Hardening Co website/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /E2E Hardening Co/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Agent runs' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Stage history (full, including internal)' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();
  await context.close();
});
