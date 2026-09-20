import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Ctx, initialDesktop, MONO } from './shell';
import type { DesktopState, Surface } from './shell';
import { DBars, DBattery, DChevronUp, DWifi } from './dicons';
import { MainWindow } from './surfaces/MainWindow';
import { TrayPanel } from './surfaces/TrayPanel';
import { MeetingWindow } from './surfaces/MeetingWindow';
import { MiniWindow } from './surfaces/MiniWindow';
import { ScreenShare } from './surfaces/ScreenShare';
import { Notifications } from './surfaces/Notifications';
import { DesktopSettings } from './surfaces/DesktopSettings';
import { SystemStates } from './surfaces/SystemStates';

const SURFACES: [Surface, string, string][] = [
  ['main', 'Main window', 'Main window'],
  ['tray', 'Menu-bar panel', 'Tray panel'],
  ['meeting', 'Meeting window', 'Meeting window'],
  ['mini', 'Mini window (PiP)', 'Mini window (PiP)'],
  ['share', 'Screen share', 'Screen share'],
  ['notify', 'Notifications', 'Notifications'],
  ['settings', 'Settings → Desktop', 'Settings → Desktop'],
  ['system', 'First run & system', 'First run & system'],
];

function TrayDot({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <span onClick={onClick} style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 6, padding: '2px 7px', background: active ? 'rgba(240,139,95,.2)' : 'transparent', cursor: 'pointer' }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#f08b5f', display: 'block' }} />
    </span>
  );
}

export function DesktopShell() {
  const [s, set] = useReducer(
    (st: DesktopState, p: Partial<DesktopState> | ((s: DesktopState) => Partial<DesktopState>)) =>
      ({ ...st, ...(typeof p === 'function' ? p(st) : p) }),
    initialDesktop,
  );
  const ref = useRef(s);
  ref.current = s;
  const mac = s.platform === 'mac';

  const go = useCallback((screen: Surface) => set({ screen, navOpen: false, closeToast: false }), []);

  // Shortcut recorder: while armed, swallow the next chord and render it per platform.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ref.current.recording) return;
      e.preventDefault();
      if (e.key === 'Escape') return set({ recording: false });
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return;
      const isMac = ref.current.platform === 'mac';
      const parts: string[] = [];
      if (e.metaKey) parts.push(isMac ? '⌘' : 'Win');
      if (e.ctrlKey) parts.push(isMac ? '⌃' : 'Ctrl');
      if (e.altKey) parts.push(isMac ? '⌥' : 'Alt');
      if (e.shiftKey) parts.push(isMac ? '⇧' : 'Shift');
      parts.push(k);
      set({ recording: false, combo: isMac ? parts.join('') : parts.join('+') });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ctx = useMemo(() => ({ s, set, go, mac }), [s, go, mac]);
  const toggleTray = () => set(st => ({ trayOpen: !st.trayOpen, screen: 'tray' }));
  const trayActive = s.trayOpen && s.screen === 'tray';

  return (
    <Ctx.Provider value={ctx}>
      {/* The OS chrome stays pinned and only the stage scrolls, the way a real
          desktop behaves. (Sticky would not hold here: the app's mobile CSS puts
          overflow-x:hidden on body, which makes body the scroll container.) */}
      <div style={{ fontFamily: "'Instrument Sans',sans-serif", height: '100vh', background: '#0b0a09', color: '#f4eee5', WebkitFontSmoothing: 'antialiased' }}>
        <div style={{ height: '100%', background: 'radial-gradient(1200px 700px at 20% -5%, rgba(240,139,95,.10), transparent 60%),radial-gradient(900px 600px at 90% 100%, rgba(111,191,143,.06), transparent 60%),#0b0a09', display: 'flex', flexDirection: 'column', position: 'relative' }}>

          {mac && (
            <div style={{ height: 28, flex: 'none', background: 'rgba(18,15,13,.78)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', fontSize: 12.5, color: '#d6cec2', zIndex: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ width: 13, height: 13, borderRadius: '50%', background: '#d6cec2', opacity: 0.85 }} />
                <span style={{ fontWeight: 700 }}>Diss</span>
                {['File', 'Edit', 'Meeting', 'Window', 'Help'].map(m => <span key={m} style={{ opacity: 0.8 }}>{m}</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <TrayDot active={trayActive} onClick={toggleTray} />
                <DWifi size={15} color="#d6cec2" />
                <DBattery />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>Sat 2:41 PM</span>
              </div>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '44px 24px 120px', position: 'relative' }}>
            {s.screen === 'main' && <MainWindow />}
            {s.screen === 'tray' && <TrayPanel />}
            {s.screen === 'meeting' && <MeetingWindow />}
            {s.screen === 'mini' && <MiniWindow />}
            {s.screen === 'share' && <ScreenShare />}
            {s.screen === 'notify' && <Notifications />}
            {s.screen === 'settings' && <DesktopSettings />}
            {s.screen === 'system' && <SystemStates />}
          </div>

          {!mac && (
            <div style={{ height: 46, flex: 'none', background: 'rgba(18,15,13,.86)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', zIndex: 40 }}>
              <span style={{ width: 120 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: '#241f1a', position: 'relative' }}>
                  <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 17, color: '#f08b5f' }}>d.</span>
                  <span style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 14, height: 2.5, borderRadius: 2, background: '#f08b5f' }} />
                </span>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: '#1e1a16' }} />
                <span style={{ width: 34, height: 34, borderRadius: 8, background: '#1e1a16' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#d6cec2', fontSize: 12 }}>
                <DChevronUp size={13} color="#a3988a" />
                <TrayDot active={trayActive} onClick={toggleTray} />
                <DWifi size={15} color="#d6cec2" />
                <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', lineHeight: 1.2 }}>2:41 PM<br />7/25/2026</span>
              </div>
            </div>
          )}
        </div>

        {/* Surface switcher + platform toggle */}
        <div style={{ position: 'fixed', right: 20, bottom: mac ? 20 : 66, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          {s.navOpen && (
            <div style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', minWidth: 210 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a9084', padding: '8px 12px 6px' }}>Platform</div>
              <div style={{ display: 'flex', gap: 4, padding: '0 6px 8px' }}>
                {(['mac', 'win'] as const).map(p => (
                  <button key={p} onClick={() => set({ platform: p })} style={{ flex: 1, border: 'none', borderRadius: 9, padding: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: s.platform === p ? '#f08b5f' : '#1e1a16', color: s.platform === p ? '#241209' : '#a3988a' }}>
                    {p === 'mac' ? 'macOS' : 'Windows'}
                  </button>
                ))}
              </div>
              <div style={{ height: 1, background: '#3a332b', margin: '2px 6px 6px' }} />
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#9a9084', padding: '4px 12px 6px' }}>Surface</div>
              {SURFACES.map(([id, macLabel, winLabel]) => (
                <button key={id} onClick={() => go(id)} style={{ display: 'block', textAlign: 'left', background: s.screen === id ? '#2e2822' : 'transparent', border: 'none', color: s.screen === id ? '#f4eee5' : '#a3988a', padding: '9px 12px', fontSize: 13, fontWeight: 500, borderRadius: 9, cursor: 'pointer' }}>
                  {id === 'tray' ? (mac ? macLabel : winLabel) : macLabel}
                </button>
              ))}
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: '#9a9084', padding: '8px 12px 4px' }}>diss desktop shell</div>
            </div>
          )}
          <button onClick={() => set(st => ({ navOpen: !st.navOpen }))} style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 99, padding: '11px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 30px rgba(240,139,95,.3)' }}>
            <DBars size={16} />Surfaces
          </button>
        </div>
      </div>
    </Ctx.Provider>
  );
}
