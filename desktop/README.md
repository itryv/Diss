# Diss Desktop

A real Electron app for macOS and Windows. It wraps the web app in [`../app`](../app) and adds the parts a browser tab cannot do: a menu-bar/tray presence, an always-on-top mini window, system notifications, global shortcuts, a native screen-share picker, and `diss://` deep links.

Implements [desktop-ui-ux-spec.md](../docs/desktop-ui-ux-spec.md). The design showcase of these surfaces lives at `/desktop` in the web app; this is the working version.

## Run it

```bash
npm install
```

**Against the dev server** (hot reload — start `npm --prefix ../app run dev` first):

```bash
npm run dev
```

**Package a real app bundle:**

```bash
npm run pack
```

That builds the renderer with relative asset paths, generates the icon, and writes `dist/mac/Diss.app`. `npm run dist:mac` / `npm run dist:win` produce a DMG / NSIS installer instead.

## Verify a build

```bash
npm run selftest
```

Boots the app, exercises every native path, captures each real window to `selftest-out/*.png`, and exits non-zero on failure (21 checks). For a packaged build, `DISS_SMOKE=1 ./dist/mac/Diss.app/Contents/MacOS/Diss` prints a startup health report and exits.

## The backend

The app talks to the deployed server at **https://diss.remilekun.dev** by default, so an
installed build is online without anything running locally — same backend, same
accounts and meetings as the website.

Point it at a local backend during development:

```bash
npm --prefix ../server run dev                       # terminal 1
DISS_API_ORIGIN=http://localhost:8787 npm run dev    # terminal 2
```

**Why the renderer is served over http, not `file://`.** A `file://` page has a null
origin, and that breaks the two things this app depends on: relative `/api/…` calls
resolve to `file:///api/…`, and the session cookie has nowhere to live — Chromium
refuses credentialed requests on any non-http scheme, custom protocols included
(`app://` fails the same way). So the main process runs a small http server on
`127.0.0.1:8790` that serves the renderer and proxies `/api` to `DISS_API_ORIGIN`. The proxy also strips `Domain=` and `Secure` from upstream `Set-Cookie` headers, which a cookie issued for the API's own host over TLS would otherwise carry — replayed verbatim to a loopback origin the browser drops it and the app looks permanently signed out.
The page then behaves exactly as it does on the web: same-origin requests, ordinary
cookies, no CORS. The port is fixed so the origin — and therefore the session —
survives a restart.

## Architecture

| File | Role |
|---|---|
| `main.js` | Main process: windows, tray, global shortcuts, notifications, deep links, IPC |
| `preload.js` | The only renderer↔main bridge (`window.diss`), context-isolated |
| `scripts/make-icon.js` | Generates `build/icon.png` — no binary assets in the repo |

Three windows, all rendering from the same bundle:

- **Main window** — the full web app. Frameless with inset traffic lights on macOS; native frame on Windows.
- **Mini window** (`#mini` → `app/src/desktop/live/MiniApp.tsx`) — 280×175, always-on-top at `screen-saver` level, visible on all Spaces and over full-screen apps, transparent for real rounded corners, draggable by its body.
- **Tray panel** (`#tray` → `app/src/desktop/live/TrayApp.tsx`) — frameless, hides on blur, measures its own content and asks main to resize, anchored under the menu bar (macOS) or above the tray (Windows).

The satellite windows hold no meeting state of their own: they receive it over IPC (`onMeeting`) and send actions back (`command`). The main window's [`DesktopBridge`](../app/src/desktop/live/DesktopBridge.tsx) reports meeting state upward and executes commands arriving from the OS.

## What is genuinely native

- **Tray icon** with four live states (idle / soon / in-meeting / muted), drawn as a bitmap at runtime; the plain state is a macOS template image so it follows the menu-bar tint.
- **Global shortcuts** — `⌘⇧A` mute, `⌘⇧P` mini window (`Ctrl` on Windows). Registered with the OS, so they fire while another app is focused. Leaving has no global shortcut on purpose.
- **Notifications** via Notification Center / Windows toasts.
- **Screen share** — `desktopCapturer` returns real screens and windows with live thumbnails.
- **Permissions** — macOS camera/mic prompts, and a deep link into the right System Settings pane when access was denied.
- **`diss://join/<code>`** — registered protocol, handled on cold start and while running (single-instance).
- **Close ≠ leave** — closing the meeting window shrinks to the mini window; quitting mid-meeting asks first.

## Permissions

**An explicit allowlist.** Electron grants *every* permission a page requests by
default, so `main.js` installs `setPermissionRequestHandler` and
`setPermissionCheckHandler` that allow only media, display-capture, notifications,
sanitized clipboard writes and fullscreen — and only from the origin we serve.
The self-test proves this discriminates: a page loaded from a different localhost
port gets `NotAllowedError` for `getUserMedia`, while the app's own origin is granted.

**Screen sharing needs `setDisplayMediaRequestHandler`.** Without it Electron
denies `getDisplayMedia` outright, which is a silent failure — the share button
appears to do nothing. The handler opens our own picker window (`#picker`), lists
real `desktopCapturer` sources with live thumbnails, and hands the chosen source
back. **Sharing audio.** The picker can request Electron's native `loopback` audio
alongside the chosen surface. Electron uses WASAPI loopback on Windows and Apple's
native ScreenCaptureKit/CoreAudio Tap path on macOS 13+, so users do not need a
virtual audio device or a second app. Packaged macOS builds include the required
`NSAudioCaptureUsageDescription`; macOS 12 and older remain video-only because the
OS does not provide an application-level desktop-audio capture API there. Local
development uses Electron's documented Screen & System Audio Recording fallback,
because the stock `Electron.app` executable cannot inherit Diss's packaged
Info.plist purpose string.

**Collecting capture sources is order-sensitive.** Ask for screens and windows in
one `getSources` call — or two concurrent ones — and macOS returns some sources
with empty bitmaps, which reach the UI as broken images. They must be fetched one
kind at a time, sequentially, with a retry for empties. The picker requests screens
first and renders them while windows are still being captured, because grabbing a
dozen window bitmaps is the slow part. A source that still has no thumbnail shows a
labelled placeholder — it is perfectly shareable, just not previewable.

**macOS TCC.** Camera, microphone and Screen Recording are OS-level grants:

- Camera and mic are requested via `askForMediaAccess` *before* `getUserMedia` runs.
  Order matters — a TCC denial otherwise surfaces as the same `NotAllowedError` a
  dismissed browser prompt produces, and the lobby would tell people to fix a
  browser setting that doesn't exist on the desktop. When TCC is the blocker the
  lobby says so and offers a button straight into Privacy & Security.
- Screen Recording can't be prompted for directly; macOS only offers it once
  capture is attempted, and the grant needs a relaunch. Settings → Desktop has an
  "Ask macOS" button that triggers it and then offers to restart the app.
- `Info.plist` carries `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`
  (in `package.json` → `build.mac.extendInfo`); without them macOS kills the app
  the moment it touches a device.

**An app that has never asked does not appear in System Settings at all.** macOS
populates Privacy & Security from apps that have actually requested, so "Diss isn't
in the list" is the expected state before first use — not a bug. Because the
camera/mic request otherwise only happens in the pre-join screen (behind a login),
there is a standalone **Permissions window**, reachable signed-out from the app menu
(*Diss → Permissions…*), the tray panel, and the tray's right-click menu. Undecided
permissions get an **Ask macOS** button that fires the real prompt; already-decided
ones can only link out to System Settings, because macOS never re-prompts.

Settings → **Desktop** shows the same panel for signed-in users. Both re-read on
window focus, since grants happen in System Settings rather than in the app.

**Entitlements are not optional.** The app is signed with the hardened runtime,
which refuses camera and microphone access *silently* unless
`build/entitlements.mac.plist` declares `com.apple.security.device.camera` and
`com.apple.security.device.audio-input`. Without them macOS returns `denied`
immediately, never shows a prompt, and never lists the app in Privacy & Security —
so the app looks permanently blocked with no way to unblock it. They must be
applied to the helper processes too (`entitlementsInherit`), because capture runs
in the renderer helper, not the main binary. The self-test asserts all of this on
packaged builds.

If a build ever shipped without them, macOS will have cached a denial. Clear it
with `tccutil reset Camera app.diss.desktop` (and `Microphone`) before retesting.

> **Beware terminal-launched runs when testing TCC.** macOS attributes permissions
> to the *responsible process*, so an app started from a shell inherits the
> terminal's grants and `getMediaAccessStatus` will report them as the app's own.
> Launch from Finder (or `open -a`) to see the app's real status.

**Activation vs. showing a window.** `show()` + `focus()` does not make Diss the
frontmost *application* on macOS — the window appears while the menu bar at the top
of the screen still belongs to whatever was active before. Every real window goes
through `activate()`, which calls `app.focus({ steal: true })`. The tray panel is
the exception: it is an `NSPanel` (`type: 'panel'`) so it can appear without
stealing activation, the way menu-bar apps behave.

## Known gaps

- **Public preview is unsigned.** The v1.0.0 DMGs are downloadable from the Diss site, but no Developer ID identity is installed yet, so they are not notarized and macOS warns on first open. A stable release needs a Developer ID certificate plus notarization credentials.
- **Preferences are in-memory.** The Settings → Desktop toggles round-trip through IPC but reset on quit; they need a small store next.
- **Windows is untested on hardware.** The code paths are there (tray flyout placement, `Ctrl` accelerators, NSIS target) but have only run on macOS.
- **Fonts load from Google Fonts,** so a fully offline launch falls back to system faces. Bundling them is a small follow-up.
