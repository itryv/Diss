# Frontend v3 contract — real devices, layout, quality

Shared API between the media/plumbing layer (`store.tsx`, `media.ts`, `Lobby.tsx`,
`Shell.tsx`) and the meeting UI (`Meeting.tsx`, `tiles.ts`, `index.css`).
Both sides code against exactly this.

## `app/src/media.ts` (new)

```ts
export type DeviceLists = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };

/** enumerateDevices, split by kind. Labels are only populated after permission
 *  is granted — callers should re-run this after getUserMedia resolves. */
export function listDevices(): Promise<DeviceLists>;

/** Live input level from a MediaStream, 0..1, via WebAudio AnalyserNode.
 *  `stop()` must close the AudioContext. */
export function createLevelMeter(stream: MediaStream): { level(): number; stop(): void };

/** Audible test tone (a short pleasant chime, NOT a raw square wave) routed to
 *  `sinkId` when the browser supports setSinkId. Resolves when playback ends. */
export function playTestTone(sinkId?: string): Promise<void>;

/** True when this browser can route audio to a chosen output device. */
export function canSelectSpeaker(): boolean;
```

## Store state (additions)

```ts
devices: DeviceLists;          // populated by refreshDevices()
micId: string | null;          // null = system default
camId: string | null;
speakerId: string | null;
videoQuality: 'auto' | 'high' | 'saver';   // persisted in localStorage 'diss_qual'
sharing: boolean;              // already exists: any screen share active
shareHasAudio: boolean;        // the active share is also sending audio
shareAudioOnly: boolean;       // sharing computer audio with no video
isNarrow: boolean;             // viewport < 760px (kept current via matchMedia)
```

## Store actions (additions / changes)

```ts
refreshDevices(): Promise<void>;                  // fills state.devices
selectDevice(kind: 'mic' | 'cam' | 'speaker', deviceId: string | null): Promise<void>;
// Applies immediately: lobby preview restarts, in-call uses
// room.switchActiveDevice(); speaker uses setSinkId on the audio elements.

setVideoQuality(q: 'auto' | 'high' | 'saver'): Promise<void>;
// auto  = 720p capture, simulcast on, adaptiveStream on  (default)
// high  = 1080p capture, higher maxBitrate, simulcast on ("Hi-Res")
// saver = 360p capture, low bitrate
// Restarts the published camera track when in a call.

toggleShare(mode: 'screen' | 'screen-audio' | 'audio'): Promise<void>;
// 'screen'       = video only (current behaviour)
// 'screen-audio' = screen video + system/tab audio
// 'audio'        = system audio ONLY, no video published
// Called again while sharing (any mode) = stop sharing.
// Browsers that cannot capture display audio (Safari/Firefox) must toast a
// clear message rather than silently sharing video only.
```

## Layout rules (`tiles.ts` + `Meeting.tsx`)

- Tiles stay **landscape 16:9**. The grid picks the `rows x cols` split that
  maximises tile area for the current participant count and container aspect
  ratio, instead of a hardcoded column count. Everyone on the page fits — no
  scrolling, no wasted space.
- `useTiles()` keeps returning `{ gridTiles, gridPage, gridPages, ... }` but
  replaces `gridCols` with `gridCols` **and** `gridRows` from that solver.
- Page size stays 9 on desktop; on narrow viewports it drops (4) so tiles stay
  legible.

## Responsive rules

- Breakpoints: narrow < 760px, compact < 1100px.
- Narrow: side panels (chat/people) become full-screen sheets rather than a
  fixed 300px sidebar; the control bar wraps and uses larger touch targets
  (min 44px); the self-view shrinks; the top bar collapses to title + count.
- Nothing may cause horizontal page scroll at 360px wide.
