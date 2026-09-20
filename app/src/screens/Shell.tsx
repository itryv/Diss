import { useEffect, useState } from 'react';
import { useApp, PALETTE, SCHED_OPTIONS } from '../store';
import type { AppState, VideoQuality } from '../store';
import { DevicePicker } from './Lobby';
import { api, meetingLink, recordingFileUrl } from '../api';
import type { Meeting, Recording } from '../api';
import { Ic } from '../icons';
import { BackgroundPicker } from './BackgroundPicker';
import { Transcript } from './Transcript';
import { PermissionsPanel } from '../desktop/live/PermissionsPanel';
import { isDesktopApp } from '../desktop/live/bridge';
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl } from '../util';
import type { CalendarEvent } from '../util';

const inputStyle: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 14px', color: '#f4eee5', fontSize: 15, fontFamily: 'inherit', outline: 'none' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#a3988a', marginBottom: 7 };
const selectStyle: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 10px', color: '#f4eee5', fontSize: 14, fontFamily: 'inherit', outline: 'none' };

/**
 * A real switch, not a clickable span.
 *
 * As a <span onClick> this was the sole control for roughly fifteen settings
 * across Settings, the schedule form, the lobby and the admin dashboard, and
 * none of them could be reached from the keyboard at all. The <label> wrapper
 * did not help either: a label with no form control inside it is inert, so even
 * clicking the words did nothing — only the 38x22 pill was a hit target.
 *
 * `aria-label` is optional because ToggleRow labels it by association instead.
 */
export function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      style={{ width: 38, height: 22, borderRadius: 99, background: on ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .15s', flexShrink: 0, cursor: 'pointer', border: 'none', padding: 0 }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#f4eee5', transition: 'left .15s' }} />
    </button>
  );
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  // The whole row is the control, so the label text is clickable and the touch
  // target clears 44px, rather than being the pill alone.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '4px 0' }}
    >
      <span style={{ fontSize: 14, color: '#c9beb0' }}>{label}</span>
      <span aria-hidden="true" style={{ width: 38, height: 22, borderRadius: 99, background: on ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#f4eee5', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

function useToggleList(key: 'schedOpts' | 'avOpts' | 'notifOpts') {
  const app = useApp();
  return (i: number) => () => {
    const arr = app.s[key].slice();
    arr[i] = !arr[i];
    app.patch({ [key]: arr } as Partial<AppState>);
  };
}

function NavButton({ icon, label, active, onClick, nowrap }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; nowrap?: boolean }) {
  return (
    <button className="hv-bg-2a" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, background: active ? '#2a241e' : 'none', color: active ? '#f4eee5' : '#a3988a', border: 'none', borderRadius: 10, padding: nowrap ? 10 : '11px 12px', minHeight: 44, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left', whiteSpace: nowrap ? 'nowrap' : undefined }}>
      <span style={{ display: 'inline-flex' }}>{icon}</span>{label}
    </button>
  );
}

/**
 * The app sidebar.
 *
 * `row` lays it out as the scrollable top bar that index.css produces below
 * 760px — the admin screen paints its own surface, so it asks for that layout
 * in JS instead of inheriting the stylesheet's `.shell-screen` rules.
 */
export function ShellNav({ row = false }: { row?: boolean }) {
  const app = useApp();
  const s = app.s;
  const navStyle: React.CSSProperties = row
    ? {
        width: '100%', flexShrink: 0, background: '#1a1613', borderBottom: '1px solid #2a241e',
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: 'calc(8px + var(--sat)) calc(10px + var(--sar)) 8px calc(10px + var(--sal))',
        overflowX: 'auto', scrollbarWidth: 'none',
      }
    : {
        width: 232, flexShrink: 0, background: '#1a1613', borderRight: '1px solid #2a241e',
        display: 'flex', flexDirection: 'column', padding: '20px 12px',
      };
  return (
    <nav style={navStyle}>
      <div onClick={() => app.go('dash')} style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: row ? 20 : 22, padding: row ? '0 10px 0 4px' : '4px 12px 20px', cursor: 'pointer', flexShrink: 0 }}>diss<span style={{ color: '#f08b5f' }}>.</span></div>
      <div style={{ display: 'flex', flexDirection: row ? 'row' : 'column', gap: row ? 6 : 2 }}>
        <NavButton icon={<Ic name="home" size={18} />} label="Home" active={s.screen === 'dash'} onClick={() => app.go('dash')} nowrap={row} />
        <NavButton icon={<Ic name="grid" size={17} />} label="Meetings" active={s.screen === 'detail'} onClick={() => app.go('dash')} nowrap={row} />
        <NavButton icon={<Ic name="disc" size={17} />} label="Recordings" active={s.screen === 'recordings'} onClick={() => app.go('recordings')} nowrap={row} />
        <NavButton icon={<Ic name="gear" size={17} />} label="Settings" active={s.screen === 'settings'} onClick={() => app.go('settings')} nowrap={row} />
        {/* Admin contract §8: the entry simply does not exist for anyone else. */}
        {s.user?.isAdmin && (
          <NavButton icon={<Ic name="lock" size={17} />} label="Admin" active={s.screen === 'admin'} onClick={() => app.go('admin')} nowrap={row} />
        )}
      </div>
      <div className="hv-bg-2a" onClick={() => app.go('settings', { settingsTab: 'account' })} style={{ marginTop: 'auto', display: row ? 'none' : 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, cursor: 'pointer' }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{(s.user?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.user?.name ?? 'Guest'}</div>
          <div style={{ fontSize: 12, color: '#968a7b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.user?.email ?? ''}</div>
        </div>
      </div>
    </nav>
  );
}

function fmtWhen(m: Meeting): string {
  if (!m.startsAt) return 'Instant meeting';
  const d = new Date(m.startsAt);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

function Dashboard() {
  const app = useApp();
  const s = app.s;
  useEffect(() => { app.loadMeetings(); /* refresh on entering the dashboard */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const upNext = s.meetings.find(m => m.startsAt && new Date(m.startsAt).getTime() > Date.now());
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (s.user?.name || 'there').split(' ')[0];
  const cardBtn: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, background: '#241f1a', color: '#f4eee5', border: '1px solid #362f28', borderRadius: 18, padding: 22, cursor: 'pointer', textAlign: 'left' };
  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 32, margin: 0 }}>{greeting}, {firstName}</h1>
        <div style={{ color: '#968a7b', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{s.clock} · {s.dateStr}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginTop: 26 }}>
        <div style={{ position: 'relative' }}>
          <button className="hv-bright" onClick={() => app.createInstantMeeting(true)} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, background: 'linear-gradient(135deg,#f08b5f,#e2734a)', color: '#241209', border: 'none', borderRadius: 18, padding: 22, cursor: 'pointer', textAlign: 'left' }}>
            <Ic name="video" size={26} />
            <span style={{ fontWeight: 700, fontSize: 17 }}>New meeting</span>
            <span style={{ fontSize: 13, opacity: 0.75 }}>Start one right now</span>
          </button>
          <button onClick={() => app.patch({ newMenuOpen: !s.newMenuOpen })} style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(36,18,9,.15)', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: '#241209', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic name="chevronDown" size={13} />
          </button>
          {s.newMenuOpen && (
            <div style={{ position: 'absolute', top: 48, right: 10, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 12, padding: 6, zIndex: 30, boxShadow: '0 12px 40px rgba(0,0,0,.5)', minWidth: 220 }}>
              <button className="hv-bg-2e" onClick={() => { app.patch({ newMenuOpen: false }); app.createInstantMeeting(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#f4eee5', padding: '10px 12px', fontSize: 14, borderRadius: 8, cursor: 'pointer' }}>Start with video off</button>
            </div>
          )}
        </div>
        <button className="hv-bg-2a" onClick={() => app.patch({ joinModal: true, code: '', codeInvalid: false })} style={cardBtn}>
          <Ic name="arrowRight" size={26} />
          <span style={{ fontWeight: 700, fontSize: 17 }}>Join</span>
          <span style={{ fontSize: 13, color: '#968a7b' }}>With a code or link</span>
        </button>
        <button className="hv-bg-2a" onClick={() => app.go('schedule')} style={cardBtn}>
          <Ic name="calendar" size={26} />
          <span style={{ fontWeight: 700, fontSize: 17 }}>Schedule</span>
          <span style={{ fontSize: 13, color: '#968a7b' }}>Plan it, share the link</span>
        </button>
      </div>
      {upNext && (
        <div style={{ marginTop: 22, background: 'linear-gradient(120deg,rgba(240,139,95,.12),rgba(240,139,95,.04))', border: '1px solid rgba(240,139,95,.3)', borderRadius: 18, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#f0a97f', textTransform: 'uppercase', marginBottom: 6 }}>Up next</div>
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20 }}>{upNext.title}</div>
            <div style={{ color: '#a3988a', fontSize: 13.5, marginTop: 2 }}>{fmtWhen(upNext)} · hosted by you</div>
          </div>
          <button className="hv-primary" onClick={() => app.openMeeting(upNext)} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '13px 30px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Join</button>
        </div>
      )}
      <div style={{ marginTop: 30 }}>
        <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, margin: '0 0 12px', color: '#c9beb0' }}>Your meetings</h3>
        {s.meetingsLoading && s.meetings.length === 0 && (
          <div style={{ color: '#968a7b', fontSize: 14 }}>Loading…</div>
        )}
        {!s.meetingsLoading && s.meetings.length === 0 && (
          <div style={{ color: '#968a7b', fontSize: 14, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '16px 18px' }}>
            Nothing on the books yet — start a meeting or schedule one.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
          {s.meetings.map(m => (
            <div key={m.id} className="hv-border" style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '13px 16px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title || 'Untitled meeting'}</div>
                <div style={{ color: '#968a7b', fontSize: 12.5 }}>{fmtWhen(m)} · <span style={{ fontFamily: 'monospace' }}>{m.code}</span></div>
              </div>
              <button onClick={() => app.openMeeting(m)} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 9, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Join</button>
              <button className="hv-fg" onClick={() => { navigator.clipboard?.writeText(meetingLink(m.code)); app.toast('Invite link copied'); }} title="Copy invite link" style={{ background: 'none', border: 'none', color: '#9a9084', cursor: 'pointer', padding: 4 }}><Ic name="link" size={16} /></button>
              <button className="hv-fg" onClick={() => app.go('transcript', { meeting: m })} title="View transcript" aria-label={`View transcript for ${m.title || 'this meeting'}`} style={{ background: 'none', border: 'none', color: '#9a9084', cursor: 'pointer', padding: 4 }}><Ic name="captions" size={16} /></button>
              <button className="hv-fg" onClick={() => app.deleteMeeting(m.id)} title="Delete meeting" aria-label={`Delete ${m.title || 'this meeting'}`} style={{ background: 'none', border: 'none', color: '#9a9084', cursor: 'pointer', padding: 4 }}><Ic name="close" size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Schedule() {
  const app = useApp();
  const s = app.s;
  const toggle = useToggleList('schedOpts');
  // Today, local — the min= below stops anyone scheduling into the past.
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const minDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return (
    <div style={{ maxWidth: 560, animation: 'fadeUp .35s ease' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 24px' }}>Schedule a meeting</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="sched-title" style={labelStyle}>Title</label>
          <input id="sched-title" value={s.schedTitle} onChange={e => app.patch({ schedTitle: e.target.value })} placeholder="Weekly team sync" style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
          <div>
            <label htmlFor="sched-date" style={labelStyle}>Date</label>
            {/* Was readOnly and hardcoded to today, so nothing could be
                scheduled for any other day — the feature did not work. */}
            <input
              id="sched-date"
              type="date"
              min={minDate}
              value={s.schedDate}
              onChange={e => app.patch({ schedDate: e.target.value })}
              style={{ ...inputStyle, fontSize: 14 }}
            />
          </div>
          <div>
            <label htmlFor="sched-time" style={labelStyle}>Start</label>
            <select id="sched-time" value={s.schedTime} onChange={e => app.patch({ schedTime: e.target.value })} style={selectStyle}>
              {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '15:30', '16:00', '17:00'].map(t => {
                const [h, m] = t.split(':').map(Number);
                const label = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                return <option key={t} value={t}>{label}</option>;
              })}
            </select>
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#968a7b' }}>Time zone: <span style={{ color: '#c9beb0', fontWeight: 600 }}>{Intl.DateTimeFormat().resolvedOptions().timeZone} (auto-detected)</span></div>
        <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14 }}>
          <button onClick={() => app.patch({ optionsOpen: !s.optionsOpen })} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: '#f4eee5', padding: '15px 16px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>
            Meeting options<span style={{ color: '#968a7b' }}><Ic name={s.optionsOpen ? 'chevronUp' : 'chevronDown'} size={14} /></span>
          </button>
          {s.optionsOpen && (
            <div style={{ padding: '2px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {SCHED_OPTIONS.map((opt, i) => <ToggleRow key={opt.field} label={opt.label} on={s.schedOpts[i]} onToggle={toggle(i)} />)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="hv-fg" onClick={() => app.go('dash')} style={{ background: 'none', border: '1px solid #3a332b', color: '#c9beb0', borderRadius: 12, padding: '12px 20px', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>Cancel</button>
          <button className="hv-primary" onClick={app.scheduleMeeting} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '12px 24px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>Save meeting</button>
        </div>
      </div>
    </div>
  );
}

/** A meeting in the shape the calendar helpers want. */
function calEvent(m: Meeting, link: string): CalendarEvent {
  return { title: m.title || 'Meeting', startsAt: m.startsAt, link, hostName: m.hostName };
}

/**
 * Calendar sites must open in the real browser, never inside the app window —
 * in the desktop build `window.open` would load Google inside Electron, where
 * the person is not signed in and cannot safely sign in.
 */
function openCalendar(url: string): void {
  if (window.diss?.isDesktop) { void window.diss.openExternal(url); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function SchedDone() {
  const app = useApp();
  const s = app.s;
  const m = s.meeting;
  const link = m ? meetingLink(m.code) : '';
  const when = m?.startsAt
    ? new Date(m.startsAt).toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Whenever you open the link';
  const secBtn: React.CSSProperties = { background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 11, padding: '11px 16px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' };
  return (
    <div style={{ maxWidth: 560, animation: 'fadeUp .35s ease' }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(111,191,143,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6fbf8f', marginBottom: 18 }}>
        <Ic name="check" size={26} />
      </div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 4px' }}>{m?.title || 'Your meeting'} is on the calendar</h1>
      <p style={{ color: '#a3988a', fontSize: 15, margin: '0 0 26px' }}>{when}</p>
      <div style={{ background: '#1e1a16', border: '1px solid #362f28', borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, color: '#c9beb0', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{link || '—'}</div>
        <button className="hv-primary" onClick={app.copyLink} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: '12px 22px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', flexShrink: 0 }}>{s.copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="hv-bg-2a" onClick={async () => {
          if (!m) return;
          try {
            await navigator.clipboard?.writeText(`Join "${m.title}"\n${when}\n${link}`);
            app.toast('Invitation copied');
          } catch { app.toast('Copy failed — the link is ' + link, { sticky: true }); }
        }} style={secBtn}>Copy invitation</button>
        <button className="hv-bg-2a" onClick={() => m && openCalendar(googleCalendarUrl(calEvent(m, link)))} style={secBtn}>Add to Google Calendar</button>
        <button className="hv-bg-2a" onClick={() => m && openCalendar(outlookCalendarUrl(calEvent(m, link)))} style={secBtn}>Add to Outlook</button>
        <button className="hv-bg-2a" onClick={() => m && downloadIcs(calEvent(m, link), `${m.code}.ics`)} style={secBtn}>Download .ics</button>
      </div>
      <button onClick={() => app.go('dash')} style={{ marginTop: 26, background: 'none', border: 'none', color: '#f0a97f', fontWeight: 600, fontSize: 14.5, cursor: 'pointer', padding: 0 }}>Done → back to home</button>
    </div>
  );
}

function Detail() {
  const app = useApp();
  const attendees = ['Maya Chen|47|Host', 'Amara Okafor|49|Co-host', 'Jonas Berg|12|', 'Priya Nair|26|', 'Diego Ramos|60|', 'Nkechi Eze|24|'].map((str, i) => {
    const [name, img, role] = str.split('|');
    return { name, img: `https://i.pravatar.cc/60?img=${img}`, color: PALETTE[i], role };
  });
  return (
    <div style={{ maxWidth: 640, animation: 'fadeUp .35s ease' }}>
      <button className="hv-fg" onClick={() => app.go('dash')} style={{ background: 'none', border: 'none', color: '#968a7b', fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Ic name="arrowLeft" size={15} /> Back
      </button>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 4px' }}>Sprint retro</h1>
      <p style={{ color: '#a3988a', fontSize: 15, margin: '0 0 22px' }}>Friday, Jul 17 · 42 min · hosted by you</p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 26 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(224,96,79,.12)', color: '#e0836f', fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '6px 12px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e0604f' }} />Recorded
        </span>
        <button className="hv-bg-2a" onClick={() => app.go('recordings')} style={{ background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 99, padding: '6px 14px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Watch recording</button>
      </div>
      <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15, margin: '0 0 10px', color: '#c9beb0' }}>Attendees · 6</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 380 }}>
        {attendees.map(a => (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 4px' }}>
            <img src={a.img} alt="" style={{ width: 30, height: 30, borderRadius: '50%', background: a.color }} />
            <span style={{ fontSize: 14.5, fontWeight: 500 }}>{a.name}</span>
            <span style={{ color: '#9a9084', fontSize: 12.5, marginLeft: 'auto' }}>{a.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const fmtBytes = (b: number | null): string => {
  if (b === null) return 'file missing';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
};

const fmtRecDuration = (r: Recording): string => {
  if (!r.endedAt) return 'still recording';
  const mins = Math.max(0, Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000));
  return mins < 1 ? 'under a minute' : `${mins} min`;
};

const fmtRecDate = (r: Recording): string =>
  new Date(r.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
  ' · ' + new Date(r.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function Recordings() {
  const app = useApp();
  const [recs, setRecs] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<Recording['id'] | null>(null);
  const [playing, setPlaying] = useState<Recording | null>(null);

  useEffect(() => {
    api.listRecordings()
      .then(({ recordings }) => setRecs(recordings))
      .catch(() => { setRecs([]); setError("Couldn't load your recordings — try again in a bit."); });
  }, []);

  const remove = async (r: Recording) => {
    setConfirmId(null);
    try {
      await api.deleteRecording(r.id);
      setRecs(cur => (cur ? cur.filter(x => x.id !== r.id) : cur));
      app.toast('Recording deleted');
    } catch {
      app.toast("Couldn't delete that recording");
    }
  };

  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 24px' }}>Recordings</h1>
      {recs === null && <div style={{ color: '#968a7b', fontSize: 14 }}>Loading…</div>}
      {error && <div style={{ color: '#e0836f', fontSize: 14 }}>{error}</div>}
      {recs !== null && !error && recs.length === 0 && (
        <div style={{ color: '#968a7b', fontSize: 14, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '16px 18px', maxWidth: 640 }}>
          No recordings yet — start one from the More menu during a meeting.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 760 }}>
        {(recs ?? []).map(r => (
          <div key={r.id} className="hv-border" style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '13px 16px' }}>
            <button
              onClick={() => setPlaying(r)}
              title="Play recording"
              disabled={!r.endedAt}
              style={{ width: 40, height: 40, borderRadius: '50%', background: '#241f1a', border: '1px solid #362f28', color: r.endedAt ? '#f0a97f' : '#3a332b', cursor: r.endedAt ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 3, flexShrink: 0 }}
            >
              <Ic name="play" size={14} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title || r.meetingCode}</div>
              <div style={{ color: '#968a7b', fontSize: 12.5, marginTop: 2 }}>{fmtRecDate(r)} · {fmtRecDuration(r)} · {fmtBytes(r.sizeBytes)}</div>
            </div>
            <button className="hv-fg" onClick={() => window.open(recordingFileUrl(r.id), '_blank')} title="Open in a new tab" style={{ background: 'none', border: 'none', color: '#9a9084', cursor: 'pointer', padding: 4 }}><Ic name="share" size={16} /></button>
            {confirmId === r.id ? (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="hv-danger" onClick={() => remove(r)} style={{ background: '#c94a38', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Delete forever</button>
                <button className="hv-fg" onClick={() => setConfirmId(null)} style={{ background: 'none', border: '1px solid #3a332b', color: '#968a7b', borderRadius: 8, padding: '6px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Keep</button>
              </span>
            ) : (
              <button className="hv-fg" onClick={() => setConfirmId(r.id)} title="Delete recording" style={{ background: 'none', border: 'none', color: '#9a9084', cursor: 'pointer', padding: 4 }}><Ic name="close" size={15} /></button>
            )}
          </div>
        ))}
      </div>
      {playing && (
        <div onClick={() => setPlaying(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 32 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(880px, 92vw)', background: '#1a1613', border: '1px solid #3a332b', borderRadius: 18, overflow: 'hidden', animation: 'fadeUp .25s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{playing.title || playing.meetingCode}</div>
              <button className="hv-fg" onClick={() => setPlaying(null)} style={{ background: 'none', border: 'none', color: '#9a9084', cursor: 'pointer', padding: 4 }}><Ic name="close" size={16} /></button>
            </div>
            <video src={recordingFileUrl(playing.id)} controls autoPlay style={{ display: 'block', width: '100%', aspectRatio: '16/9', background: '#0e0c0a' }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const app = useApp();
  const s = app.s;
  // The Desktop tab only exists in the packaged app — on the web there are no OS
  // permissions to show.
  const tabs: [AppState['settingsTab'], string][] = [
    ['profile', 'Profile'], ['av', 'Audio & Video'],
    ...(isDesktopApp() ? ([['desktop', 'Desktop']] as [AppState['settingsTab'], string][]) : []),
    ['account', 'Account'],
  ];
  return (
    <div style={{ maxWidth: 600, animation: 'fadeUp .35s ease' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 20px' }}>Settings</h1>
      <div style={{ display: 'flex', gap: 6, marginBottom: 26 }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => app.patch({ settingsTab: k })} style={{ background: s.settingsTab === k ? '#f08b5f' : '#241f1a', color: s.settingsTab === k ? '#241209' : '#a3988a', border: 'none', borderRadius: 99, padding: '9px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      {s.settingsTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ width: 64, height: 64, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 22 }}>{(s.user?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
            <button className="hv-bg-2a" onClick={() => app.toast('Profile photos are coming soon')} style={{ background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 10, padding: '9px 15px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Change photo</button>
          </div>
          <div><label style={labelStyle}>Display name</label><input value={s.user?.name ?? ''} readOnly style={{ ...inputStyle, maxWidth: 340, padding: '12px 14px' }} /></div>
          <div>
            <label style={labelStyle}>Email</label>
            <input value={s.user?.email ?? ''} readOnly style={{ ...inputStyle, maxWidth: 340, padding: '12px 14px', background: '#1a1613', border: '1px solid #2e2822', color: '#968a7b' }} />
          </div>
        </div>
      )}
      {s.settingsTab === 'av' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
          <div><label style={labelStyle}>Default microphone</label><DevicePicker kind="mic" style={{ padding: 12, borderRadius: 12, fontSize: 14 }} /></div>
          <div><label style={labelStyle}>Default camera</label><DevicePicker kind="cam" style={{ padding: 12, borderRadius: 12, fontSize: 14 }} /></div>
          {s.canPickSpeaker && (
            <div><label style={labelStyle}>Default speaker</label><DevicePicker kind="speaker" style={{ padding: 12, borderRadius: 12, fontSize: 14 }} /></div>
          )}
          <div>
            <label style={labelStyle}>Video quality</label>
            <select value={s.videoQuality} onChange={e => app.setVideoQuality(e.target.value as VideoQuality)} style={{ ...selectStyle, padding: 12 }}>
              <option value="auto">Automatic — 720p, adapts to your connection</option>
              <option value="high">Hi-Res — 1080p when bandwidth allows</option>
              <option value="saver">Data saver — 360p, uses less bandwidth</option>
            </select>
            <div style={{ color: '#9a9084', fontSize: 12, marginTop: 6 }}>Applies straight away, even mid-meeting.</div>
          </div>
          <ToggleRow label="Mute my mic when I join" on={s.joinMuted} onToggle={() => app.toggleJoinPref('muted')} />
          <ToggleRow label="Turn my camera off when I join" on={s.joinCamOff} onToggle={() => app.toggleJoinPref('camOff')} />
          <ToggleRow label="Noise suppression" on={s.nsOn} onToggle={app.toggleNs} />
          {s.blurSupported && (
            <div style={{ paddingTop: 6 }}>
              <div style={{ fontSize: 14, color: '#c9beb0', marginBottom: 8 }}>Background</div>
              <BackgroundPicker />
            </div>
          )}
        </div>
      )}
      {s.settingsTab === 'desktop' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>Permissions</div>
            <div style={{ fontSize: 12.5, color: '#968a7b', marginBottom: 12 }}>What Diss needs from your Mac, and how to fix anything that's blocked.</div>
            <PermissionsPanel />
          </div>
        </div>
      )}
      {s.settingsTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 460 }}>
          <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Signed in as</div>
              <div style={{ color: '#968a7b', fontSize: 12.5 }}>{s.user?.email ?? '—'}</div>
            </div>
            <button className="hv-bg-2a" onClick={app.signOut} style={{ background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 10, padding: '9px 15px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Sign out</button>
          </div>
          <div style={{ border: '1px solid rgba(224,96,79,.35)', borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#e0836f', marginBottom: 6 }}>Danger zone</div>
            <div style={{ color: '#a3988a', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>Deleting your account removes all meetings and recordings. This can't be undone.</div>
            <button className="hv-danger-ghost" onClick={() => app.toast("Account deletion isn't self-serve yet — email us and we'll wipe it for you")} style={{ background: 'none', border: '1px solid rgba(224,96,79,.5)', color: '#e0836f', borderRadius: 10, padding: '9px 15px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Delete account…</button>
          </div>
        </div>
      )}
    </div>
  );
}

function JoinModal() {
  const app = useApp();
  const s = app.s;
  const ok = s.code.trim().length > 0;
  const join = () => app.openCode(s.code);
  return (
    <div onClick={() => app.patch({ joinModal: false })} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 400, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 20, padding: 28, animation: 'fadeUp .25s ease' }}>
        <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 22, margin: '0 0 6px' }}>Join a meeting</h2>
        <p style={{ color: '#a3988a', fontSize: 13.5, margin: '0 0 18px' }}>Paste a link or type the code from your invite.</p>
        <input value={s.code} onChange={e => app.patch({ code: e.target.value, codeInvalid: false })} placeholder="abc-defg-hij" style={inputStyle} autoFocus />
        {s.codeInvalid && <div style={{ color: '#e0836f', fontSize: 13, marginTop: 8 }}>We couldn't find that meeting — check the code and try again.</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={() => app.patch({ joinModal: false })} style={{ background: 'none', border: '1px solid #3a332b', color: '#c9beb0', borderRadius: 11, padding: '11px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={join} disabled={!ok && s.code.length === 0} style={{ background: ok ? '#f08b5f' : '#2e2822', color: ok ? '#241209' : '#9a9084', border: 'none', borderRadius: 11, padding: '11px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Join</button>
        </div>
      </div>
    </div>
  );
}

export function Shell() {
  const app = useApp();
  const s = app.s;
  return (
    <section style={{ display: 'flex', minHeight: '100vh' }}>
      <ShellNav />
      <main style={{ flex: 1, minWidth: 0, padding: '36px 44px', maxWidth: 1060 }}>
        {s.screen === 'dash' && <Dashboard />}
        {s.screen === 'schedule' && <Schedule />}
        {s.screen === 'schedDone' && <SchedDone />}
        {s.screen === 'detail' && <Detail />}
        {s.screen === 'recordings' && <Recordings />}
        {s.screen === 'transcript' && <Transcript />}
        {s.screen === 'settings' && <Settings />}
      </main>
      {s.joinModal && <JoinModal />}
    </section>
  );
}
