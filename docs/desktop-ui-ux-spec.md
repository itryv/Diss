# Diss Desktop — macOS & Windows UI/UX Specification
**Design Handoff Document · v1.0 · Companion to [ui-ux-spec.md](ui-ux-spec.md)**

> Audience: UI/UX design team.
> Scope: native desktop apps for **macOS** and **Windows**, built as a desktop shell around the existing web app (Electron or Tauri — the web screens render inside it unchanged).
> That architecture matters for design: **the 12 web screens are already designed and shipped.** This document is about what desktop *adds around* them — window chrome, tray/menu bar presence, notifications, the floating mini-meeting window, screen-share tooling, and platform conventions. Do not redesign the existing screens; extend the system.

---

## 1. Why a desktop app (design goals)

1. **Always reachable.** Diss lives in the menu bar / system tray, so joining a meeting never starts with "find the browser tab." One click from anywhere, meeting reminders that actually surface.
2. **Better in-meeting ergonomics.** A floating always-on-top mini window while multitasking, global mute shortcut, real screen-share picking with a share toolbar — things a browser tab can't do well.
3. **Native citizenship.** The app should feel at home on each OS — spacing, window chrome, notification style, and shortcut conventions differ between macOS and Windows, and we follow the platform, not a lowest common denominator.

**Non-goals for v1:** feature divergence from web (desktop gets the same meetings, chat, settings), tablet/touch layouts, Linux (later).

---

## 2. Design language reference (already established — reuse everywhere)

These tokens are extracted from the shipped app. New desktop surfaces must use them.

### Color
| Token | Value | Use |
|---|---|---|
| `bg/app` | `#151210` | App background |
| `bg/meeting` | `#0e0c0a` | In-meeting stage background |
| `bg/raised-1` | `#1a1613` | Sidebars, panels |
| `bg/raised-2` | `#1e1a16` | Cards, list rows |
| `bg/raised-3` | `#241f1a` | Menus, popovers, modals |
| `bg/hover` | `#2a241e` / `#2e2822` | Hover fills |
| `bg/input` | `#1c1815` | Text fields |
| `border/subtle` | `#2a241e` – `#2e2822` | Hairlines |
| `border/strong` | `#362f28` – `#3a332b` | Card & control borders |
| `text/primary` | `#f4eee5` | Headlines, body |
| `text/secondary` | `#a3988a` | Supporting copy |
| `text/tertiary` | `#8a7f70` / `#6f665b` | Meta, placeholders |
| `accent/primary` | `#f08b5f` (hover `#f59e77`, on-accent text `#241209`) | CTAs, selection, focus |
| `accent/soft` | `#f0a97f` | Links, highlighted labels |
| `danger` | `#c94a38` (hover `#d95845`), soft `#e0836f` on `rgba(224,96,79,.12)` | Leave, mute-state, destructive |
| `success` | `#6fbf8f` | Mic-live, connected, positive |
| `warning` | `#e0b45f` / `#f0b45f` | Reconnecting, hand-raise, stars |

### Type
- **Display / headings:** Bricolage Grotesque (700–800, tight letter-spacing)
- **UI / body:** Instrument Sans (400–700)
- Scale in use: 10.5–13.5 meta · 14–15 body · 16–22 section titles · 24–32 page titles · 38–72 display

### Shape & depth
- Radii: 8–12 controls · 14–18 cards/menus · 20–22 large surfaces · 99 pills
- Shadows: `0 12px 40px rgba(0,0,0,.5)` menus/popovers · `0 8px 30px rgba(240,139,95,.25)` primary CTA glow
- Motion: `fadeUp .25–.4s ease` for entrances; breathing/pulse animations for waiting states; `prefers-reduced-motion` respected

### Voice
Human, calm, blame-free ("We can't hear you — your mic might be muted", never "Audio input error"). Every error names a next step.

---

## 3. Platform strategy at a glance

| Area | macOS | Windows |
|---|---|---|
| Window chrome | Frameless, traffic lights inset top-left, content draws to edge | Frameless with custom caption bar; min/max/close top-right (Fluent placement); Mica-style dark backdrop acceptable |
| Persistent presence | **Menu-bar item** (template icon) | **System-tray icon** + jump list on taskbar |
| Notifications | Notification Center, actions on hover | Windows toasts (Action Center), buttons inline |
| Primary modifier | `⌘` | `Ctrl` |
| Settings location | "Settings…" in app menu, `⌘,` | Gear in title bar area / hamburger, `Ctrl+,` |
| Quit behavior | Window close ≠ quit (stays in menu bar) | Window close minimizes to tray (user-configurable) |
| Install/update | .dmg + Sparkle-style silent update | .exe/MSIX + silent update; winget listing |

Design deliverables should include both chrome variants for: main window, meeting window, mini window, and settings.

---

## 4. Window model

Desktop introduces **multiple windows** where web had one page. Design each as its own artifact:

1. **Main window** — the app shell (dashboard, meetings, recordings, settings). Default 1200×800, min 940×640. Remembers size/position.
2. **Meeting window** — created when a meeting starts; separate from the main window so users can keep notes/dashboard open. Default maximized-ish (90%), min 720×480. Closing it = leave-meeting confirm (same popover as web).
3. **Floating mini window (PiP)** — see §7. Always-on-top, frameless, draggable.
4. **Screen-share toolbar** — thin always-on-top strip while sharing (§8).
5. **Settings** — can stay a view inside the main window (as on web); macOS users will expect `⌘,` to open it focused.

Rules:
- Only one meeting window ever exists. Joining a second meeting prompts to leave the first.
- The meeting window title is the meeting name; the main window title is "Diss".
- All windows use `bg/app` and draw their own chrome content (logo/title left on Windows caption bar, none needed on macOS beyond traffic-light padding of 78px).

---

## 5. Menu bar (macOS) / System tray (Windows)

The persistent entry point. Icon: the Diss dot mark — template/monochrome on macOS, monochrome with accent-dot state on Windows.

**Icon states:** idle · meeting soon (subtle accent dot) · **in meeting** (filled accent / red-tinted when mic live) · muted-in-meeting (slash variant).

**Click → dropdown panel** (macOS: NSPopover-style anchored panel; Windows: flyout near tray). Width ~320. Contents top-to-bottom:

1. **"Up next" block** — same card language as dashboard: title, countdown ("in 12 min"), avatar stack, full-width **Join** button. If a meeting is live and the user isn't in it: "Meeting in progress — Join".
2. **If currently in a meeting:** compact in-call strip — meeting name + elapsed, mic/cam toggle buttons, Leave. (Duplicate of mini-window controls, same iconography.)
3. **Quick actions row:** New meeting · Join with code (expands inline input) · Copy personal link.
4. **Today list** — up to 4 upcoming meetings, hover reveals Join/Copy.
5. Footer: Open Diss · Settings · Quit Diss.

Empty state: "Nothing scheduled today — enjoy the quiet" + New meeting button (voice stays warm).

---

## 6. Notifications (system-native)

Use OS notifications, styled by the OS — we design **content, actions, and timing**, not chrome.

| Event | Copy pattern | Actions | Notes |
|---|---|---|---|
| Meeting starting | "Weekly team sync starts in 10 min" | **Join** · Snooze 5 min | The flagship notification; fires even when app is closed-to-tray |
| Meeting started (host waiting) | "Amara started Weekly team sync" | **Join** | |
| Waiting-room request (host, app backgrounded) | "Leila Boum is waiting to join" | **Admit** · View | Deny deliberately NOT in the notification — destructive from a toast is too easy to fat-finger |
| Chat mention/DM while backgrounded | "Priya: can you see my notes?" | Reply (inline field where OS supports) · Open | Suppressed when meeting window is focused |
| Recording ready | "Sprint retro recording is ready" | Open | |
| Disconnected | "You lost connection to Weekly team sync" | **Rejoin** | Only after auto-reconnect fails |

Rules: never notify about something visible in the focused window; respect OS Focus/Do-Not-Disturb; all notification prefs live in Settings → Notifications (extend the existing toggle-row pattern).

---

## 7. Floating mini window (picture-in-picture) ⭐

The signature desktop feature. When the user switches away from the meeting window (or clicks the collapse control), the meeting follows them as a small always-on-top window.

- **Size:** ~320×200 default; snap sizes S/M (280/360 wide). Corner-snapping with magnetic edges; remembers last corner.
- **Content:** active speaker video (or shared screen thumbnail); speaker name chip bottom-left, same style as meeting tiles; self-view omitted at this size.
- **Controls (on hover, fade like the meeting bars):** mic toggle · camera toggle · leave (red) · expand-back. Unread-chat badge dot on the expand control.
- **States:** speaking ring (same `glowPulse` accent ring as tiles) · muted chip · reconnecting overlay (spinner + amber, compact) · "REC" dot when recording.
- Double-click anywhere → restore full meeting window.
- Design both light-content cases: camera-on video and initials-avatar (camera off), on `bg/meeting`.

---

## 8. Screen sharing, desktop-grade

Web uses the browser's picker. Desktop owns the whole flow — design these:

1. **Share picker modal** (in meeting window): grid of live thumbnails — tabs: **Screens** / **Windows** / (later: single app audio). Each item: 16:10 thumbnail, name, radio-select ring in accent. Footer: native "Share audio" toggle (Windows and macOS 13+: system audio), Cancel / **Share** primary.
2. **Sharing state:** the shared screen gets an accent-colored 2px border overlay (industry convention) — our accent `#f08b5f`.
3. **Floating share toolbar** — thin pill, top-center of the *shared* display, always on top, collapsible to a nub: "You're sharing Screen 2" (green text, matches web sharing pill) · pause · **Stop sharing** (red pill, same as web) · timer. Draggable along the top edge.
4. **Presenter safety:** before sharing a screen (not a window), one-time inline warning: "Sharing your whole screen shows notifications too — consider sharing a window." with "Don't remind me".

---

## 9. Deep links, join flows, and calendar

- **Protocol:** `diss://join/<code>` registered on both OSes. Web links (`https://diss.app/<code>`) opened in a browser show a "Open in the Diss app?" interstitial (browser-side, already-designed web style) with "Continue in browser" as the equal-weight escape hatch — never trap guests.
- **Cold-start join:** clicking an invite when the app is closed must go straight to the **pre-join lobby** (existing screen) in under a few seconds; design a branded splash (logo dot pulse on `bg/app`) for the gap.
- **Calendar (v1.5):** read-only calendar association surfaces meetings in the tray "Today" list and powers the starting-soon notification. No new screens beyond a Settings → Calendar row with a Connect button (existing connected-account row pattern from Settings → Account).

---

## 10. Desktop-specific settings (extend existing Settings screen)

New **"Desktop"** tab alongside Profile / Audio & Video / Notifications / Account, using the same pill-tab and toggle-row components:

- Launch Diss when I log in (default off)
- Keep Diss running in the menu bar / tray when I close the window (default on; copy is per-platform)
- Always-on-top mini window when I switch apps (default on)
- Global shortcut to mute/unmute — recorder control (see below)
- Auto-update: "Diss updates itself automatically" info row + current version + "Check now"

**Shortcut recorder** is a new component: a field-style control showing the current combo as keycaps (reuse the keycap style from the shortcuts overlay: `#1c1815` bg, `#362f28` border, mono, accent-soft text), click to record, `Esc` to cancel, "Reset to default".

**Global shortcuts (system-wide, work while any app is focused):**
| Action | macOS | Windows |
|---|---|---|
| Mute/unmute in current meeting | `⌘⇧A` | `Ctrl+Shift+A` |
| Toggle mini window | `⌘⇧P` | `Ctrl+Shift+P` |
| Leave meeting | — (too dangerous globally) | — |

In-meeting shortcuts remain as on web (M/V/C/P/F/Esc, Space push-to-talk); the shortcuts overlay gains a "System-wide" section and renders `⌘` vs `Ctrl` per platform.

---

## 11. OS integration details worth designing

- **Dock (macOS):** badge = unread chat count while backgrounded; dock menu mirrors tray quick actions. Bounce once (not continuously) for waiting-room requests.
- **Taskbar (Windows):** progress-free; overlay icon shows in-meeting state; jump list = New meeting / Join / next 3 meetings.
- **Camera/mic permission (macOS TCC):** first run triggers system prompts — design a pre-permission explainer state reusing the lobby's "We need access…" panel, plus a **denied** state that deep-links to System Settings ("Open Privacy & Security") since in-app retry is impossible. Same for **Screen Recording** permission before first share (macOS requires app restart — say so honestly: "macOS needs Diss to restart once after you allow this").
- **Auto-update:** silent; after an update, a one-line toast on next launch "Diss updated to 1.4 — see what's new" linking release notes. Never modal.
- **Sign-out / quit while in a meeting:** confirm dialog, consequence-first copy ("Quitting will disconnect you from Weekly team sync").

---

## 12. Component inventory (new, beyond the web set)

Tray/menu-bar panel · tray icon state set (4 states × 2 platforms × light/dark menu bar) · custom caption bar (Windows) + traffic-light spacing spec (macOS) · mini window (all states) · share picker modal · share toolbar pill · shortcut recorder field · splash/cold-start frame · notification content templates (per §6) · permission explainer & denied states (macOS) · update toast · confirm-quit dialog.

Everything else reuses the shipped web components unchanged.

---

## 13. Priority order for design

1. **Mini window** (§7) — the reason to install the app
2. **Tray/menu-bar panel + icon states** (§5)
3. **Screen-share picker + toolbar** (§8)
4. **Window chrome** for main & meeting windows, both platforms (§4)
5. Notifications content set (§6) + Desktop settings tab (§10)
6. Permission/first-run states, splash, update & quit dialogs (§11)

Deliverables: Figma pages per platform for chrome-bearing surfaces; shared components where platform-agnostic. A clickable flow of *invite link → cold start → lobby → meeting → switch app → mini window* would de-risk the core promise the same way the join-flow prototype did for web.

---

## 14. Open questions for design exploration

1. Tray panel density — calendar-first (Today list dominant) vs. action-first (big Join/New buttons)?
2. Mini window: strictly active-speaker, or allow a 2-up (speaker + self) at the M size?
3. Windows chrome: full custom dark caption bar vs. system Mica with accent — which reads more "Diss"?
4. Should closing the meeting window minimize to the mini window instead of prompting to leave? (Zoom prompts; Around minimizes. Our "calm under pressure" principle may favor minimize-by-default.)
5. Does the share toolbar live top-center (Zoom) or as a second row in the mini window?

---

*Companion docs: [ui-ux-spec.md](ui-ux-spec.md) (web screens, all reused here) · `app/src/index.css` + `app/src/icons.tsx` (living source of tokens and icon set).*
