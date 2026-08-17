import { useEffect, useState } from 'react';
import { bridge } from './bridge';
import type { MeetingState } from './bridge';
import { DCam, DCamOffMini, DExpand, DHangup, DMic, DMicOff } from './micons';

const DISPLAY = "'Bricolage Grotesque',sans-serif";

const initialsOf = (name: string) =>
  (name || 'Diss').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** Deterministic tile colour per speaker, matching the web app's avatar palette. */
const PALETTE = ['#8a5a44', '#5a7a6a', '#7a5a7a', '#5a6a8a', '#8a7a4a', '#6a5a8a', '#4a7a7a'];
const colorFor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

function Control({ children, danger, onClick, title }: { children: React.ReactNode; danger?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 32, height: 32, borderRadius: 10, position: 'relative',
        background: danger ? '#c94a38' : 'rgba(36,31,26,.9)',
        border: danger ? 'none' : '1px solid #3a332b',
        display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
      }}
    >{children}</button>
  );
}

/**
 * The real always-on-top mini window. Runs in its own BrowserWindow with no
 * LiveKit connection of its own — state arrives over IPC, actions go back the
 * same way.
 */
export function MiniApp() {
  const api = bridge();
  const [m, setM] = useState<MeetingState>({ active: false, title: '', muted: false, cameraOff: false, speaker: '', peers: 0 });
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.info().then(i => setM(i.meeting));
    return api.onMeeting(setM);
  }, [api]);

  const name = m.speaker || m.title || 'Weekly team sync';
  const speaking = !!m.speaker;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => api?.mini.expand()}
      className="mini-root"
      style={{
        // -webkit-app-region makes the whole tile a drag handle; buttons opt out below.
        WebkitAppRegion: 'drag',
        fontFamily: "'Instrument Sans',sans-serif",
        width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(150deg,#2a2320,#14110f)',
        borderRadius: 14, color: '#f4eee5', userSelect: 'none',
        boxShadow: speaking ? 'inset 0 0 0 2px #f08b5f' : 'inset 0 0 0 1px #2a241e',
      } as React.CSSProperties}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <span style={{ width: 66, height: 66, borderRadius: '50%', background: colorFor(name), display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>
          {initialsOf(name)}
        </span>
      </div>

      <div style={{
        position: 'absolute', left: 9, bottom: 9, display: 'flex', alignItems: 'center', gap: 6,
        background: m.muted ? 'rgba(201,74,56,.18)' : 'rgba(14,12,10,.72)',
        border: m.muted ? '1px solid rgba(224,96,79,.32)' : undefined,
        borderRadius: 99, padding: '4px 10px', fontSize: 11.5, fontWeight: 600,
        color: m.muted ? '#e0836f' : undefined, maxWidth: 'calc(100% - 18px)',
      }}>
        {m.muted ? <DMicOff size={11} color="#e0836f" /> : <DMic size={11} color="#6fbf8f" />}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name.split(' ')[0]}</span>
      </div>

      <div style={{
        WebkitAppRegion: 'no-drag',
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg,rgba(10,8,7,.55),transparent 38%,transparent 55%,rgba(10,8,7,.6))',
        opacity: hover ? 1 : 0, transition: 'opacity .18s ease',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 11,
        pointerEvents: hover ? 'auto' : 'none',
      } as React.CSSProperties}>
        <div style={{ display: 'flex', gap: 7 }}>
          <Control title={m.muted ? 'Unmute' : 'Mute'} onClick={() => api?.command('toggle-mute')}>
            {m.muted ? <DMicOff size={15} color="#e0836f" /> : <DMic size={15} color="#f4eee5" />}
          </Control>
          <Control title={m.cameraOff ? 'Turn camera on' : 'Turn camera off'} onClick={() => api?.command('toggle-camera')}>
            {m.cameraOff ? <DCamOffMini size={15} color="#e0836f" /> : <DCam size={15} color="#f4eee5" />}
          </Control>
          <Control title="Leave meeting" danger onClick={() => api?.command('leave')}>
            <DHangup size={15} color="#fff" />
          </Control>
          <Control title="Back to the meeting window" onClick={() => api?.mini.expand()}>
            <DExpand size={15} color="#f4eee5" />
          </Control>
        </div>
      </div>
    </div>
  );
}
