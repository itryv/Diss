# Meet — UI/UX Specification
**Web Video Conferencing Product · Design Handoff Document · v1.0**

> Working name "Meet" is a placeholder — final branding TBD.
> Scope: Web only (desktop-first, responsive down to mobile browsers).
> Audience: UI/UX design team. This doc describes every screen, flow, component, and state the product needs so you can design a complete, coherent system.

---

## 1. Product Overview

We are building a browser-based video conferencing app (a Zoom alternative). The core promise: **click a link, and you're in a working meeting in under 10 seconds — no downloads, no accounts required for guests.**

### Design principles (in priority order)
1. **Zero-friction joining.** A guest with a link should never see a signup wall, an app-store prompt, or a confusing permission flow.
2. **Calm under pressure.** People join meetings late, with broken mics, on bad Wi-Fi. Every error state must offer a clear next action, never a dead end.
3. **The meeting is the product.** In-meeting UI should recede — video is the hero. Controls appear when needed, get out of the way when not.
4. **Progressive disclosure.** Hosts get power tools; guests get simplicity. Never show a guest a control they can't use.

### User roles
| Role | Description | Capabilities |
|---|---|---|
| **Guest** | No account. Joined via link. | Join, AV controls, chat, reactions, screen share (if allowed) |
| **Member** | Registered user. | Everything a guest can do + create/schedule meetings, personal meeting room, history |
| **Host** | Member who created the meeting. | Everything + mute others, remove, lock, waiting room, permissions, end meeting for all |
| **Co-host** | Promoted by host mid-meeting. | Host powers except: end meeting, promote co-hosts |

---

## 2. Information Architecture

```
Marketing site (public)
├── Landing page
├── Pricing (future)
└── Login / Signup

App (authenticated)
├── Home / Dashboard
│   ├── New meeting (instant)
│   ├── Join a meeting (by code/link)
│   ├── Schedule a meeting
│   └── Upcoming & recent meetings list
├── Meeting detail page
├── Recordings library (Tier 2)
└── Settings
    ├── Profile
    ├── Audio & Video defaults
    ├── Notifications
    └── Account

Meeting flow (guests + members)
├── Pre-join lobby  ←  the critical screen
├── Waiting room (if enabled)
├── In-meeting room
└── Post-meeting screen
```

---

## 3. Screens — Detailed Specifications

### 3.1 Landing Page (public)

**Purpose:** Convert visitors; let link-holders join fast.

**Layout & elements:**
- Header: logo (left) · "Sign in" text button + "Sign up free" primary button (right)
- Hero: headline, subhead, two CTAs side by side:
  - **"Start a meeting"** (primary) → signup/login → instant meeting
  - **"Join a meeting"** (secondary) → join-by-code input
- Join-by-code input: single text field accepting a meeting code (`abc-defg-hij`) or full URL. Validates format inline. Enter or "Join" button proceeds to pre-join lobby.
- Feature highlights section, footer (standard).

**States:** invalid code (inline error: "That code doesn't look right — check it and try again"), valid code (button enables).

---

### 3.2 Sign Up / Login

**Purpose:** Fast account creation for hosts. Guests never see this to join.

**Elements:**
- OAuth buttons: **"Continue with Google"**, **"Continue with Microsoft"** (top, most prominent — most users will pick these)
- Divider ("or")
- Email field → magic-link or password flow (design for magic-link primary; password as fallback)
- Toggle between "Sign in" / "Create account" — same screen shell, don't make users hunt for the other mode
- Legal fine print (ToS/privacy links) below the button

**States:** loading (button spinner), OAuth error (toast + retry), email sent confirmation screen ("Check your inbox — link expires in 15 minutes"), invalid email inline validation.

**Key UX rule:** if a user was headed somewhere (e.g., clicked "Start a meeting"), auth must return them there afterward, not dump them on the dashboard.

---

### 3.3 Home / Dashboard (member home)

**Purpose:** The hub. Get into a meeting in ≤2 clicks.

**Layout:** Left sidebar (nav) + main content area.

**Sidebar nav:** Home · Meetings · Recordings · Settings · (bottom) user avatar menu (profile, log out).

**Main area:**
- **Greeting + clock/date** (nice-to-have, orients users joining scheduled calls)
- **Primary action row — 3 large action cards:**
  1. **"New meeting"** (primary color) — starts an instant meeting → pre-join lobby. Has a small dropdown chevron: "Start with video off", "Copy invite link instead" (creates the meeting and copies link without joining).
  2. **"Join"** — opens a modal with a code/link input (same validation as landing page).
  3. **"Schedule"** — opens the scheduling form (3.4).
- **"Up next" card** — if a scheduled meeting starts within 30 min: meeting title, countdown, participant avatars, big **"Join"** button. This is the most important element on the page when present.
- **Upcoming meetings list:** rows with title, date/time, host avatar, "Join" button (enabled from 10 min before start), overflow menu (⋯): copy invite, edit, delete (host only).
- **Recent meetings list:** title, date, duration, participant count; links to meeting detail. If recorded: recording chip → recordings library.
- **Empty states:** first-time user sees a friendly illustration + "Start your first meeting" prompt in place of lists.

---

### 3.4 Schedule a Meeting

**Purpose:** Create a future meeting with a shareable link.

**Form fields:**
- Title (text, required, placeholder "Weekly team sync")
- Date + start time + duration (pickers; default: next half-hour slot, 30 min)
- Time zone (auto-detected, editable)
- Recurrence (Tier 2): none / daily / weekly / custom
- **Security options (collapsible "Meeting options" section):**
  - Waiting room on/off (default **on**)
  - Allow guests to join before host (default off)
  - Participants start muted (default off)
  - Allow screen sharing by non-hosts (default on)
- Description / agenda (optional textarea)

**On save →** confirmation view (not just a toast): meeting title, formatted date/time, **invite link with a big "Copy link" button**, "Copy invitation" (formatted text block with title/time/link for pasting into email), "Add to Google Calendar / Outlook" buttons, "Done".

**Key UX rule:** the copy-link action is the whole point of scheduling. Make it unmissable.

---

### 3.5 Pre-Join Lobby ⭐ (most important screen in the product)

**Purpose:** Let users check they look/sound right and fix device issues *before* entering. Every participant — guest or member — passes through here.

**Layout:** Split screen.
- **Left (~60%): camera preview** — live self-view, mirrored, rounded corners. Overlaid controls (bottom of preview): mic toggle, camera toggle. Name shown as overlay chip.
- **Right (~40%): join panel:**
  - Meeting title + host name ("Weekly sync · hosted by Amara")
  - **Name field** — guests: empty text input, required, autofocused. Members: pre-filled, editable.
  - Device selectors (three dropdowns): Microphone · Camera · Speaker. Each shows current device name.
  - **Mic level meter** — animated bar reacting to voice. Critical: this is how users confirm the mic works. Label: "Speak to test your mic".
  - "Test speaker" link — plays a chime.
  - Background effects (Tier 2): None / Blur / image thumbnails (row of selectable swatches under preview)
  - **"Join now"** — large primary button. If waiting room is on: label reads **"Ask to join"**.

**Permission states (design all of these):**
1. **Permissions not yet requested:** preview area shows prompt: "We need access to your camera and mic" + "Allow access" button (triggers browser prompt). Explain *why* in one line.
2. **Permission denied:** preview shows error state with instructions to re-enable in browser settings (with a small browser-specific hint illustration) + **"Join without camera/mic"** escape hatch (they can still join to listen/watch).
3. **No devices found:** "No camera detected" placeholder (avatar with initials instead of video) — joining still allowed.
4. **Camera in use by another app:** specific error message + retry button.

**Other states:** camera off (show initials avatar on dark tile), meeting hasn't started + join-before-host disabled ("The meeting starts at 3:00 PM — we'll let you in when the host arrives" + auto-join when it opens), meeting locked ("This meeting is locked by the host"), meeting ended, invalid/expired link (friendly 404 with "Go home" CTA).

---

### 3.6 Waiting Room (guest side)

**Purpose:** Hold guests until the host admits them.

**Elements:** calm holding screen — meeting title, "The host will let you in soon", subtle animated indicator (not a spinner that implies loading/breakage), self-preview thumbnail (so they can keep fixing hair/camera), mic/cam toggles, "Leave" button.

**States:** admitted (auto-transition into meeting, brief "You're in" moment), denied ("The host didn't admit you" + go home), host never responds (after 5+ min, gentle "Still waiting… you can keep waiting or leave").

---

### 3.7 In-Meeting Room ⭐⭐ (the product)

**Purpose:** Where users spend 95% of their time. Design this first.

#### 3.7.1 Overall layout

```
┌─────────────────────────────────────────────┐
│ Top bar (auto-hides)                        │
├───────────────────────────────┬─────────────┤
│                               │             │
│   Video area (grid/speaker)   │  Side panel │
│                               │  (chat /    │
│                               │  people —   │
│                               │  open on    │
│                               │  demand)    │
├───────────────────────────────┴─────────────┤
│ Bottom control bar (auto-hides)             │
└─────────────────────────────────────────────┘
```

- Dark theme by default in-meeting (video looks better on dark; standard for the category). The rest of the app is light-first with dark mode support.
- Top + bottom bars fade out after ~4s of no mouse movement; reappear on movement or keyboard focus. Never hide while a menu/panel is open.

#### 3.7.2 Top bar
- Left: meeting title, elapsed timer, recording indicator (red dot + "REC", visible to *everyone* when recording — legally and ethically required)
- Right: view toggle (Grid / Speaker), connection quality indicator (bars icon; click → detail popover: bitrate, latency, packet loss in plain words e.g. "Your connection is unstable"), fullscreen toggle, "Copy invite link" icon button

#### 3.7.3 Video area
- **Grid view:** equal tiles, auto-layout: 1→full, 2→side by side, 3–4→2×2, 5–9→3×3, 10–25→up to 5×5, beyond → pagination (arrows + "page 2 of 3"). Prioritize: screen share > active speakers > camera-on > camera-off.
- **Speaker view:** dominant speaker large; filmstrip of others (top or side, ~6 visible + overflow count "+12"). Active speaker switching must be *damped* — don't flip the big tile on every cough (≈2s stability threshold).
- **Video tile anatomy:** video (or initials avatar on camera-off, with a deterministic per-user background color), name label (bottom-left, truncated w/ tooltip), mic-muted icon (bottom-right, red), **speaking indicator** (animated border/glow when talking — including on muted tiles: pair with a "You're muted" nudge for the speaker themselves), host/co-host badge, hand-raised badge (✋ + queue number), connection-poor icon on the tile, hover overlay (⋯ menu: pin, and for hosts: mute/remove/make co-host).
- **Pinning:** any user can pin a tile locally (pin ≠ spotlight). Hosts can **spotlight** (forces speaker view of that person for everyone).
- **Self-view:** your own tile, mirrored, draggable to corners in speaker view, collapsible to a small pill ("Show self view" to restore).

#### 3.7.4 Screen share (viewing)
- Shared screen takes the main stage; participant videos become the filmstrip.
- Label: "Nkechi is presenting" + (for the presenter) an always-visible **"Stop sharing"** control that floats even when the browser window is minimized (design a small floating toolbar).
- Presenter's own view while sharing: never show their share back to them full-size (infinite mirror); show a placeholder "You're sharing your screen" card + stop button.
- If a second person starts sharing (if allowed): the newest share wins; toast informs the previous presenter.

#### 3.7.5 Bottom control bar (center-aligned cluster)
Order, left → right:
1. **Mic** — toggle. States: on / muted (red slash) / no permission (warning). Chevron sub-menu: mic picker, speaker picker, "Test audio". Push-to-talk: holding **Space** while muted temporarily unmutes (show hint once).
2. **Camera** — toggle + chevron (camera picker, background effects).
3. **Screen share** — opens browser's share picker. Disabled state (host restricted) shows tooltip "The host has turned off screen sharing".
4. **Reactions** — popover: ✋ Raise hand (persistent until lowered; shows queue position) + emoji burst reactions (👍 ❤️ 😂 🎉 👏) that float up over your tile for ~4s.
5. **Chat** — toggles side panel. Unread badge (count).
6. **People** — toggles participant panel. Badge shows count; pulses when someone is in the waiting room (host only).
7. **More (⋯)** — menu: Settings, Start/stop recording (host), Breakout rooms (Tier 3), Fullscreen, Report a problem, Keyboard shortcuts.
8. **Leave** — red, separated from other controls by a gap (prevent accidental clicks). Members/guests: click = confirm popover "Leave meeting?". **Host:** popover with two options — **"Leave meeting"** (assign new host: picker appears) / **"End meeting for all"** (destructive-styled, confirm).

#### 3.7.6 Side panel (chat & people — tabbed)
- Slides in from right (~340px), video area reflows. On narrow screens it overlays instead.
- **Chat tab:** message list (sender name, timestamp on hover, linkified URLs), "Everyone" vs direct-message recipient selector, input with emoji picker, send on Enter. New-message toast when the panel is closed (sender + first line, click to open). Messages are ephemeral (gone when meeting ends) — note this subtly in an empty-state line: "Messages disappear when the meeting ends".
- **People tab:** search/filter field, sections: *Waiting room* (host only — each row: name + Admit / Deny buttons + "Admit all"), *In meeting* (rows: avatar, name, role badge, mic/cam status icons; host hover actions: mute, remove (confirm), make co-host, spotlight). Host-only footer actions: **"Mute all"** (with "allow self-unmute" checkbox), **"Lock meeting"** toggle.

#### 3.7.7 In-meeting settings modal
Tabs: **Audio** (device pickers, mic test meter, noise suppression toggle, "auto-adjust volume"), **Video** (camera picker, preview, background effects, "mirror my video", HD toggle), **General** (theme, entrance chime on/off, show/hide non-video participants).

#### 3.7.8 Notifications & toasts (in-meeting)
Design a consistent toast system (bottom-left, above control bar): "X joined" / "X left" (collapse when rapid: "X and 3 others joined"), "Recording started/stopped" (more prominent — banner, not toast), waiting-room requests (host: name + Admit/Deny inline), "Your connection is unstable" (persistent banner while degraded, with "Turn off incoming video" quick action), host actions ("The host muted you" — with "Unmute" button if allowed), hand raises ("Amara raised their hand ✋").

#### 3.7.9 Keyboard shortcuts (document in a "?" overlay)
`M` mute/unmute · `V` video on/off · `Space` (hold) push-to-talk · `C` chat · `P` people · `F` fullscreen · `⌘/Ctrl+D` copy invite link · `Esc` close panel/exit fullscreen.

---

### 3.8 Post-Meeting Screen

**Purpose:** Graceful exit; don't dump users onto a blank page.

**Elements:** "You left the meeting" headline, **"Rejoin"** button (people misclick Leave constantly — this is essential), "Back to home" (members) / "Start your own meeting — free" (guests, gentle conversion moment), meeting duration summary, optional 1–5 star call-quality rating ("How was the call quality?" + optional issue checkboxes: audio / video / connection — skippable, never blocking).

**Host end-for-all variant:** participants see "The host ended the meeting" (no Rejoin).

---

### 3.9 Meeting Detail Page

For a scheduled/past meeting: title, time, host, join button (upcoming) or summary (past: duration, attendee list, recording playback if any), invite link + copy, edit/delete (host), attendee list.

---

### 3.10 Recordings Library (Tier 2)

Grid/list of recordings: thumbnail, meeting title, date, duration, size. Click → playback page (standard video player + meeting metadata + download + delete (confirm) + share-link with access control: "anyone with link" vs "members of this meeting").

---

### 3.11 Settings (app-level)

- **Profile:** avatar upload, display name, email (read-only if OAuth)
- **Audio & Video:** default devices, default join behavior (mute on join, camera off on join), noise suppression default, background effect default
- **Notifications:** email reminders for scheduled meetings (10 min before), meeting-invite emails
- **Account:** connected accounts (Google/Microsoft), delete account (danger zone, typed confirmation)

---

## 4. Component Inventory (design-system checklist)

Buttons (primary / secondary / ghost / destructive / icon button — each with hover, active, focus-visible, disabled, loading) · toggle buttons with slash-state (mic/cam) · text field, dropdown/select, toggle switch, checkbox, date & time pickers · modal, popover, tooltip, toast, banner · avatar (image + initials fallback + deterministic color) & avatar stack · badge/chip (role, REC, unread count) · video tile (all states from 3.7.3) · mic level meter · connection quality indicator (3 levels) · tabs · empty states (dashboard, chat, recordings, search) · skeleton loaders (dashboard lists, lobby preview) · confirm dialogs (leave, end for all, remove participant, delete) · illustrated error pages (404, expired link, meeting ended, permission denied).

---

## 5. Cross-Cutting Requirements

### 5.1 Responsive behavior
- **Desktop (≥1024px):** everything above.
- **Tablet (768–1023):** side panel overlays video instead of reflowing; grid max 3×3.
- **Mobile web (<768):** this is a real use case (guests click links on phones). Vertical layout: speaker view default, 2×2 grid max, controls in a bottom sheet, chat/people as full-screen sheets, self-view as a small draggable pip. Pre-join lobby stacks vertically (preview on top). Test the browser-permission flows on iOS Safari specifically — it's the most restrictive.

### 5.2 Accessibility (WCAG 2.1 AA)
- Full keyboard operability of every control, visible focus rings (including over video)
- Screen-reader announcements for dynamic events: joins/leaves, chat, mute state changes, hand raises ("Amara raised their hand")
- Captions area reserved in the layout for Tier 3 live captions (bottom-center, above control bar)
- Color contrast ≥4.5:1 for all text, including labels over video (use scrims)
- Never use color alone for state: muted = icon *and* slash, not just red
- Respect `prefers-reduced-motion`: disable emoji-burst animations, replace with static display

### 5.3 Latency & feedback rules
- Every control that touches media (mute, camera, share) must respond **optimistically** — flip the UI instantly, reconcile if the operation fails (revert + toast).
- Joining: show progressive status ("Connecting… Almost there…") — never a silent spinner beyond 2s.
- Reconnection: on network drop, keep the room UI, overlay "Reconnecting…" banner with animated indicator; only after ~30s offer "Leave" / "Keep trying". Never eject the user to an error page automatically.

### 5.4 Tone of voice (microcopy)
Human, calm, blame-free. "We can't hear you — your mic might be muted in your browser" not "Audio input error." Errors always pair with a next step. Confirmation dialogs state consequences plainly: "End meeting for all? 12 people will be disconnected."

---

## 6. Priority Order for Design

1. **In-meeting room** (3.7) — desktop, grid + speaker views, control bar, tiles with all states
2. **Pre-join lobby** (3.5) — including all four permission states
3. **Chat & People panels** (3.7.6)
4. **Dashboard + Join modal + Schedule flow** (3.3, 3.4)
5. **Post-meeting, waiting room, error/edge screens** (3.8, 3.6, states in 3.5)
6. **Mobile web layouts** of 1–3
7. **Settings, recordings, marketing/auth** (3.11, 3.10, 3.1, 3.2)

Deliverables we'd love: component library first (Section 4), then screens composed from it; prototype of the join flow (link → lobby → in-meeting) since that's the make-or-break path.

---

## 7. Open Questions for Design Exploration

1. Brand personality: professional/enterprise (Zoom-like) vs. warm/playful (Around/Gather-like)? Affects everything from color to empty-state illustrations.
2. Self-view default: always visible vs. collapsed by default? (Research suggests self-view fatigue is real.)
3. Reactions scope: emoji bursts only, or persistent on-tile reactions?
4. Dark mode: in-meeting is dark by default — should the whole app default dark?
5. How prominent should the guest→signup conversion moments be without feeling pushy?

---

*Questions? Ping the product/engineering channel. This doc will be versioned as scope evolves — treat Section 6's priority order as the source of truth for what to design first.*
