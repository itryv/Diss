import { useApp } from './store';
import type { Screen } from './store';
import { Ic } from './icons';

const SCREENS: [Screen, string][] = [
  ['landing', 'Landing'], ['auth', 'Sign in / up'], ['dash', 'Dashboard'], ['schedule', 'Schedule'],
  ['schedDone', 'Schedule done'], ['lobby', 'Pre-join lobby'], ['waiting', 'Waiting room'],
  ['meeting', 'In-meeting'], ['post', 'Post-meeting'], ['recordings', 'Recordings'],
  ['detail', 'Meeting detail'], ['settings', 'Settings'],
];

export function ProtoNav() {
  const app = useApp();
  const s = app.s;
  const goScreen = (k: Screen) => {
    if (k === 'meeting') app.enterDevMeeting();
    else app.go(k, k === 'lobby' ? { permState: 'prompt' } : {});
  };
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      {s.protoOpen && (
        <div style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', minWidth: 190 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '8px 12px 4px' }}>Jump to screen</div>
          {SCREENS.map(([k, label]) => (
            <button key={k} className="hv-bg-2e" onClick={() => goScreen(k)} style={{ display: 'block', textAlign: 'left', background: s.screen === k ? '#2e2822' : 'none', border: 'none', color: s.screen === k ? '#f0a97f' : '#c9beb0', padding: '8px 12px', fontSize: 13, fontWeight: 500, borderRadius: 8, cursor: 'pointer' }}>{label}</button>
          ))}
          <div style={{ borderTop: '1px solid #3a332b', margin: '6px 0' }} />
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '4px 12px' }}>Meeting preview (no connection)</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', fontSize: 13, color: '#c9beb0' }}>
            Role
            <div style={{ display: 'flex', gap: 4 }}>
              {(['host', 'guest'] as const).map(r => (
                <button key={r} onClick={() => app.patch(st => ({ devRole: r, isHost: st.devMode ? r === 'host' : st.isHost }))} style={{ background: s.devRole === r ? '#2e2822' : 'none', border: '1px solid #3a332b', color: s.devRole === r ? '#f0a97f' : '#8a7f70', borderRadius: 8, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{r}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px 10px', fontSize: 13, color: '#c9beb0' }}>
            People · {s.devParticipantCount}
            <input type="range" min={2} max={10} value={s.devParticipantCount} onChange={e => app.patch({ devParticipantCount: Number(e.target.value) })} style={{ width: 80, accentColor: '#f08b5f' }} />
          </div>
        </div>
      )}
      <button className="hv-fg" onClick={() => app.patch(st => ({ protoOpen: !st.protoOpen }))} title="Prototype map" style={{ width: 40, height: 40, borderRadius: '50%', background: '#241f1a', border: '1px solid #3a332b', color: '#8a7f70', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ic name="grid" size={15} />
      </button>
    </div>
  );
}
