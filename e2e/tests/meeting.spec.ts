import { expect, test } from '@playwright/test';
import {
  createInstantMeeting,
  expectInMeeting,
  joinFromLobby,
  makeUser,
  openChatPanel,
  openPeoplePanel,
  registerViaUI,
} from '../helpers';

test.describe('core meeting flow: host + guest', () => {
  test('two participants meet, chat, and the host removes the guest', async ({
    browser,
  }) => {
    // --- Context A: registered host ------------------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const host = makeUser('Hana Host');
    await registerViaUI(pageA, host);

    const meeting = await createInstantMeeting(contextA, 'E2E core flow');

    // Host enters the lobby via the join link and joins.
    await pageA.goto(`/?join=${meeting.code}`);
    await joinFromLobby(pageA);
    await expectInMeeting(pageA);

    // --- Context B: guest via invite link (separate cookie jar) --------
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const guestName = 'Gary Guest';
    await pageB.goto(`/?join=${meeting.code}`);
    await joinFromLobby(pageB, guestName);
    await expectInMeeting(pageB);

    // --- Both see 2 participants ---------------------------------------
    await openPeoplePanel(pageA);
    await expect(pageA.getByText(guestName).first()).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByText(host.name).first()).toBeVisible();

    await openPeoplePanel(pageB);
    await expect(pageB.getByText(host.name).first()).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByText(guestName).first()).toBeVisible();

    // --- Chat: A sends, B receives (data topic "chat") -----------------
    const message = `hello from the host ${Date.now()}`;
    await openChatPanel(pageA);
    await pageA.getByPlaceholder('Message everyone…').fill(message);
    await pageA.getByPlaceholder('Message everyone…').press('Enter');
    // Sender sees their own message (it can render in both the chat list and
    // a toast, hence .first()).
    await expect(pageA.getByText(message).first()).toBeVisible();

    await openChatPanel(pageB);
    await expect(pageB.getByText(message).first()).toBeVisible({ timeout: 15_000 });

    // --- Moderation: A removes B ---------------------------------------
    // In the People panel only remote participants have a remove control
    // ("Remove from meeting"), and B is the only other participant.
    await openPeoplePanel(pageA);
    await pageA.getByRole('button', { name: /remove/i }).first().click();

    // B is disconnected and sees the host-ended screen.
    await expect(
      pageB.getByRole('heading', { name: 'The host ended the meeting' }),
    ).toBeVisible({ timeout: 20_000 });

    await contextA.close();
    await contextB.close();
  });
});
