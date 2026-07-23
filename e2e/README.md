# Diss end-to-end tests

Playwright suite that exercises the real stack: the Fastify server (fresh temp
SQLite DB per run), the Vite dev server, and a LiveKit dev server in Docker.

## Run

From the repo root:

```bash
cd e2e && npx playwright install && npm test
```

(First time: `npm ci` in `e2e/`, `app/`, and `server/`. `npx playwright install`
downloads the Chromium build Playwright drives.)

Requirements:

- Docker (for the LiveKit dev server). If something is already listening on
  port 7880, the suite reuses it and won't start or stop a container.
- Ports 5173 (Vite), 8787 (server), 7880/7881/7882 (LiveKit) free — the
  config's `webServer` entries boot the app and server themselves and reuse
  already-running ones outside CI.

## Layout

- `playwright.config.ts` — Chromium with fake camera/mic flags
  (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`),
  boots `../server` (`npm run dev` with a temp `DATABASE_PATH`) and `../app`.
- `global-setup.ts` / `global-teardown.ts` — start/stop the LiveKit dev
  container (`livekit/livekit-server --dev`); skipped when 7880 is already up.
- `helpers.ts` — unique-user registration through the UI, meeting creation via
  the API contract, lobby join, panel helpers.
- `tests/auth.spec.ts` — register → dashboard greeting, logout, login, bad
  password error.
- `tests/meeting.spec.ts` — the core flow: host + guest in two browser
  contexts, both see 2 participants, chat delivery, host removes guest →
  guest sees "The host ended the meeting".
- `tests/waiting-room.spec.ts` — contract-v2 waiting room: guest waits, host
  admits from the People panel, guest lands in the meeting.

Notes: specs are written against `docs/api-contract.md` (v1 + v2) and the
known UI strings; v2 features (waiting room) are being built in parallel, so
those specs are expected to be finalized at integration time.
