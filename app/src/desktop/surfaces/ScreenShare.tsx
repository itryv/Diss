import { Switch } from '../chrome';
import { DChevronDown, DPause, DWarning } from '../dicons';
import { DISPLAY, MONO, sectionLabel, useDesktop } from '../shell';

const SCREENS: [string, string][] = [
  ['Screen 1 — Built-in Display', 'linear-gradient(140deg,#2c2620,#171310)'],
  ['Screen 2 — Studio Display', 'linear-gradient(140deg,#232a2c,#141110)'],
];
const WINDOWS: [string, string][] = [
  ['Figma — Diss Desktop', 'linear-gradient(140deg,#26242c,#141110)'],
  ['Notes — Sync agenda', 'linear-gradient(140deg,#2b2620,#141110)'],
  ['Safari — diss.app', 'linear-gradient(140deg,#242a2c,#141110)'],
  ['Terminal', 'linear-gradient(140deg,#1e1c1a,#121010)'],
];

export function ScreenShare() {
  const { s, set, mac } = useDesktop();
  const items = s.shareTab === 'screens' ? SCREENS : WINDOWS;
  // The whole-screen warning is only meaningful on the Screens tab.
  const showWarning = s.warn && s.shareTab === 'screens';

  const tab = (key: 'screens' | 'windows', label: string) => {
    const active = s.shareTab === key;
    return (
      <button
        onClick={() => set({ shareTab: key, shareSel: 0 })}
        style={{ border: 'none', borderRadius: 99, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: active ? '#2e2822' : 'transparent', color: active ? '#f4eee5' : '#a3988a' }}
      >{label}</button>
    );
  };

  return (
    <div style={{ width: 1120, maxWidth: '100%', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', gap: 34, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 620, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 18, boxShadow: '0 24px 70px rgba(0,0,0,.6)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 22px 0' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, marginBottom: 14 }}>Share your screen</div>
            <div style={{ display: 'flex', gap: 6, background: '#1c1815', border: '1px solid #2e2822', borderRadius: 99, padding: 4, width: 'fit-content' }}>
              {tab('screens', 'Screens')}
              {tab('windows', 'Windows')}
            </div>
          </div>

          <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {items.map(([name, thumb], i) => {
              const selected = s.shareSel === i;
              return (
                <div key={name} onClick={() => set({ shareSel: i })} style={{ cursor: 'pointer' }}>
                  <div style={{ aspectRatio: '16/10', borderRadius: 12, background: thumb, border: `2px solid ${selected ? '#f08b5f' : '#2e2822'}`, position: 'relative', overflow: 'hidden' }}>
                    <span style={{ position: 'absolute', right: 8, top: 8, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? '#f08b5f' : '#2e2822'}`, background: selected ? '#f08b5f' : 'transparent' }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, color: '#d6cec2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                </div>
              );
            })}
          </div>

          {showWarning && (
            <div style={{ margin: '0 22px 16px', background: 'rgba(224,180,95,.09)', border: '1px solid rgba(224,180,95,.28)', borderRadius: 12, padding: '13px 15px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <DWarning size={17} color="#e0b45f" style={{ marginTop: 1 }} />
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: '#e8d5b0' }}>
                Sharing your whole screen shows your notifications too — consider sharing a window instead.
                <button onClick={() => set({ warn: false })} style={{ display: 'block', marginTop: 7, background: 'none', border: 'none', padding: 0, color: '#a3988a', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Don't remind me</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 22px', borderTop: '1px solid #2e2822', background: '#1e1a16' }}>
            <div onClick={() => set(st => ({ shareAudio: !st.shareAudio }))} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}>
              <Switch on={s.shareAudio} size="sm" />
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Share audio</span>
              <span style={{ fontSize: 12, color: '#9a9084' }}>{mac ? 'system audio · macOS 13+' : 'system audio'}</span>
            </div>
            <button className="hv-fg" style={{ background: 'none', border: '1px solid #3a332b', color: '#a3988a', borderRadius: 11, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button className="hv-primary" style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: '10px 22px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Share</button>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 380 }}>
          <div style={{ ...sectionLabel, marginBottom: 14 }}>Share toolbar — top-center of the shared display</div>
          <div style={{ background: '#14110f', border: '1px solid #241f1a', borderRadius: 14, padding: '22px 18px', position: 'relative', overflow: 'hidden' }}>
            {/* Accent border = the industry convention for "this display is being shared". */}
            <div style={{ position: 'absolute', inset: 6, border: '2px solid #f08b5f', borderRadius: 10, pointerEvents: 'none', opacity: 0.9 }} />
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(36,31,26,.96)', border: '1px solid #3a332b', borderRadius: 99, padding: '7px 8px 7px 16px', boxShadow: '0 12px 40px rgba(0,0,0,.6)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#6fbf8f' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6fbf8f' }} />You're sharing Screen 2
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#a3988a' }}>04:12</span>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#2e2822', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><DPause /></span>
                <span style={{ background: '#c94a38', color: '#fff', borderRadius: 99, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Stop sharing</span>
              </div>
            </div>
            <div style={{ textAlign: 'center', color: '#9a9084', fontSize: 12, marginTop: 24, lineHeight: 1.5 }}>Accent border marks the shared display. Toolbar drags along the top edge and collapses to a nub:</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(36,31,26,.96)', border: '1px solid #3a332b', borderRadius: 99, padding: '6px 13px', fontSize: 12, fontWeight: 700, color: '#6fbf8f', boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6fbf8f' }} />Sharing<DChevronDown size={12} color="#a3988a" />
              </span>
            </div>
          </div>
          <div style={{ color: '#9a9084', fontSize: 12.5, marginTop: 18, lineHeight: 1.55 }}>
            Open question 5 answered: the toolbar stays on the shared display, not in the mini window — presenters look where their content is, and the mini window may be on a different monitor.
          </div>
        </div>
      </div>
    </div>
  );
}
