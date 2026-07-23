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

## What's real vs. simulated

Real: camera/mic capture and preview (`getUserMedia`, with denied/no-device/busy error states), all UI interaction, chat input, keyboard shortcuts. Simulated: remote participants (static roster + rotating active speaker), screen share, recording, connection stats — these are the seams where a media layer (LiveKit is the recommended one) plugs in.
