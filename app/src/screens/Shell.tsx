import { useApp, PALETTE } from '../store';
import type { AppState } from '../store';
import { Ic } from '../icons';
import { codeOk } from '../util';

const inputStyle: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 14px', color: '#f4eee5', fontSize: 15, fontFamily: 'inherit', outline: 'none' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#a3988a', marginBottom: 7 };
const selectStyle: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 10px', color: '#f4eee5', fontSize: 14, fontFamily: 'inherit', outline: 'none' };

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <span onClick={onToggle} style={{ width: 38, height: 22, borderRadius: 99, background: on ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .15s', flexShrink: 0, cursor: 'pointer' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#f4eee5', transition: 'left .15s' }} />
    </span>
  );
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '4px 0' }}>
      <span style={{ fontSize: 14, color: '#c9beb0' }}>{label}</span>
      <Toggle on={on} onToggle={onToggle} />
    </label>
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

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="hv-bg-2a" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, background: active ? '#2a241e' : 'none', color: active ? '#f4eee5' : '#a3988a', border: 'none', borderRadius: 10, padding: '11px 12px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ display: 'inline-flex' }}>{icon}</span>{label}
    </button>
  );
}

function Dashboard() {
  const app = useApp();
  const s = app.s;
  const upcoming = [
    { title: 'Weekly team sync', when: 'Today · 2:30 PM', img: 'https://i.pravatar.cc/68?img=49', soon: true },
    { title: 'Design crit — onboarding', when: 'Tomorrow · 11:00 AM', img: 'https://i.pravatar.cc/68?img=26', soon: false },
    { title: '1:1 with Jonas', when: 'Thu · 4:00 PM', img: 'https://i.pravatar.cc/68?img=12', soon: false },
  ];
  const recent = [
    { title: 'Sprint retro', when: 'Fri', dur: '42 min', people: 6, rec: true },
    { title: 'All hands · July', when: 'Wed', dur: '58 min', people: 34, rec: true },
    { title: 'Coffee chat with Hana', when: 'Mon', dur: '21 min', people: 2, rec: false },
  ];
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const cardBtn: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, background: '#241f1a', color: '#f4eee5', border: '1px solid #362f28', borderRadius: 18, padding: 22, cursor: 'pointer', textAlign: 'left' };
  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 32, margin: 0 }}>{greeting}, Maya</h1>
        <div style={{ color: '#8a7f70', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{s.clock} · {s.dateStr}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginTop: 26 }}>
        <div style={{ position: 'relative' }}>
          <button className="hv-bright" onClick={() => app.go('lobby', { permState: 'prompt', lobbyCam: true })} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, background: 'linear-gradient(135deg,#f08b5f,#e2734a)', color: '#241209', border: 'none', borderRadius: 18, padding: 22, cursor: 'pointer', textAlign: 'left' }}>
            <Ic name="video" size={26} />
            <span style={{ fontWeight: 700, fontSize: 17 }}>New meeting</span>
            <span style={{ fontSize: 13, opacity: 0.75 }}>Start one right now</span>
          </button>
          <button onClick={() => app.patch({ newMenuOpen: !s.newMenuOpen })} style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(36,18,9,.15)', border: 'none', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: '#241209', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic name="chevronDown" size={13} />
          </button>
          {s.newMenuOpen && (
            <div style={{ position: 'absolute', top: 48, right: 10, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 12, padding: 6, zIndex: 30, boxShadow: '0 12px 40px rgba(0,0,0,.5)', minWidth: 220 }}>
              <button className="hv-bg-2e" onClick={() => app.go('lobby', { permState: 'prompt', lobbyCam: false })} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#f4eee5', padding: '10px 12px', fontSize: 14, borderRadius: 8, cursor: 'pointer' }}>Start with video off</button>
              <button className="hv-bg-2e" onClick={() => { app.patch({ newMenuOpen: false }); navigator.clipboard?.writeText('https://diss.app/wkt-eamq-fjz'); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#f4eee5', padding: '10px 12px', fontSize: 14, borderRadius: 8, cursor: 'pointer' }}>Copy invite link instead</button>
            </div>
          )}
        </div>
        <button className="hv-bg-2a" onClick={() => app.patch({ joinModal: true, code: '', codeInvalid: false })} style={cardBtn}>
          <Ic name="arrowRight" size={26} />
          <span style={{ fontWeight: 700, fontSize: 17 }}>Join</span>
          <span style={{ fontSize: 13, color: '#8a7f70' }}>With a code or link</span>
        </button>
        <button className="hv-bg-2a" onClick={() => app.go('schedule')} style={cardBtn}>
          <Ic name="calendar" size={26} />
          <span style={{ fontWeight: 700, fontSize: 17 }}>Schedule</span>
          <span style={{ fontSize: 13, color: '#8a7f70' }}>Plan it, share the link</span>
        </button>
      </div>
      <div style={{ marginTop: 22, background: 'linear-gradient(120deg,rgba(240,139,95,.12),rgba(240,139,95,.04))', border: '1px solid rgba(240,139,95,.3)', borderRadius: 18, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#f0a97f', textTransform: 'uppercase', marginBottom: 6 }}>Up next · in 12 min</div>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20 }}>Weekly team sync</div>
          <div style={{ color: '#a3988a', fontSize: 13.5, marginTop: 2 }}>2:30 – 3:00 PM · hosted by you</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {[49, 12, 26].map((img, i) => (
            <img key={img} src={`https://i.pravatar.cc/64?img=${img}`} alt="" style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid #1e1a16', marginLeft: i ? -8 : 0, background: PALETTE[i + 1] }} />
          ))}
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#2e2822', border: '2px solid #1e1a16', marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#a3988a' }}>+6</span>
        </div>
        <button className="hv-primary" onClick={() => app.go('lobby', { permState: 'prompt', lobbyCam: true })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '13px 30px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Join</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 30 }}>
        <div>
          <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, margin: '0 0 12px', color: '#c9beb0' }}>Upcoming</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map(m => (
              <div key={m.title} className="hv-border" style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '13px 16px' }}>
                <img src={m.img} alt="" style={{ width: 34, height: 34, borderRadius: '50%', background: '#5a7a6a' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
                  <div style={{ color: '#8a7f70', fontSize: 12.5 }}>{m.when}</div>
                </div>
                <button onClick={() => app.go('lobby', { permState: 'prompt' })} disabled={!m.soon} style={{ background: m.soon ? '#f08b5f' : '#241f1a', color: m.soon ? '#241209' : '#6f665b', border: 'none', borderRadius: 9, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Join</button>
                <button className="hv-fg" onClick={() => navigator.clipboard?.writeText('https://diss.app/wkt-eamq-fjz')} title="Copy invite" style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', padding: 4 }}><Ic name="more" size={18} /></button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16, margin: '0 0 12px', color: '#c9beb0' }}>Recent</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map(m => (
              <div key={m.title} className="hv-border" onClick={() => app.go('detail')} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '13px 16px', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{m.title}</div>
                  <div style={{ color: '#8a7f70', fontSize: 12.5 }}>{m.when} · {m.dur} · {m.people} people</div>
                </div>
                {m.rec && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(224,96,79,.12)', color: '#e0836f', fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: '4px 10px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e0604f' }} />REC
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Schedule() {
  const app = useApp();
  const s = app.s;
  const toggle = useToggleList('schedOpts');
  const opts = ['Waiting room', 'Guests can join before host', 'Participants start muted', 'Non-hosts can share screen'];
  return (
    <div style={{ maxWidth: 560, animation: 'fadeUp .35s ease' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 24px' }}>Schedule a meeting</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Title</label>
          <input value={s.schedTitle} onChange={e => app.patch({ schedTitle: e.target.value })} placeholder="Weekly team sync" style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 10 }}>
          <div><label style={labelStyle}>Date</label><input value="Tue, Jul 21" readOnly style={{ ...inputStyle, fontSize: 14 }} /></div>
          <div><label style={labelStyle}>Start</label><select style={selectStyle}><option>3:00 PM</option><option>3:30 PM</option><option>4:00 PM</option></select></div>
          <div><label style={labelStyle}>Duration</label><select style={selectStyle}><option>30 min</option><option>45 min</option><option>60 min</option></select></div>
        </div>
        <div style={{ fontSize: 13, color: '#8a7f70' }}>Time zone: <span style={{ color: '#c9beb0', fontWeight: 600 }}>Pacific Time (auto-detected)</span> · <a href="#">change</a></div>
        <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14 }}>
          <button onClick={() => app.patch({ optionsOpen: !s.optionsOpen })} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: '#f4eee5', padding: '15px 16px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>
            Meeting options<span style={{ color: '#8a7f70' }}><Ic name={s.optionsOpen ? 'chevronUp' : 'chevronDown'} size={14} /></span>
          </button>
          {s.optionsOpen && (
            <div style={{ padding: '2px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {opts.map((label, i) => <ToggleRow key={label} label={label} on={s.schedOpts[i]} onToggle={toggle(i)} />)}
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>Description / agenda <span style={{ color: '#6f665b', fontWeight: 400 }}>(optional)</span></label>
          <textarea placeholder="What's this meeting about?" style={{ ...inputStyle, minHeight: 80, fontSize: 14.5, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="hv-fg" onClick={() => app.go('dash')} style={{ background: 'none', border: '1px solid #3a332b', color: '#c9beb0', borderRadius: 12, padding: '12px 20px', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>Cancel</button>
          <button className="hv-primary" onClick={() => app.go('schedDone', { copied: false })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '12px 24px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>Save meeting</button>
        </div>
      </div>
    </div>
  );
}

function SchedDone() {
  const app = useApp();
  const s = app.s;
  const secBtn: React.CSSProperties = { background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 11, padding: '11px 16px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' };
  return (
    <div style={{ maxWidth: 560, animation: 'fadeUp .35s ease' }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(111,191,143,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6fbf8f', marginBottom: 18 }}>
        <Ic name="check" size={26} />
      </div>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 4px' }}>{s.schedTitle || 'Weekly team sync'} is on the calendar</h1>
      <p style={{ color: '#a3988a', fontSize: 15, margin: '0 0 26px' }}>Tuesday, July 21 · 3:00 – 3:30 PM · Pacific Time</p>
      <div style={{ background: '#1e1a16', border: '1px solid #362f28', borderRadius: 16, padding: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, color: '#c9beb0', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>diss.app/wkt-eamq-fjz</div>
        <button className="hv-primary" onClick={app.copyLink} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: '12px 22px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', flexShrink: 0 }}>{s.copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="hv-bg-2a" onClick={() => navigator.clipboard?.writeText('Join "Weekly team sync"\nTue Jul 21, 3:00 PM PT\nhttps://diss.app/wkt-eamq-fjz')} style={secBtn}>Copy invitation</button>
        <button className="hv-bg-2a" style={secBtn}>Add to Google Calendar</button>
        <button className="hv-bg-2a" style={secBtn}>Add to Outlook</button>
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
      <button className="hv-fg" onClick={() => app.go('dash')} style={{ background: 'none', border: 'none', color: '#8a7f70', fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
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
            <span style={{ color: '#6f665b', fontSize: 12.5, marginLeft: 'auto' }}>{a.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Recordings() {
  const app = useApp();
  const recs = [
    { title: 'Sprint retro', meta: 'Fri, Jul 17 · 42 min · 380 MB', g1: '#4a3a30', g2: '#2a2018' },
    { title: 'All hands · July', meta: 'Wed, Jul 15 · 58 min · 512 MB', g1: '#3a4038', g2: '#20261e' },
    { title: 'Roadmap review', meta: 'Jul 8 · 35 min · 298 MB', g1: '#403a48', g2: '#241f2a' },
  ];
  return (
    <div style={{ animation: 'fadeUp .35s ease' }}>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 24px' }}>Recordings</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, maxWidth: 900 }}>
        {recs.map(r => (
          <div key={r.title} className="hv-border" onClick={() => app.go('detail')} style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, overflow: 'hidden', cursor: 'pointer' }}>
            <div style={{ aspectRatio: '16/9', background: `linear-gradient(135deg,${r.g1},${r.g2})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(21,18,16,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 }}>
                <Ic name="play" size={16} color="#f4eee5" />
              </span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>{r.title}</div>
              <div style={{ color: '#8a7f70', fontSize: 12.5, marginTop: 3 }}>{r.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settings() {
  const app = useApp();
  const s = app.s;
  const avToggle = useToggleList('avOpts');
  const notifToggle = useToggleList('notifOpts');
  const tabs: [AppState['settingsTab'], string][] = [['profile', 'Profile'], ['av', 'Audio & Video'], ['notif', 'Notifications'], ['account', 'Account']];
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
            <img src="https://i.pravatar.cc/120?img=47" alt="" style={{ width: 64, height: 64, borderRadius: '50%', background: '#8a5a44' }} />
            <button className="hv-bg-2a" style={{ background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 10, padding: '9px 15px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Change photo</button>
          </div>
          <div><label style={labelStyle}>Display name</label><input value="Maya Chen" readOnly style={{ ...inputStyle, maxWidth: 340, padding: '12px 14px' }} /></div>
          <div>
            <label style={labelStyle}>Email</label>
            <input value="maya@diss.app" readOnly style={{ ...inputStyle, maxWidth: 340, padding: '12px 14px', background: '#1a1613', border: '1px solid #2e2822', color: '#8a7f70' }} />
            <div style={{ fontSize: 12, color: '#6f665b', marginTop: 6 }}>Managed by your Google account</div>
          </div>
        </div>
      )}
      {s.settingsTab === 'av' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
          <div><label style={labelStyle}>Default microphone</label><select style={{ ...selectStyle, padding: 12 }}><option>MacBook Pro Microphone</option><option>AirPods Pro</option></select></div>
          <div><label style={labelStyle}>Default camera</label><select style={{ ...selectStyle, padding: 12 }}><option>FaceTime HD Camera</option></select></div>
          {['Mute my mic when I join', 'Turn my camera off when I join', 'Noise suppression'].map((label, i) => (
            <ToggleRow key={label} label={label} on={s.avOpts[i]} onToggle={avToggle(i)} />
          ))}
        </div>
      )}
      {s.settingsTab === 'notif' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
          {['Email me 10 minutes before meetings', 'Meeting-invite emails'].map((label, i) => (
            <ToggleRow key={label} label={label} on={s.notifOpts[i]} onToggle={notifToggle(i)} />
          ))}
        </div>
      )}
      {s.settingsTab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 460 }}>
          <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'conic-gradient(#ea4335 0 25%,#4285f4 0 50%,#34a853 0 75%,#fbbc05 0)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Google</div>
              <div style={{ color: '#8a7f70', fontSize: 12.5 }}>maya@diss.app</div>
            </div>
            <span style={{ color: '#6fbf8f', fontSize: 12.5, fontWeight: 600 }}>Connected</span>
          </div>
          <div style={{ border: '1px solid rgba(224,96,79,.35)', borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: '#e0836f', marginBottom: 6 }}>Danger zone</div>
            <div style={{ color: '#a3988a', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>Deleting your account removes all meetings and recordings. This can't be undone.</div>
            <button className="hv-danger-ghost" style={{ background: 'none', border: '1px solid rgba(224,96,79,.5)', color: '#e0836f', borderRadius: 10, padding: '9px 15px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Delete account…</button>
          </div>
        </div>
      )}
    </div>
  );
}

function JoinModal() {
  const app = useApp();
  const s = app.s;
  const ok = codeOk(s.code);
  const join = () => {
    if (ok) app.go('lobby', { joinModal: false, permState: 'prompt' });
    else app.patch({ codeInvalid: true });
  };
  return (
    <div onClick={() => app.patch({ joinModal: false })} style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 400, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 20, padding: 28, animation: 'fadeUp .25s ease' }}>
        <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 22, margin: '0 0 6px' }}>Join a meeting</h2>
        <p style={{ color: '#a3988a', fontSize: 13.5, margin: '0 0 18px' }}>Paste a link or type the code from your invite.</p>
        <input value={s.code} onChange={e => app.patch({ code: e.target.value, codeInvalid: false })} placeholder="abc-defg-hij" style={inputStyle} autoFocus />
        {s.codeInvalid && <div style={{ color: '#e0836f', fontSize: 13, marginTop: 8 }}>That code doesn't look right — check it and try again.</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={() => app.patch({ joinModal: false })} style={{ background: 'none', border: '1px solid #3a332b', color: '#c9beb0', borderRadius: 11, padding: '11px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={join} disabled={!ok && s.code.length === 0} style={{ background: ok ? '#f08b5f' : '#2e2822', color: ok ? '#241209' : '#6f665b', border: 'none', borderRadius: 11, padding: '11px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Join</button>
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
      <nav style={{ width: 232, flexShrink: 0, background: '#1a1613', borderRight: '1px solid #2a241e', display: 'flex', flexDirection: 'column', padding: '20px 12px' }}>
        <div onClick={() => app.go('dash')} style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, padding: '4px 12px 20px', cursor: 'pointer' }}>diss<span style={{ color: '#f08b5f' }}>.</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavButton icon={<Ic name="home" size={18} />} label="Home" active={s.screen === 'dash'} onClick={() => app.go('dash')} />
          <NavButton icon={<Ic name="grid" size={17} />} label="Meetings" active={s.screen === 'detail'} onClick={() => app.go('dash')} />
          <NavButton icon={<Ic name="disc" size={17} />} label="Recordings" active={s.screen === 'recordings'} onClick={() => app.go('recordings')} />
          <NavButton icon={<Ic name="gear" size={17} />} label="Settings" active={s.screen === 'settings'} onClick={() => app.go('settings')} />
        </div>
        <div className="hv-bg-2a" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, cursor: 'pointer' }}>
          <img src="https://i.pravatar.cc/80?img=47" alt="" style={{ width: 32, height: 32, borderRadius: '50%', background: '#8a5a44' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Maya Chen</div>
            <div style={{ fontSize: 12, color: '#8a7f70' }}>maya@diss.app</div>
          </div>
        </div>
      </nav>
      <main style={{ flex: 1, minWidth: 0, padding: '36px 44px', maxWidth: 1060 }}>
        {s.screen === 'dash' && <Dashboard />}
        {s.screen === 'schedule' && <Schedule />}
        {s.screen === 'schedDone' && <SchedDone />}
        {s.screen === 'detail' && <Detail />}
        {s.screen === 'recordings' && <Recordings />}
        {s.screen === 'settings' && <Settings />}
      </main>
      {s.joinModal && <JoinModal />}
    </section>
  );
}
