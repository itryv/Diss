import { test, expect } from '@playwright/test';
import { registerViaUI } from '../helpers';

// The admin dashboard shipped with a bug that blanked the whole page: the
// server returns an audit entry's `detail` already parsed as an object, the UI
// typed it as a JSON string, and React threw rendering an object as a child.
// Nothing exercised the admin UI against real data, so nobody caught it.
// These tests walk every section with real rows behind them.

const ADMIN_EMAIL = 'e2e-admin@e2e.test'; // must match ADMIN_EMAILS in playwright.config.ts
const ADMIN = { name: 'E2E Admin', email: ADMIN_EMAIL, password: 'e2e-admin-pw-123' };

const SECTIONS = ['Overview', 'Live', 'Users', 'Meetings', 'Recordings', 'Settings', 'Audit'];

test.describe('admin dashboard', () => {
  test('every section renders, and the audit log survives a real entry', async ({ page, context }) => {
    test.setTimeout(120_000);

    // The admin account may already exist from a previous run in this DB.
    await page.goto('/');
    const reg = await context.request.post('/api/auth/register', { data: ADMIN });
    if (![201, 409].includes(reg.status())) {
      throw new Error(`unexpected register status ${reg.status()}`);
    }
    if (reg.status() === 409) {
      const login = await context.request.post('/api/auth/login', {
        data: { email: ADMIN.email, password: ADMIN.password },
      });
      expect(login.status()).toBe(200);
    }

    const me = await (await context.request.get('/api/auth/me')).json();
    expect(me.isAdmin, 'ADMIN_EMAILS should make this account an admin').toBe(true);

    // Produce a real audit row BEFORE opening the dashboard — an empty log
    // would have hidden the original crash entirely.
    const patch = await context.request.patch('/api/admin/settings', {
      data: { defaultWaitingRoom: true },
    });
    expect(patch.status()).toBe(200);

    await page.reload();
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible({ timeout: 20_000 });

    for (const section of SECTIONS) {
      await page.getByRole('button', { name: section, exact: true }).last().click();
      // The bug blanked the page, so assert something is actually painted and
      // that the section-level error boundary did not trip.
      await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
      await expect(page.getByText('This section failed to render')).toHaveCount(0);
      const painted = await page.evaluate(() => document.body.innerText.trim().length);
      expect(painted, `${section} should render content`).toBeGreaterThan(40);
    }

    // Audit specifically: the real entry must be listed and its object detail
    // formatted, not crashed on.
    await page.getByRole('button', { name: 'Audit', exact: true }).last().click();
    await expect(page.getByText('settings.update').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(ADMIN_EMAIL).first()).toBeVisible();
    await expect(page.getByText(/defaultWaitingRoom/).first()).toBeVisible();

    // Put it back so re-runs start clean.
    await context.request.patch('/api/admin/settings', { data: { defaultWaitingRoom: false } });
  });

  test('a non-admin sees no admin nav and is refused by the API', async ({ page, context }) => {
    await registerViaUI(page, {
      name: 'Plain User',
      email: `plain-${Date.now()}@e2e.test`,
      password: 'plain-user-pw-123',
    });
    await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
    const res = await context.request.get('/api/admin/overview');
    expect(res.status()).toBe(403);
  });
});
