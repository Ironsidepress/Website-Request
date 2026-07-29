import { expect, test, type Page } from '@playwright/test';

/**
 * Flow 2 of docs/user-flows.md: registration → verification → organization →
 * intake wizard with autosave, reload persistence and conditional sections.
 * Verification links come from the dev-only inbox (/api/dev/emails).
 */

const runId = Date.now().toString(36);
const user = {
  name: 'E2E Client',
  email: `e2e-${runId}@example.com`,
  password: 'a-strong-e2e-password',
};

async function waitForSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', {
    timeout: 15_000,
  });
}

test('client registers, verifies, creates an organization and completes intake sections', async ({
  page,
  request,
}) => {
  // --- register ---
  await page.goto('/register');
  await page.getByLabel('Name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('Check your email')).toBeVisible({ timeout: 30_000 });

  // --- verify via the dev inbox ---
  const inbox = await request.get(`/api/dev/emails?to=${encodeURIComponent(user.email)}`);
  expect(inbox.ok()).toBeTruthy();
  const email = (await inbox.json()) as { text: string };
  const verifyUrl = email.text.match(/https?:\/\/\S+/)?.[0];
  expect(verifyUrl).toBeTruthy();
  await page.goto(verifyUrl!);

  // Auto sign-in after verification lands us back in the app.
  await page.goto('/');
  await expect(page.getByText(`Signed in as ${user.name}`)).toBeVisible();

  // --- create an organization ---
  await page.getByLabel('Business name').fill('E2E Letterpress');
  await page.getByLabel('Contact email').fill(user.email);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('link', { name: 'E2E Letterpress' })).toBeVisible();
  await page.getByRole('link', { name: 'E2E Letterpress' }).click();

  // --- open the questionnaire ---
  await page.getByRole('link', { name: /questionnaire/i }).click();
  await expect(page.getByRole('heading', { name: 'Website questionnaire' })).toBeVisible();

  // --- business section autosaves and becomes valid ---
  await page.getByLabel('Legal business name').fill('E2E Letterpress LLC');
  await page.getByLabel('Display name').fill('E2E Letterpress');
  await page
    .getByLabel(/What does your business do/)
    .fill('A letterpress studio producing wedding stationery and posters.');
  await page.getByLabel('Contact email').fill(user.email);
  await page.getByLabel(/Where do you serve customers/).selectOption('local');
  await waitForSaved(page);
  await expect(page.getByTestId('nav-business')).toContainText('✓');

  // --- reload: draft state survives ---
  await page.reload();
  await expect(page.getByLabel('Legal business name')).toHaveValue('E2E Letterpress LLC');
  await expect(page.getByTestId('nav-business')).toContainText('✓');

  // --- conditional section: domain ---
  await page.getByTestId('nav-domain').click();
  await page.getByLabel('No, I need one').check();
  await expect(page.getByText(/Domain names you would like/)).toBeVisible();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByPlaceholder('example.com').fill('e2e-letterpress.com');
  await page.getByLabel(/I understand any domain purchase/).check();
  await waitForSaved(page);
  await expect(page.getByTestId('nav-domain')).toContainText('✓');

  // Flip the branch: the owning path shows its own fields instead.
  await page.getByLabel('Yes, I own one').check();
  await expect(page.getByLabel('Your domain name')).toBeVisible();
  await expect(page.getByText(/Domain names you would like/)).toBeHidden();
  await waitForSaved(page);
  await expect(page.getByTestId('nav-domain')).toContainText('●');

  // --- branding: real file upload to (local) R2 ---
  await page.getByTestId('nav-branding').click();
  await page.getByLabel('Yes', { exact: true }).check();
  await page.getByLabel(/Your logo and brand files/).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
  });
  await expect(page.getByText('logo.png')).toBeVisible();
  await waitForSaved(page);
  await expect(page.getByTestId('nav-branding')).toContainText('✓');
});
