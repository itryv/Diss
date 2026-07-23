import { expect, type BrowserContext, type Page } from '@playwright/test';

let counter = 0;

/** A unique email per registered user so runs never collide. */
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${process.pid}-${counter}@e2e.test`;
}

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export function makeUser(name: string): TestUser {
  return {
    name,
    email: uniqueEmail(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
    password: 'sup3r-secret-pw!',
  };
}

/**
 * Register a brand-new user through the real UI: landing → "Sign up free" →
 * auth form → dashboard.
 */
export async function registerViaUI(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up free' }).click();
  await page.getByPlaceholder('Your name').fill(user.name);
  await page.getByPlaceholder('you@work.com').fill(user.email);
  await page.getByPlaceholder('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Dashboard greets the user by name.
  await expect(page.getByText(user.name).first()).toBeVisible();
}

/**
 * Create an instant meeting via the API using the page's session cookie, and
 * return the meeting. Contract: POST /api/meetings with no startsAt.
 */
export async function createInstantMeeting(
  context: BrowserContext,
  title?: string,
): Promise<{ id: string; code: string }> {
  const res = await context.request.post('/api/meetings', {
    data: title ? { title } : {},
  });
  expect(res.status(), 'POST /api/meetings should return 201').toBe(201);
  const body = await res.json();
  return { id: body.meeting.id, code: body.meeting.code };
}

/**
 * Turn a meeting setting on/off via the contract-v2 PATCH endpoint using the
 * session cookie held by the given context (must be the host's context).
 */
export async function patchMeeting(
  context: BrowserContext,
  meetingId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await context.request.patch(`/api/meetings/${meetingId}`, {
    data: patch,
  });
  expect(res.status(), 'PATCH /api/meetings/:id should return 200').toBe(200);
}

/**
 * From the pre-join lobby, set the display name (guests) and join.
 * Members whose name is already known may not see the name input, so it is
 * filled only when present.
 */
export async function joinFromLobby(page: Page, displayName?: string): Promise<void> {
  const nameInput = page.getByPlaceholder('How should we introduce you?');
  if (displayName && (await nameInput.count()) > 0) {
    await nameInput.fill(displayName);
  }
  await page.getByRole('button', { name: 'Join now' }).click();
}

/** Assert the in-meeting toolbar is present (i.e. we actually joined). */
export async function expectInMeeting(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible({
    timeout: 20_000,
  });
}

/** Open the People panel and return a locator scoped to it if identifiable. */
export async function openPeoplePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'People (P)' }).click();
}

export async function openChatPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Chat (C)' }).click();
}
