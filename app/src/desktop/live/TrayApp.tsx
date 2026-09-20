import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bridge } from './bridge';
import type { MeetingState } from './bridge';
import { DCam, DCamOffMini, DCopy, DLink, DMic, DMicOff, DPlus } from './micons';

const DISPLAY = "'Bricolage Grotesque',sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="hv-bg-2a" onClick={onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 11, padding: '11px 6px', color: '#f4eee5', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
      {icon}{label}
    </button>
  );
}

function MenuRow({ label, shortcut, onClick }: { label: string; shortcut?: string; onClick: () => void }) {
  return (
    <div className="dk-tray-row" onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: 8, borderRadius: 8, fontSize: 13, color: '#d6cec2', cursor: 'pointer' }}>
      {label}
      {shortcut && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: '#9a9084' }}>{shortcut}</span>}
    </div>
  );
}

/** The real menu-bar / system-tray panel, in its own frameless window. */
export function TrayApp() {
  const api = bridge();
  const [m, setM] = useState<MeetingState>({ active: false, title: '', muted: false, cameraOff: false, speaker: '', peers: 0, link: '' });
  const mac = api?.platform === 'darwin';
  const mod = mac ? '⌘' : 'Ctrl+';
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!api) return;
    api.info().then(i => setM(i.meeting));
    return api.onMeeting(setM);
  }, [api]);

  // Size the window to the panel instead of leaving dead space below it.
  useLayoutEffect(() => {
    if (!api || !rootRef.current) return;
    api.tray.resize(rootRef.current.getBoundingClientRect().height);
  }, [api, m.active]);

  const run = (name: Parameters<NonNullable<typeof api>['command']>[0]) => () => {
    api?.command(name);
    api?.tray.hide();
  };

  return (
    <div ref={rootRef} className="satellite" style={{ fontFamily: "'Instrument Sans',sans-serif", width: '100vw', background: '#241f1a', color: '#f4eee5', padding: 12, userSelect: 'none', borderRadius: mac ? 16 : 12, border: '1px solid #3a332b', boxSizing: 'border-box' }}>
      {m.active ? (
        // In-call strip: the card becomes controls for the meeting already running.
        <div style={{ border: '1px solid #362f28', borderRadius: 14, background: 'linear-gradient(180deg,#2a241e,#221d18)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6fbf8f' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title || 'In a meeting'}</span>
            {!!m.peers && <span style={{ fontFamily: MONO, fontSize: 12, color: '#a3988a' }}>{m.peers}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => api?.command('toggle-mute')} title={m.muted ? 'Unmute' : 'Mute'} style={{ flex: 1, display: 'grid', placeItems: 'center', background: m.muted ? '#c94a38' : '#2e2822', border: 'none', borderRadius: 9, padding: 9, cursor: 'pointer', color: '#f4eee5' }}>
              {m.muted ? <DMicOff /> : <DMic />}
            </button>
            <button onClick={() => api?.command('toggle-camera')} title={m.cameraOff ? 'Turn camera on' : 'Turn camera off'} style={{ flex: 1, display: 'grid', placeItems: 'center', background: m.cameraOff ? '#c94a38' : '#2e2822', border: 'none', borderRadius: 9, padding: 9, cursor: 'pointer', color: '#f4eee5' }}>
              {m.cameraOff ? <DCamOffMini /> : <DCam />}
            </button>
            <button className="hv-danger-soft" onClick={run('leave')} style={{ flex: 2, background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.3)', borderRadius: 9, padding: 9, cursor: 'pointer', color: '#e0836f', fontSize: 12.5, fontWeight: 700 }}>Leave</button>
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid #362f28', borderRadius: 14, background: 'linear-gradient(180deg,#2a241e,#221d18)', padding: 14 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#f0a97f', marginBottom: 6 }}>Ready when you are</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16.5, marginBottom: 10 }}>Start a meeting</div>
          <div style={{ fontSize: 12.5, color: '#a3988a', marginBottom: 13, lineHeight: 1.45 }}>Nothing scheduled right now — enjoy the quiet.</div>
          <button className="hv-primary" onClick={run('new-meeting')} style={{ width: '100%', background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: 11, fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>New meeting</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <QuickAction icon={<DPlus size={16} color="#f08b5f" />} label="New" onClick={run('new-meeting')} />
        <QuickAction icon={<DLink size={16} color="#f08b5f" />} label="Join code" onClick={run('join')} />
        <QuickAction icon={<DCopy size={16} color={m.link ? '#f08b5f' : '#9a9084'} />} label={m.link ? 'Copy link' : 'No link'} onClick={() => { if (m.link) navigator.clipboard?.writeText(m.link); api?.tray.hide(); }} />
      </div>

      <div style={{ height: 1, background: '#3a332b', margin: '14px 4px 8px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <MenuRow label="Open Diss" onClick={() => { api?.showMain(); api?.tray.hide(); }} />
        <MenuRow label="Permissions…" onClick={() => { api?.permissions.openWindow(); api?.tray.hide(); }} />
        <MenuRow label="Settings" shortcut={`${mod},`} onClick={run('settings')} />
        <MenuRow label="Quit Diss" shortcut={`${mod}Q`} onClick={() => { api?.tray.hide(); api?.quit(); }} />
      </div>
    </div>
  );
}
