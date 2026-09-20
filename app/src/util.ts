export const initialsOf = (name: string) =>
  (name || 'M C').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

export const fmtElapsed = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m < 10 ? '0' : ''}${m}:${sec % 60 < 10 ? '0' : ''}${sec % 60}`;
};

// ── Human-readable numbers (admin dashboard) ─────────────────────────────────

/** Bytes as KB/MB/GB. `null`/undefined reads as an em dash, never "0 B". */
export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return '—';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(b >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.max(0, Math.round(b))} B`;
}

/** Seconds as `3d 4h`, `4h 12m`, `12m 5s` — for server uptime. */
export function fmtUptime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), rem = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${rem}s`;
  return `${rem}s`;
}

/** Absolute date + time, or an em dash for a missing/unparseable timestamp. */
export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** "just now" / "6m ago" / "3d ago" — compact enough for a table cell. */
export function fmtAgo(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'never';
  const secs = Math.floor((Date.now() - t) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
  return fmtDateTime(iso);
}

// ── Local tile order (drag-to-rearrange) ─────────────────────────────────────
// The order is one person's private preference for one meeting: it is never
// published, and it lives in localStorage keyed by the join code so a refresh
// (or a trip through a breakout room) keeps the layout you arranged.

const tileOrderKey = (code: string) => `diss_tiles_${code}`;

export function loadTileOrder(code: string): string[] | null {
  try {
    const raw = localStorage.getItem(tileOrderKey(code));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((v): v is string => typeof v === 'string');
    return ids.length ? ids : null;
  } catch { return null; }
}

export function saveTileOrder(code: string, order: string[] | null) {
  try {
    if (order === null) localStorage.removeItem(tileOrderKey(code));
    else localStorage.setItem(tileOrderKey(code), JSON.stringify(order.slice(0, 200)));
  } catch { /* private mode */ }
}

/**
 * Sort `items` by a saved order.
 *
 * The saved list is identities, not positions, so the roster can churn under
 * it: anyone named in it keeps their place, anyone new is appended in join
 * order, and anyone who left simply isn't there — the rest never scramble.
 * Identities that left are deliberately KEPT in the stored list, so someone who
 * drops and rejoins lands back where you put them.
 */
export function applyTileOrder<T extends { identity: string }>(items: T[], order: string[] | null | undefined): T[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const known = items.filter(p => rank.has(p.identity));
  if (known.length === 0) return items;
  known.sort((a, b) => rank.get(a.identity)! - rank.get(b.identity)!);
  return [...known, ...items.filter(p => !rank.has(p.identity))];
}

/** Move `key` in `order` to sit before/after `target`. Returns a new array. */
export function moveInOrder(order: string[], key: string, target: string, side: 'before' | 'after'): string[] {
  if (key === target) return order;
  const without = order.filter(k => k !== key);
  const at = without.indexOf(target);
  if (at < 0) return order;
  without.splice(side === 'after' ? at + 1 : at, 0, key);
  return without;
}

/** Round-robin `identities` across `rooms` buckets — the "auto-assign evenly" button. */
export function spreadEvenly(identities: string[], rooms: number): string[][] {
  const out: string[][] = Array.from({ length: Math.max(1, rooms) }, () => []);
  identities.forEach((id, i) => out[i % out.length].push(id));
  return out;
}

/** `<code>__b<idx>` → idx, or null when the room name isn't a breakout room. */
export function breakoutIdxOf(room: string): number | null {
  const m = /__b(\d+)$/.exec(room);
  return m ? Number(m[1]) : null;
}

// ── @mentions ────────────────────────────────────────────────────────────────

export interface MentionTarget { identity: string; name: string; }
export type ChatSeg =
  | { mention: false; text: string }
  | { mention: true; text: string; identity: string };

/** `@all` resolves to the wildcard the contract defines. */
export const MENTION_ALL = '*';

const wordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_'’.-]/.test(c);

/**
 * Split chat text into plain runs and mention runs.
 *
 * One function does double duty: the composer resolves what to SEND from it,
 * and the message list paints chips from it, so what you type, what the server
 * stores and what everyone sees can never disagree. Candidates are matched
 * longest-first so "@Amara Okafor" wins over "@Amara".
 */
export function splitMentions(text: string, targets: MentionTarget[]): ChatSeg[] {
  const cands: { label: string; identity: string }[] = [{ label: 'all', identity: MENTION_ALL }];
  for (const t of targets) {
    const full = t.name.trim();
    if (!full) continue;
    cands.push({ label: full.toLowerCase(), identity: t.identity });
    const first = full.split(/\s+/)[0];
    if (first && first.toLowerCase() !== full.toLowerCase()) {
      cands.push({ label: first.toLowerCase(), identity: t.identity });
    }
  }
  cands.sort((a, b) => b.label.length - a.label.length);

  const segs: ChatSeg[] = [];
  let buf = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@' && !wordChar(text[i - 1])) {
      const rest = text.slice(i + 1).toLowerCase();
      const hit = cands.find(c => rest.startsWith(c.label) && !wordChar(text[i + 1 + c.label.length]));
      if (hit) {
        if (buf) { segs.push({ mention: false, text: buf }); buf = ''; }
        segs.push({ mention: true, text: text.slice(i, i + 1 + hit.label.length), identity: hit.identity });
        i += 1 + hit.label.length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) segs.push({ mention: false, text: buf });
  return segs;
}

/** Identities mentioned in `text` (deduped, capped at the contract's 50). */
export function resolveMentions(text: string, targets: MentionTarget[]): string[] {
  const out: string[] = [];
  for (const seg of splitMentions(text, targets)) {
    if (seg.mention && !out.includes(seg.identity)) out.push(seg.identity);
  }
  return out.slice(0, 50);
}

/** Does this message ping me? `@all` pings everyone. */
export const mentionsMe = (mentions: string[] | undefined, identity: string): boolean =>
  !!mentions && (mentions.includes(MENTION_ALL) || (!!identity && mentions.includes(identity)));

// ── calendar export ─────────────────────────────────────────────────────────

/** A scheduled meeting, in the shape the calendar helpers below need. */
export interface CalendarEvent {
  title: string;
  /** ISO start. Meetings with no start time are treated as starting now. */
  startsAt: string | null;
  link: string;
  hostName?: string;
  /** Minutes. Meetings have no stored duration, so callers pass the default. */
  durationMinutes?: number;
}

const DEFAULT_DURATION_MINUTES = 60;

const eventWindow = (e: CalendarEvent): { start: Date; end: Date } => {
  const start = e.startsAt ? new Date(e.startsAt) : new Date();
  const end = new Date(start.getTime() + (e.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000);
  return { start, end };
};

/** `20260920T143000Z` — the only timestamp format iCalendar and Google agree on. */
const stampUTC = (d: Date): string => `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;

const description = (e: CalendarEvent): string =>
  `Join the meeting: ${e.link}${e.hostName ? `\n\nHosted by ${e.hostName}` : ''}`;

/**
 * RFC 5545 requires CRLF line endings and folding past 75 octets. Escaping
 * matters too: an unescaped comma or semicolon in a title silently truncates
 * the field, so a meeting called "Design, review" would import as "Design".
 */
const icsEscape = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const fold = (line: string): string => {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join('\r\n');
};

/** An .ics file body for one meeting — what Apple Calendar and Outlook import. */
export function buildIcs(e: CalendarEvent): string {
  const { start, end } = eventWindow(e);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Diss//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable per link+start so re-importing updates the event instead of
    // creating a duplicate alongside it.
    `UID:${encodeURIComponent(e.link)}-${stampUTC(start)}@diss`,
    `DTSTAMP:${stampUTC(new Date())}`,
    `DTSTART:${stampUTC(start)}`,
    `DTEND:${stampUTC(end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `DESCRIPTION:${icsEscape(description(e))}`,
    `LOCATION:${icsEscape(e.link)}`,
    `URL:${icsEscape(e.link)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

/** Google Calendar's prefilled-event URL. */
export function googleCalendarUrl(e: CalendarEvent): string {
  const { start, end } = eventWindow(e);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stampUTC(start)}/${stampUTC(end)}`,
    details: description(e),
    location: e.link,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook Web's prefilled-event URL. */
export function outlookCalendarUrl(e: CalendarEvent): string {
  const { start, end } = eventWindow(e);
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: description(e),
    location: e.link,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Hand the browser an .ics file to save. */
export function downloadIcs(e: CalendarEvent, fileName = 'meeting.ics'): void {
  const blob = new Blob([buildIcs(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
