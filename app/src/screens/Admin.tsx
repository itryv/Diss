// Admin dashboard — docs/api-contract-admin.md §8.
//
// Reachable only when `me.isAdmin`: the nav entry in Shell doesn't exist for
// anyone else, and the guard below means a hand-crafted navigation lands on
// "Not authorised" rather than on a wall of failed requests. Everything
// destructive goes through ConfirmModal, which names the exact target and
// spells out what cascades.

import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList, ReactNode } from 'react';
import { api, recordingFileUrl } from '../api';
import type {
  AdminMeeting, AdminRecording, AdminSettings, AdminUser, AuditEntry, LiveRoom,
} from '../api';
import { useApp } from '../store';
import { ShellNav, Toggle } from './Shell';
import { Ic } from '../icons';
import { fmtAgo, fmtBytes, fmtDateTime, fmtUptime } from '../util';

// ── palette (same tokens the rest of the app hard-codes) ─────────────────────
const BG = '#151210';
const CARD = '#1e1a16', CARD_BORDER = '#2e2822';
const CARD_2 = '#241f1a', CARD_2_BORDER = '#362f28';
const TEXT = '#f4eee5', DIM = '#a3988a', DIMMER = '#8a7f70', FAINT = '#6f665b';
const ACCENT = '#f08b5f', ACCENT_SOFT = '#f0a97f';
const DANGER = '#e0836f', DANGER_SOLID = '#c94a38';
const GOOD = '#6fbf8f';

const display = "'Bricolage Grotesque',sans-serif";

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');

type Tab = 'overview' | 'live' | 'users' | 'meetings' | 'recordings' | 'settings' | 'audit';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['live', 'Live'], ['users', 'Users'], ['meetings', 'Meetings'],
  ['recordings', 'Recordings'], ['settings', 'Settings'], ['audit', 'Audit'],
];

const PAGE = 25;

// ── tiny shared pieces ───────────────────────────────────────────────────────

function H1({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <h2 style={{ fontFamily: display, fontWeight: 700, fontSize: 22, margin: 0 }}>{children}</h2>
      {right}
    </div>
  );
}

function Btn({ children, onClick, kind = 'ghost', disabled, title, small }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean; title?: string; small?: boolean;
}) {
  const base: React.CSSProperties = {
    borderRadius: 10, padding: small ? '7px 12px' : '9px 15px', fontWeight: 600,
    fontSize: small ? 12.5 : 13.5, cursor: disabled ? 'default' : 'pointer',
    minHeight: small ? 34 : 40, opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  };
  const kinds: Record<string, React.CSSProperties> = {
    primary: { background: ACCENT, color: '#241209', border: 'none' },
    ghost: { background: CARD_2, color: TEXT, border: `1px solid ${CARD_2_BORDER}` },
    danger: { background: 'none', color: DANGER, border: '1px solid rgba(224,96,79,.5)' },
  };
  const cls = disabled ? '' : kind === 'primary' ? 'hv-primary' : kind === 'danger' ? 'hv-danger-ghost' : 'hv-bg-2a';
  return (
    <button className={cls} onClick={disabled ? undefined : onClick} disabled={disabled} title={title} style={{ ...base, ...kinds[kind] }}>
      {children}
    </button>
  );
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const tones: Record<string, React.CSSProperties> = {
    neutral: { background: '#2a241e', color: DIM },
    good: { background: 'rgba(111,191,143,.14)', color: GOOD },
    warn: { background: 'rgba(240,169,127,.14)', color: ACCENT_SOFT },
    bad: { background: 'rgba(224,96,79,.14)', color: DANGER },
    accent: { background: 'rgba(240,139,95,.16)', color: ACCENT_SOFT },
  };
  return (
    <span style={{ ...tones[tone], borderRadius: 99, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '.01em' }}>
      {children}
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: DIMMER, fontSize: 14, background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 14, padding: '16px 18px' }}>
      {children}
    </div>
  );
}

function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div style={{ border: '1px solid rgba(224,96,79,.4)', background: 'rgba(224,96,79,.07)', borderRadius: 14, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ color: DANGER, fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>That didn't work</div>
        {/* The server's own {error} text, verbatim — never a generic swallow. */}
        <div style={{ color: DIM, fontSize: 13.5, wordBreak: 'break-word' }}>{msg}</div>
      </div>
      {onRetry && <Btn onClick={onRetry} small>Try again</Btn>}
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div style={{ color: DIMMER, fontSize: 14, padding: '4px 2px' }}>Loading {what}…</div>;
}

function Row({ children }: { children: ReactNode }) {
  // A "table row" that is really a card: it wraps instead of scrolling, so a
  // 360px phone never pushes the page sideways.
  return (
    <div className="hv-border" style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 14, padding: '12px 14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      {children}
    </div>
  );
}

function Main({ children }: { children: ReactNode }) {
  return <div style={{ flex: '1 1 240px', minWidth: 0 }}>{children}</div>;
}

function Title({ children }: { children: ReactNode }) {
  return <div style={{ fontWeight: 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>;
}

function Meta({ children }: { children: ReactNode }) {
  return <div style={{ color: DIMMER, fontSize: 12.5, marginTop: 3, wordBreak: 'break-word' }}>{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ flex: '1 1 200px', minWidth: 0, background: '#1c1815', border: `1px solid #3a332b`, borderRadius: 12, padding: '11px 13px', color: TEXT, fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
    />
  );
}

function Pager({ offset, limit, total, onOffset }: { offset: number; limit: number; total: number; onOffset: (n: number) => void }) {
  if (total <= limit) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
      <span style={{ color: DIMMER, fontSize: 13 }}>{from}–{to} of {total}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <Btn small disabled={offset <= 0} onClick={() => onOffset(Math.max(0, offset - limit))}>Previous</Btn>
        <Btn small disabled={to >= total} onClick={() => onOffset(offset + limit)}>Next</Btn>
      </span>
    </div>
  );
}

// ── data loading ─────────────────────────────────────────────────────────────

function useFetch<T>(run: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    runRef.current()
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => { if (alive) setError(errMsg(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, error, loading, reload: useCallback(() => setNonce(n => n + 1), []) };
}

/** Debounce a search box so typing doesn't fire a request per keystroke. */
function useDebounced(value: string, ms = 300) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

// ── confirmation ─────────────────────────────────────────────────────────────

interface ConfirmSpec {
  title: string;
  /** What is about to happen, in plain words. Include the cascade. */
  lines: string[];
  /** The exact thing being acted on — always shown, verbatim. */
  target: string;
  confirmLabel: string;
  /** When set, the button stays dead until this is typed exactly. */
  typeToConfirm?: string;
  run: () => Promise<void>;
}

function ConfirmModal({ spec, onClose, onDone, narrow }: {
  spec: ConfirmSpec; onClose: () => void; onDone: () => void; narrow: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !spec.typeToConfirm || typed.trim() === spec.typeToConfirm;

  const go = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      await spec.run();
      onDone();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => { if (!busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.72)', display: 'flex', alignItems: narrow ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 90, padding: 12 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: narrow ? '100%' : 'min(470px, calc(100vw - 24px))', maxHeight: '90vh', overflowY: 'auto', background: CARD_2, border: '1px solid #3a332b', borderRadius: 20, padding: narrow ? 18 : 24, animation: 'fadeUp .2s ease', marginBottom: narrow ? 'var(--sab)' : 0 }}>
        <h3 style={{ fontFamily: display, fontWeight: 700, fontSize: 19, margin: '0 0 10px', color: TEXT }}>{spec.title}</h3>
        <div style={{ background: '#1a1613', border: `1px solid ${CARD_BORDER}`, borderRadius: 12, padding: '10px 12px', fontFamily: 'monospace', fontSize: 13.5, color: ACCENT_SOFT, wordBreak: 'break-word', marginBottom: 12 }}>
          {spec.target}
        </div>
        <ul style={{ margin: '0 0 16px', paddingLeft: 18, color: DIM, fontSize: 13.5, lineHeight: 1.6 }}>
          {spec.lines.map(l => <li key={l}>{l}</li>)}
        </ul>
        {spec.typeToConfirm && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: DIM, marginBottom: 7 }}>
              Type <span style={{ fontFamily: 'monospace', color: TEXT }}>{spec.typeToConfirm}</span> to confirm
            </label>
            <input
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={spec.typeToConfirm}
              style={{ width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '12px 13px', color: TEXT, fontSize: 14, fontFamily: 'monospace', outline: 'none' }}
            />
          </div>
        )}
        {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} /></div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <button
            className={ready && !busy ? 'hv-danger' : ''}
            onClick={go}
            disabled={!ready || busy}
            style={{
              background: ready && !busy ? DANGER_SOLID : '#2e2822', color: ready && !busy ? '#fff' : FAINT,
              border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 700, fontSize: 13.5,
              minHeight: 40, cursor: ready && !busy ? 'pointer' : 'default', fontFamily: 'inherit',
            }}
          >
            {busy ? 'Working…' : spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Wire a section up to the one shared confirmation modal. */
function useConfirm(onSuccess: () => void) {
  const app = useApp();
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const node = spec ? (
    <ConfirmModal
      spec={spec}
      narrow={app.s.isNarrow}
      onClose={() => setSpec(null)}
      onDone={() => { setSpec(null); onSuccess(); }}
    />
  ) : null;
  return { ask: setSpec, node };
}

// ── 1. Overview ──────────────────────────────────────────────────────────────

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'accent' | 'bad' }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 16, padding: '16px 18px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: DIMMER }}>{label}</div>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: 26, marginTop: 6, color: tone === 'bad' ? DANGER : tone === 'accent' ? ACCENT_SOFT : TEXT, wordBreak: 'break-word' }}>{value}</div>
      {sub && <div style={{ color: DIMMER, fontSize: 12.5, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>{children}</div>;
}

function SubHead({ children }: { children: ReactNode }) {
  return <h3 style={{ fontFamily: display, fontWeight: 700, fontSize: 15, color: DIM, margin: '26px 0 10px' }}>{children}</h3>;
}

function Overview() {
  const { data, error, loading, reload } = useFetch(() => api.admin.overview(), []);
  if (loading && !data) return <><H1>Overview</H1><Loading what="the numbers" /></>;
  if (error && !data) return <><H1>Overview</H1><ErrorBox msg={error} onRetry={reload} /></>;
  if (!data) return null;
  const lk = data.livekit;
  return (
    <>
      <H1 right={<Btn onClick={reload} small>Refresh</Btn>}>Overview</H1>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}
      <StatGrid>
        <Stat label="Users" value={String(data.users.total)} sub={`${data.users.admins} admin${data.users.admins === 1 ? '' : 's'} · ${data.users.disabled} disabled`} />
        <Stat label="Meetings" value={String(data.meetings.total)} sub={`${data.meetings.scheduled} scheduled · ${data.meetings.live} live`} />
        <Stat label="Recordings" value={String(data.recordings.count)} sub={fmtBytes(data.recordings.bytes)} />
        <Stat label="Messages" value={String(data.messages.total)} sub="persisted chat" />
      </StatGrid>

      <SubHead>LiveKit</SubHead>
      {lk.reachable ? (
        <StatGrid>
          <Stat label="Rooms" value={String(lk.rooms)} sub="active right now" tone="accent" />
          <Stat label="Participants" value={String(lk.participants)} sub="connected right now" tone="accent" />
          <Stat label="Status" value="Reachable" sub="the media server answered" />
        </StatGrid>
      ) : (
        // Zeros would read as "quiet"; unreachable means "we don't know".
        <div style={{ border: '1px solid rgba(224,96,79,.45)', background: 'rgba(224,96,79,.08)', borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ color: DANGER, display: 'inline-flex' }}><Ic name="wifiOff" size={18} /></span>
            <span style={{ fontFamily: display, fontWeight: 700, fontSize: 17, color: DANGER }}>LiveKit is unreachable</span>
          </div>
          <div style={{ color: DIM, fontSize: 13.5, lineHeight: 1.55 }}>
            Room and participant counts are unknown — not zero. Nobody can join a call until the media server answers again.
          </div>
          {lk.error && <div style={{ marginTop: 10, fontFamily: 'monospace', fontSize: 12.5, color: ACCENT_SOFT, wordBreak: 'break-word' }}>{lk.error}</div>}
        </div>
      )}

      <SubHead>Storage</SubHead>
      <StatGrid>
        <Stat label="Database" value={fmtBytes(data.storage.dbBytes)} sub="SQLite file" />
        <Stat label="Recordings" value={fmtBytes(data.storage.recordingsBytes)} sub="on disk" />
        <Stat label="Disk free" value={fmtBytes(data.storage.diskFreeBytes)} sub="remaining on the volume" />
      </StatGrid>

      <SubHead>Server</SubHead>
      <StatGrid>
        <Stat label="Uptime" value={fmtUptime(data.server.uptimeS)} sub={`since ${fmtDateTime(data.server.startedAt)}`} />
        <Stat label="Node" value={data.server.nodeVersion || '—'} />
      </StatGrid>
    </>
  );
}

// ── 2. Live rooms ────────────────────────────────────────────────────────────

const LIVE_POLL_MS = 5000;

function Live() {
  const app = useApp();
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [lkError, setLkError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.admin.live();
      setRooms(res.rooms ?? []);
      setReachable(res.reachable !== false);
      setLkError(res.error);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
      setRooms(cur => cur ?? []);
    }
  }, []);

  // Auto-refresh only while this section is mounted — leaving it unmounts the
  // component, which clears the interval. Nothing keeps ticking in the dark.
  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, LIVE_POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const { ask, node } = useConfirm(load);

  const kick = (room: LiveRoom, identity: string, name: string) => ask({
    title: 'Remove this person from the call?',
    target: `${name} · ${room.meetingCode || room.name}`,
    lines: [
      'They are disconnected immediately and everyone else sees them leave.',
      'Nothing stops them rejoining with the meeting link.',
    ],
    confirmLabel: 'Remove them',
    run: async () => { await api.admin.kick(room.name, identity); app.toast(`Removed ${name}`); },
  });

  const endRoom = (room: LiveRoom) => ask({
    title: 'End this room for everyone?',
    target: `${room.meetingTitle || room.meetingCode || room.name} (${room.name})`,
    lines: [
      `All ${room.numParticipants} participant${room.numParticipants === 1 ? '' : 's'} are disconnected at once.`,
      'The meeting itself is kept — only the live room is closed.',
      'Anything being recorded stops here.',
    ],
    confirmLabel: 'End the room',
    run: async () => { await api.admin.endRoom(room.name); app.toast('Room ended'); },
  });

  return (
    <>
      <H1 right={<span style={{ color: FAINT, fontSize: 12.5 }}>Auto-refreshing every {LIVE_POLL_MS / 1000}s</span>}>Live</H1>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={load} /></div>}
      {!reachable && (
        <div style={{ marginBottom: 14, border: '1px solid rgba(224,96,79,.45)', background: 'rgba(224,96,79,.08)', borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ color: DANGER, fontWeight: 700, fontSize: 14 }}>LiveKit is unreachable</div>
          <div style={{ color: DIM, fontSize: 13.5, marginTop: 4 }}>There may well be calls running — we just can't see them right now.</div>
          {lkError && <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12.5, color: ACCENT_SOFT, wordBreak: 'break-word' }}>{lkError}</div>}
        </div>
      )}
      {rooms === null && <Loading what="live rooms" />}
      {rooms !== null && rooms.length === 0 && reachable && !error && (
        <Note>Nothing is live right now.</Note>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(rooms ?? []).map(room => {
          const breakout = /__b\d+$/.test(room.name);
          return (
            <div key={room.name} style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 16, padding: '14px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <Main>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{room.meetingTitle || room.meetingCode || room.name}</span>
                    <Pill tone="good">● Live</Pill>
                    {breakout && <Pill tone="accent">Breakout</Pill>}
                  </div>
                  <Meta>
                    <span style={{ fontFamily: 'monospace' }}>{room.name}</span>
                    {room.hostName ? ` · host ${room.hostName}` : ''}
                    {` · ${room.numParticipants} in the room · started ${fmtAgo(room.startedAt)}`}
                  </Meta>
                </Main>
                <Actions>
                  <Btn kind="danger" small onClick={() => endRoom(room)}>End room</Btn>
                </Actions>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {(room.participants ?? []).length === 0 && (
                  <div style={{ color: FAINT, fontSize: 13 }}>Nobody in this room.</div>
                )}
                {(room.participants ?? []).map(p => (
                  <div key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#1a1613', border: `1px solid ${CARD_BORDER}`, borderRadius: 12, padding: '9px 12px' }}>
                    <Main>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name || p.identity}</span>
                        {p.isHost && <Pill tone="accent">Host</Pill>}
                        {p.isPublishing && <Pill tone="good">Publishing</Pill>}
                      </div>
                      <Meta><span style={{ fontFamily: 'monospace' }}>{p.identity}</span> · joined {fmtAgo(p.joinedAt)}</Meta>
                    </Main>
                    <Btn kind="danger" small onClick={() => kick(room, p.identity, p.name || p.identity)}>Kick</Btn>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {node}
    </>
  );
}

// ── 3. Users ─────────────────────────────────────────────────────────────────

function Users() {
  const app = useApp();
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [query]);

  const { data, error, loading, reload } = useFetch(
    () => api.admin.users({ q: query, limit: PAGE, offset }),
    [query, offset],
  );
  const { ask, node } = useConfirm(reload);
  const meId = String(app.s.user?.id ?? '');

  const toggleDisabled = async (u: AdminUser) => {
    try {
      await api.admin.setUserDisabled(u.id, !u.disabled);
      app.toast(u.disabled ? `${u.name} can sign in again` : `${u.name} is disabled`);
      reload();
    } catch (e) { app.toast(errMsg(e)); }
  };

  const remove = (u: AdminUser) => ask({
    title: 'Delete this account and everything it owns?',
    target: `${u.name} — ${u.email}`,
    lines: [
      'The account and all of its sign-in sessions are deleted.',
      `Their ${u.meetingCount} meeting${u.meetingCount === 1 ? '' : 's'} go too, with every message, waiting guest and breakout attached.`,
      'Their recordings are deleted from disk — the files cannot be recovered.',
    ],
    confirmLabel: 'Delete permanently',
    typeToConfirm: u.email,
    run: async () => { await api.admin.deleteUser(u.id); app.toast(`Deleted ${u.email}`); },
  });

  const users = data?.users ?? [];
  return (
    <>
      <H1 right={<Btn onClick={reload} small>Refresh</Btn>}>Users</H1>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search name or email" />
      </div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}
      {loading && !data && <Loading what="users" />}
      {data && users.length === 0 && (
        <Note>{query ? `No user matches “${query}”.` : 'No users yet.'}</Note>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {users.map(u => {
          const isMe = String(u.id) === meId;
          // Contract §2: the server 400s on an admin or on yourself. Render the
          // reason instead of offering a button that can only fail.
          const guarded = u.isAdmin || isMe;
          return (
            <Row key={String(u.id)}>
              <Main>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Title>{u.name || '(no name)'}</Title>
                  {u.isAdmin && <Pill tone="accent">Admin</Pill>}
                  {isMe && <Pill>You</Pill>}
                  {u.disabled && <Pill tone="bad">Disabled</Pill>}
                </div>
                <Meta>
                  {u.email} · joined {fmtDateTime(u.createdAt)} · {u.meetingCount} meeting{u.meetingCount === 1 ? '' : 's'} · last seen {fmtAgo(u.lastSeenAt)}
                </Meta>
              </Main>
              <Actions>
                {guarded ? (
                  <span style={{ color: FAINT, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Ic name="lock" size={13} />{isMe ? 'Protected — this is your own account' : 'Protected — admins are set in server config'}
                  </span>
                ) : (
                  <>
                    <Btn small onClick={() => toggleDisabled(u)}>{u.disabled ? 'Enable' : 'Disable'}</Btn>
                    <Btn small kind="danger" onClick={() => remove(u)}>Delete…</Btn>
                  </>
                )}
              </Actions>
            </Row>
          );
        })}
      </div>
      <Pager offset={offset} limit={PAGE} total={data?.total ?? 0} onOffset={setOffset} />
      {node}
    </>
  );
}

// ── 4. Meetings ──────────────────────────────────────────────────────────────

function Meetings() {
  const app = useApp();
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [liveOnly, setLiveOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [query, liveOnly]);

  const { data, error, loading, reload } = useFetch(
    () => api.admin.meetings({ q: query, live: liveOnly ? 1 : '', limit: PAGE, offset }),
    [query, liveOnly, offset],
  );
  const { ask, node } = useConfirm(reload);

  const end = (m: AdminMeeting) => ask({
    title: 'End this meeting’s live room?',
    target: `${m.title || 'Untitled meeting'} (${m.code})`,
    lines: [
      `Everyone in the room — ${m.participantCount} right now — is disconnected.`,
      'The meeting, its chat and its recordings are all kept.',
      'The host can start it again with the same link.',
    ],
    confirmLabel: 'End the room',
    run: async () => { await api.admin.endMeeting(m.id); app.toast('Room ended'); },
  });

  const remove = (m: AdminMeeting) => ask({
    title: 'Delete this meeting and everything in it?',
    target: `${m.title || 'Untitled meeting'} (${m.code})`,
    lines: [
      ...(m.live ? ['The live room is ended first — everyone in the call is disconnected.'] : []),
      `${m.messageCount} chat message${m.messageCount === 1 ? '' : 's'} and every waiting guest and breakout room are deleted.`,
      `${m.recordingCount} recording${m.recordingCount === 1 ? '' : 's'} are deleted from disk — the files cannot be recovered.`,
      'The join link stops working for everyone.',
    ],
    confirmLabel: 'Delete permanently',
    typeToConfirm: m.code,
    run: async () => { await api.admin.deleteMeeting(m.id); app.toast('Meeting deleted'); },
  });

  const meetings = data?.meetings ?? [];
  return (
    <>
      <H1 right={<Btn onClick={reload} small>Refresh</Btn>}>Meetings</H1>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search code or title" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', background: CARD, border: `1px solid ${CARD_BORDER}`, borderRadius: 12, padding: '10px 13px', minHeight: 44 }}>
          <span style={{ fontSize: 13.5, color: DIM, whiteSpace: 'nowrap' }}>Live only</span>
          <Toggle on={liveOnly} onToggle={() => setLiveOnly(v => !v)} />
        </label>
      </div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}
      {loading && !data && <Loading what="meetings" />}
      {data && meetings.length === 0 && (
        <Note>{liveOnly ? 'No meeting is live right now.' : query ? `No meeting matches “${query}”.` : 'No meetings yet.'}</Note>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {meetings.map(m => (
          <Row key={String(m.id)}>
            <Main>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Title>{m.title || 'Untitled meeting'}</Title>
                {m.live && <Pill tone="good">● Live · {m.participantCount}</Pill>}
                {m.waitingRoom && <Pill>Waiting room</Pill>}
                {m.locked && <Pill tone="warn">Locked</Pill>}
              </div>
              <Meta>
                <span style={{ fontFamily: 'monospace' }}>{m.code}</span>
                {` · ${m.hostName || 'unknown host'}${m.hostEmail ? ` (${m.hostEmail})` : ''}`}
                {` · ${m.startsAt ? fmtDateTime(m.startsAt) : 'instant'} · created ${fmtAgo(m.createdAt)}`}
                {` · ${m.messageCount} message${m.messageCount === 1 ? '' : 's'} · ${m.recordingCount} recording${m.recordingCount === 1 ? '' : 's'}`}
              </Meta>
            </Main>
            <Actions>
              {m.live && <Btn small onClick={() => end(m)}>End room</Btn>}
              <Btn small kind="danger" onClick={() => remove(m)}>Delete…</Btn>
            </Actions>
          </Row>
        ))}
      </div>
      <Pager offset={offset} limit={PAGE} total={data?.total ?? 0} onOffset={setOffset} />
      {node}
    </>
  );
}

// ── 5. Recordings ────────────────────────────────────────────────────────────

function Recordings() {
  const app = useApp();
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useFetch(
    () => api.admin.recordings({ limit: PAGE, offset }),
    [offset],
  );
  const { ask, node } = useConfirm(reload);
  const [playing, setPlaying] = useState<AdminRecording | null>(null);

  const remove = (r: AdminRecording) => ask({
    title: 'Delete this recording?',
    target: `${r.meetingTitle || r.meetingCode} · ${fmtDateTime(r.startedAt)}`,
    lines: [
      'The database row and the MP4 on disk are both deleted.',
      'Nobody — including the host — will be able to watch it again.',
      r.missing ? 'The file is already missing; only the row will go.' : `${fmtBytes(r.sizeBytes)} of disk is freed.`,
    ],
    confirmLabel: 'Delete permanently',
    run: async () => { await api.admin.deleteRecording(r.id); app.toast('Recording deleted'); },
  });

  const recs = data?.recordings ?? [];
  return (
    <>
      <H1 right={<Btn onClick={reload} small>Refresh</Btn>}>Recordings</H1>
      {data && (
        <div style={{ marginBottom: 14, color: DIM, fontSize: 13.5 }}>
          {data.total} recording{data.total === 1 ? '' : 's'} · <span style={{ color: ACCENT_SOFT, fontWeight: 700 }}>{fmtBytes(data.totalBytes)}</span> on disk
        </div>
      )}
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}
      {loading && !data && <Loading what="recordings" />}
      {data && recs.length === 0 && <Note>No recordings on this server yet.</Note>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {recs.map(r => (
          <Row key={String(r.id)}>
            <button
              onClick={() => { if (!r.missing) setPlaying(r); }}
              disabled={!!r.missing}
              title={r.missing ? 'The file is missing from disk' : 'Play recording'}
              style={{ width: 40, height: 40, borderRadius: '50%', background: CARD_2, border: `1px solid ${CARD_2_BORDER}`, color: r.missing ? '#3a332b' : ACCENT_SOFT, cursor: r.missing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 3, flexShrink: 0 }}
            >
              <Ic name="play" size={14} />
            </button>
            <Main>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Title>{r.meetingTitle || r.meetingCode}</Title>
                {r.missing && <Pill tone="bad">File missing</Pill>}
                {!r.endedAt && <Pill tone="warn">Still recording</Pill>}
              </div>
              <Meta>
                <span style={{ fontFamily: 'monospace' }}>{r.meetingCode}</span>
                {r.hostName ? ` · ${r.hostName}` : ''}
                {` · ${fmtDateTime(r.startedAt)} · ${r.missing ? 'no file on disk' : fmtBytes(r.sizeBytes)}`}
              </Meta>
            </Main>
            <Actions>
              <Btn small disabled={!!r.missing} onClick={() => window.open(recordingFileUrl(r.id), '_blank')}>Open</Btn>
              <Btn small kind="danger" onClick={() => remove(r)}>Delete…</Btn>
            </Actions>
          </Row>
        ))}
      </div>
      <Pager offset={offset} limit={PAGE} total={data?.total ?? 0} onOffset={setOffset} />
      {playing && (
        <div onClick={() => setPlaying(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(880px, calc(100vw - 24px))', background: '#1a1613', border: '1px solid #3a332b', borderRadius: 18, overflow: 'hidden', animation: 'fadeUp .25s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playing.meetingTitle || playing.meetingCode}</div>
              <button className="hv-fg" onClick={() => setPlaying(null)} style={{ background: 'none', border: 'none', color: FAINT, cursor: 'pointer', padding: 4 }}><Ic name="close" size={16} /></button>
            </div>
            <video src={recordingFileUrl(playing.id)} controls autoPlay style={{ display: 'block', width: '100%', aspectRatio: '16/9', background: '#0e0c0a' }} />
          </div>
        </div>
      )}
      {node}
    </>
  );
}

// ── 6. Settings ──────────────────────────────────────────────────────────────

const SETTING_COPY: [keyof AdminSettings, string, string][] = [
  ['registrationOpen', 'Open registration',
    'Anyone with the link can create an account. Turn this off and sign-up is closed — existing people can still sign in, but new accounts can only be made by an admin on the server.'],
  ['defaultWaitingRoom', 'New meetings start with a waiting room',
    'Guests wait for the host to admit them. Applies to meetings created from now on; existing meetings keep their own setting.'],
  ['defaultAllowShare', 'New meetings allow screen sharing',
    'Whether participants can share their screen without the host turning it on.'],
  ['defaultAllowChat', 'New meetings allow chat',
    'Whether participants can send messages in the meeting.'],
  ['defaultAllowUnmute', 'New meetings let people unmute themselves',
    'When off, only the host can unmute someone.'],
];

function Settings() {
  const app = useApp();
  const { data, error, loading, reload } = useFetch(() => api.admin.settings(), []);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => { if (data) setSettings(data.settings); }, [data]);

  const flip = async (key: keyof AdminSettings) => {
    if (!settings || busyKey) return;
    const next = !settings[key];
    setBusyKey(key);
    setSaveError(null);
    // Optimistic, because a toggle that lags feels broken — reverted on failure.
    setSettings({ ...settings, [key]: next });
    try {
      const res = await api.admin.patchSettings({ [key]: next });
      setSettings(res.settings);
      app.toast('Setting saved');
    } catch (e) {
      setSettings(cur => (cur ? { ...cur, [key]: !next } : cur));
      setSaveError(errMsg(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <H1 right={<Btn onClick={reload} small>Refresh</Btn>}>Settings</H1>
      {loading && !settings && <Loading what="settings" />}
      {error && !settings && <ErrorBox msg={error} onRetry={reload} />}
      {saveError && <div style={{ marginBottom: 14 }}><ErrorBox msg={saveError} /></div>}
      {settings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
          {SETTING_COPY.map(([key, label, help]) => {
            const on = !!settings[key];
            const isReg = key === 'registrationOpen';
            return (
              <div key={key} style={{ background: CARD, border: `1px solid ${isReg && on ? 'rgba(240,169,127,.35)' : CARD_BORDER}`, borderRadius: 14, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14.5 }}>{label}</span>
                    {isReg && (on ? <Pill tone="warn">Public sign-up is ON</Pill> : <Pill tone="good">Sign-up closed</Pill>)}
                  </div>
                  <div style={{ color: DIMMER, fontSize: 13, lineHeight: 1.55, marginTop: 5 }}>{help}</div>
                </div>
                {/* inline-flex, not inline: Toggle is a sized <span> and only
                    takes its width as a flex item. */}
                <span style={{ display: 'inline-flex', paddingTop: 3, opacity: busyKey === key ? 0.5 : 1 }}>
                  <Toggle on={on} onToggle={() => flip(key)} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── 7. Audit ─────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  'user.disable': 'disabled a user', 'user.enable': 're-enabled a user', 'user.delete': 'deleted a user',
  'meeting.delete': 'deleted a meeting', 'meeting.end': 'ended a meeting room',
  'live.kick': 'removed someone from a room', 'live.end': 'ended a live room',
  'recording.delete': 'deleted a recording', 'settings.update': 'changed settings',
};

const isDestructive = (a: string) => a.endsWith('.delete') || a.endsWith('.kick') || a === 'user.disable';

/** `detail` is a short JSON blob per the contract — show it as readable pairs. */
/**
 * Render an audit entry's `detail` as a one-line string.
 *
 * The server returns `detail` ALREADY PARSED as an object (admin contract §7).
 * This used to be typed as a JSON string and ran JSON.parse() on it, which
 * throws on an object ("[object Object]" is not JSON) — the catch then handed
 * the object straight back, and React died rendering an object as a child,
 * blanking the entire dashboard. So: accept anything, and only parse strings.
 */
function fmtDetail(detail: unknown): string {
  if (detail === null || detail === undefined || detail === '') return '';
  let value: unknown = detail;
  if (typeof detail === 'string') {
    try { value = JSON.parse(detail); } catch { return detail; }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function Audit() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useFetch(
    () => api.admin.audit({ limit: PAGE, offset }),
    [offset],
  );
  const entries: AuditEntry[] = data?.entries ?? [];
  return (
    <>
      <H1 right={<Btn onClick={reload} small>Refresh</Btn>}>Audit log</H1>
      <div style={{ color: DIMMER, fontSize: 13, marginBottom: 14 }}>Every state-changing admin action, newest first.</div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}
      {loading && !data && <Loading what="the audit log" />}
      {data && entries.length === 0 && <Note>Nothing has been done from this dashboard yet.</Note>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(e => {
          const actor = e.actorEmail ?? e.actor_email ?? 'unknown';
          const action = e.action ?? '';
          const targetType = e.targetType ?? e.target_type ?? '';
          const targetId = e.targetId ?? e.target_id ?? null;
          const when = e.createdAt ?? e.created_at;
          const detail = fmtDetail(e.detail);
          return (
            <Row key={String(e.id)}>
              <Main>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{actor}</span>
                  <span style={{ color: DIM, fontSize: 13.5 }}>{ACTION_LABEL[action] ?? action}</span>
                  <Pill tone={isDestructive(action) ? 'bad' : 'neutral'}>{action}</Pill>
                </div>
                <Meta>
                  {targetType ? `${targetType}${targetId !== null && targetId !== undefined ? ` #${targetId}` : ''} · ` : ''}
                  {fmtDateTime(when)} · {fmtAgo(when)}
                </Meta>
                {detail && (
                  <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12, color: FAINT, wordBreak: 'break-word' }}>{detail}</div>
                )}
              </Main>
            </Row>
          );
        })}
      </div>
      <Pager offset={offset} limit={PAGE} total={data?.total ?? 0} onOffset={setOffset} />
    </>
  );
}

// ── screen ───────────────────────────────────────────────────────────────────

/**
 * Catches a render error in one admin section and shows it, instead of letting
 * React unmount the tree and leave an unexplained blank page.
 */
class SectionBoundary extends Component<
  { section: string; children: ReactNode },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error('[admin] section render failed', err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ background: 'rgba(224,96,79,.09)', border: `1px solid ${DANGER}`, borderRadius: 14, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>This section failed to render</div>
        <div style={{ color: DIM, fontSize: 13.5, marginBottom: 10 }}>
          The rest of the dashboard still works — switch sections and back to retry.
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: FAINT, wordBreak: 'break-word' }}>
          {this.state.err.message}
        </div>
      </div>
    );
  }
}

function NotAuthorised() {
  const app = useApp();
  return (
    <div style={{ maxWidth: 460 }}>
      <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(224,96,79,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: DANGER, marginBottom: 16 }}>
        <Ic name="lock" size={22} />
      </div>
      <h1 style={{ fontFamily: display, fontWeight: 700, fontSize: 26, margin: '0 0 8px' }}>Not authorised</h1>
      <p style={{ color: DIM, fontSize: 14.5, lineHeight: 1.6, margin: '0 0 20px' }}>
        This area is for server administrators. Admins are set in the server's configuration, so there is nothing to request here.
      </p>
      <Btn kind="primary" onClick={() => app.go('dash')}>Back to home</Btn>
    </div>
  );
}

export default function Admin() {
  const app = useApp();
  const s = app.s;
  const narrow = s.isNarrow;
  const [tab, setTab] = useState<Tab>('overview');

  const surface: React.CSSProperties = {
    position: 'fixed', inset: 0, overflowY: 'auto', zIndex: 40,
    background: BG, color: TEXT,
    fontFamily: "'Instrument Sans',sans-serif", WebkitFontSmoothing: 'antialiased',
  };

  const body = (
    <main style={{
      flex: 1, minWidth: 0, maxWidth: 1100,
      padding: narrow
        ? '20px calc(16px + var(--sar)) calc(48px + var(--sab)) calc(16px + var(--sal))'
        : 'calc(32px + var(--sat)) calc(40px + var(--sar)) calc(56px + var(--sab)) 40px',
    }}>
      {/* Boot may still be resolving the session — don't accuse someone of
          being unauthorised before we know who they are. */}
      {!s.bootChecked ? <Loading what="your session" />
        : !s.user?.isAdmin ? <NotAuthorised />
        : (
          <div style={{ animation: 'fadeUp .3s ease' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: display, fontWeight: 700, fontSize: narrow ? 26 : 30, margin: 0 }}>Admin</h1>
              <div style={{ color: FAINT, fontSize: 13 }}>Signed in as {s.user.email}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, margin: '18px 0 22px', overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  style={{
                    background: tab === k ? ACCENT : CARD_2, color: tab === k ? '#241209' : DIM,
                    border: 'none', borderRadius: 99, padding: '9px 16px', fontWeight: 600,
                    fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    minHeight: 40, fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Keyed on the tab so switching sections clears a previous crash.
                Without a boundary, one unexpected field from the API takes the
                whole dashboard to a blank screen with nothing to act on. */}
            <SectionBoundary key={tab} section={tab}>
              {tab === 'overview' && <Overview />}
              {tab === 'live' && <Live />}
              {tab === 'users' && <Users />}
              {tab === 'meetings' && <Meetings />}
              {tab === 'recordings' && <Recordings />}
              {tab === 'settings' && <Settings />}
              {tab === 'audit' && <Audit />}
            </SectionBoundary>
          </div>
        )}
    </main>
  );

  return (
    <div style={surface}>
      <section style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: '100%' }}>
        <ShellNav row={narrow} />
        {body}
      </section>
    </div>
  );
}
