import { expect, test } from '@playwright/test';
import { makeUser, registerViaUI } from '../helpers';

test.describe('scheduling', () => {
  test('a meeting can be scheduled for a future date, and the options take effect', async ({
    page,
  }) => {
    await registerViaUI(page, makeUser('Sam Scheduler'));

    await page.getByRole('button', { name: /schedule/i }).first().click();
    await expect(page.getByRole('heading', { name: /schedule a meeting/i })).toBeVisible();

    await page.getByLabel('Title').fill('Next week sync');

    // The date field used to be readOnly and pinned to today, so nothing could
    // be scheduled for any other day. Pick a date a week out and make sure it
    // survives to the created meeting.
    const target = new Date();
    target.setDate(target.getDate() + 7);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
    const dateField = page.getByLabel('Date');
    await expect(dateField).toBeEditable();
    await dateField.fill(iso);
    await page.getByLabel('Start').selectOption('15:00');

    // Turn chat off. Every option in this form is bound to a real PATCH field;
    // three of the four used to be switches that silently did nothing.
    await page.getByRole('button', { name: /meeting options/i }).click();
    await page.getByRole('switch', { name: /let people use chat/i }).click();

    const created = page.waitForResponse(
      r => r.url().includes('/api/meetings') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /save meeting/i }).click();
    const meeting = (await (await created).json()).meeting;

    await expect(page.getByRole('heading', { name: /is on the calendar/i })).toBeVisible();

    // The scheduled date is the one that was chosen, in local time.
    const startsAt = new Date(
      (await (await page.request.get(`/api/meetings/${meeting.code}`)).json()).meeting.startsAt,
    );
    expect(startsAt.getFullYear()).toBe(target.getFullYear());
    expect(startsAt.getMonth()).toBe(target.getMonth());
    expect(startsAt.getDate()).toBe(target.getDate());

    // …and the toggle reached the server rather than being dropped.
    const after = (await (await page.request.get(`/api/meetings/${meeting.code}`)).json()).meeting;
    expect(after.allowChat).toBe(false);
    expect(after.waitingRoom).toBe(true);

    // Calendar export used to be two buttons that only toasted "coming soon".
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /download \.ics/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${meeting.code}.ics`);
    const body = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('SUMMARY:Next week sync');
    expect(body).toContain(meeting.code);
    // RFC 5545 requires CRLF; a calendar app will reject LF-only.
    expect(body).toContain('\r\n');
  });
});
