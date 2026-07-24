import { expect, test } from '@playwright/test';
import {
  createInstantMeeting,
  expectInMeeting,
  joinFromLobby,
  makeUser,
  openPeoplePanel,
  patchMeeting,
  registerViaUI,
} from '../helpers';

test.describe('waiting room (contract v2)', () => {
  test('guest waits, host admits from the People panel, guest lands in the meeting', async ({
    browser,
  }) => {
    // --- Host: register, create meeting, enable waiting room -----------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const host = makeUser('Wanda Waitinghost');
    await registerViaUI(pageA, host);

    const meeting = await createInstantMeeting(contextA, 'E2E waiting room');
    // Contract v2: PATCH /api/meetings/:id {waitingRoom: true}.
    await patchMeeting(contextA, meeting.id, { waitingRoom: true });

    // Host joins (host bypasses the waiting room per the contract).
    await pageA.goto(`/?join=${meeting.code}`);
    await joinFromLobby(pageA);
    await expectInMeeting(pageA);

    // --- Guest: requests to join, sees the waiting screen ---------------
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const guestName = 'Wally Waiter';
    await pageB.goto(`/?join=${meeting.code}`);
    await joinFromLobby(pageB, guestName);

    // Contract: 202 {waitingId, status: "waiting"} — no token yet, so the
    // guest must be on the waiting screen, not in the meeting.
    await expect(pageB.getByText('The host will let you in soon', { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByPlaceholder(/message everyone/i)).toHaveCount(0);

    // --- Host admits the guest from the People panel ---------------------
    await openPeoplePanel(pageA);
    await expect(pageA.getByText(guestName).first()).toBeVisible({ timeout: 15_000 });
    // B is the only waiting guest, so the first admit control is theirs.
    await pageA.getByRole('button', { name: /admit|accept|let in/i }).first().click();

    // --- Guest's ~2s poll picks up "admitted" and joins the room ---------
    await expectInMeeting(pageB);

    // Both sides now see each other.
    await expect(pageA.getByText(guestName).first()).toBeVisible({ timeout: 20_000 });
    await openPeoplePanel(pageB);
    await expect(pageB.getByText(host.name).first()).toBeVisible({ timeout: 20_000 });

    await contextA.close();
    await contextB.close();
  });
});
