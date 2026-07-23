# Diss — web meeting app

Implementation of the Claude Design prototype `Diss.dc.html` (source in `../design/`) as a Vite + React + TypeScript app. All 12 screens from the [UI/UX spec](../docs/ui-ux-spec.md) are implemented: landing, auth, dashboard, schedule (+ confirmation), meeting detail, recordings, settings, pre-join lobby (all 5 permission states), waiting room, in-meeting (grid/speaker views, chat & people panels, host controls, reactions, recording, reconnect handling), and post-meeting.

## Run

```bash
npm install
npm run dev   # http://localhost:5173
```

## Structure

- `src/store.tsx` — global app state, screen routing, timers (clock, simulated active speaker), keyboard shortcuts (M/V/C/P/Esc), `getUserMedia` handling
- `src/tiles.ts` — derives participant tile view-models (speaking ring, mute/hand/host badges, pinning)
- `src/screens/` — one file per screen area; `Meeting.tsx` is the in-meeting room
- `src/icons.tsx` — the design's SVG icon set
- `src/ProtoNav.tsx` — floating prototype switcher (bottom-right): jump to any screen, switch host/guest role, participant count, waiting room on/off

## What's real vs. stubbed

Real: auth (register/login/logout/session cookie via the backend, see `../docs/api-contract.md`), meeting create/list/delete, join codes and `?join=<code>` links, camera/mic preview (`getUserMedia`, with denied/no-device/busy error states), and the full in-meeting experience over LiveKit (`livekit-client`): participants, video/audio tracks, active speaker, mute/camera/screen-share toggles, chat + reactions + hand-raise over data messages (topics `chat` / `reaction` / `hand`), host moderation (mute/remove), reconnect banner from room events.

Stubbed for v1: waiting room, recording, detailed connection stats, calendar export, OAuth sign-in, recordings/meeting-detail screens. The ProtoNav "In-meeting" jump renders the meeting screen with a clearly-named dev fallback roster (`devFallbackPeers`) without connecting.

Dev servers expected: backend on `http://localhost:8787` (Vite proxies `/api`), LiveKit dev server per the contract doc.
