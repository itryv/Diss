import { test, expect } from '@playwright/test';
import { makeUser, registerViaUI, createInstantMeeting, joinFromLobby, expectInMeeting } from '../helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Exercises real LiveKit Egress: requires the dev compose stack (livekit +
// redis + egress) and the server running with EGRESS_ENABLED=true.
// Skipped unless RECORDING_E2E=1 since CI doesn't run the egress container.
const enabled = process.env.RECORDING_E2E === '1';

const RECORDINGS_DIR = path.resolve(dirname, '../../server/data/recordings');

test.describe('recording (egress)', () => {
  test.skip(!enabled, 'set RECORDING_E2E=1 with the dev egress stack running');

  test('host records, REC pill shows, MP4 lands on disk, Recordings screen lists it', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const host = makeUser('Rec Tester');
    await registerViaUI(page, host);
    const meeting = await createInstantMeeting(context, 'Recording test');

    // Join with fake media devices — chromium publishes real (synthetic)
    // tracks, which egress needs before it will start compositing.
    await page.goto(`/?join=${meeting.code}`);
    await joinFromLobby(page);
    await expectInMeeting(page);

    // Start recording from the More menu.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByText('Start recording').click();
    await expect(page.getByText('REC', { exact: true })).toBeVisible({ timeout: 15_000 });

    // Let egress composite ~15s of media.
    await page.waitForTimeout(15_000);

    // Stop. The control bar auto-hides after inactivity (pointer-events:none),
    // so wake it with mouse movement the way a real user would.
    await page.mouse.move(640, 360);
    await page.mouse.move(640, 500);
    await page.mouse.move(640, 650);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByText('Stop recording').click();
    await expect(page.getByText('REC', { exact: true })).toHaveCount(0, { timeout: 15_000 });

    // Egress finalizes the file asynchronously, and the mp4 is still growing
    // while it does — polling for "size > 0" catches it mid-write and reads a
    // few KB, so wait for it to actually reach composite size.
    const MIN_BYTES = 200_000; // a ~15s composite is megabytes; an empty stub is KBs
    const deadline = Date.now() + 60_000;
    let file: string | undefined;
    while (Date.now() < deadline && !file) {
      if (fs.existsSync(RECORDINGS_DIR)) {
        file = fs
          .readdirSync(RECORDINGS_DIR)
          .find(
            (f) =>
              f.startsWith(meeting.code) &&
              f.endsWith('.mp4') &&
              fs.statSync(path.join(RECORDINGS_DIR, f)).size > MIN_BYTES,
          );
      }
      if (!file) await page.waitForTimeout(1000);
    }
    expect(file, `expected a finalized mp4 for ${meeting.code} in ${RECORDINGS_DIR}`).toBeTruthy();

    // Recordings screen lists it.
    await page.goto('/');
    await page.getByRole('button', { name: 'Recordings' }).click();
    await expect(page.getByText('Recording test').first()).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
