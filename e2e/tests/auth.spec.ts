import { expect, test } from '@playwright/test';
import { makeUser, registerViaUI } from '../helpers';

test.describe('authentication', () => {
  test('register lands on the dashboard with a greeting, then logout and login work', async ({
    page,
  }) => {
    const user = makeUser('Ada Auth');

    // Register → dashboard greeting (asserted inside the helper).
    await registerViaUI(page, user);

    // Logout: the sign-out control lives behind the profile chip (name +
    // email in the nav) or on the Settings screen.
    const directLogout = page
      .getByRole('button', { name: /log ?out|sign ?out/i })
      .or(page.getByText(/log ?out|sign ?out/i));
    if ((await directLogout.count()) === 0) {
      await page.getByText(user.email).click();
    }
    await directLogout.first().click();

    // Back on the signed-out landing page.
    await expect(page.getByRole('button', { name: 'Sign up free' })).toBeVisible();

    // Login with the same credentials.
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
    await page.getByPlaceholder('you@work.com').fill(user.email);
    await page.getByPlaceholder('Password').fill(user.password);
    await page
      .getByRole('button', { name: /log ?in|sign ?in/i })
      .last()
      .click();

    // Dashboard greeting again.
    await expect(page.getByText(user.name).first()).toBeVisible();
  });

  test('login with a bad password shows an error', async ({ page }) => {
    const user = makeUser('Bob Badpass');
    await registerViaUI(page, user);

    // Fresh visit with no session.
    await page.context().clearCookies();
    await page.goto('/');
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
    await page.getByPlaceholder('you@work.com').fill(user.email);
    await page.getByPlaceholder('Password').fill('definitely-wrong-password');
    await page
      .getByRole('button', { name: /log ?in|sign ?in/i })
      .last()
      .click();

    // Contract: 401 on bad credentials — the UI must surface an error and
    // must NOT land on the dashboard. ("That email and password don't match.")
    await expect(
      page.getByText(/don.t match|invalid|incorrect|wrong|failed/i).first(),
    ).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
  });
});
