export const initialsOf = (name: string) =>
  (name || 'M C').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

export const fmtElapsed = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m < 10 ? '0' : ''}${m}:${sec % 60 < 10 ? '0' : ''}${sec % 60}`;
};

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
