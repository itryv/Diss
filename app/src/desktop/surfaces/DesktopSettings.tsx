import { Switch } from '../chrome';
import { DISPLAY, MONO, useDesktop } from '../shell';
import type { DesktopState } from '../shell';

type TogKey = keyof DesktopState['tog'];

function SettingRow({ title, hint, on, onClick, last }: { title: string; hint: string; on: boolean; onClick: () => void; last?: boolean }) {
  return (
    <div className="dk-row" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '17px 20px', cursor: 'pointer', borderBottom: last ? undefined : '1px solid #241f1a' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: '#968a7b', marginTop: 2 }}>{hint}</div>
      </div>
      <Switch on={on} />
    </div>
  );
}

export function DesktopSettings() {
  const { s, set, mac } = useDesktop();
  const toggle = (k: TogKey) => () => set(st => ({ tog: { ...st.tog, [k]: !st.tog[k] } }));
  const tabs = ['Profile', 'Audio & Video', 'Notifications', 'Desktop', 'Account'];
  const defaultCombo = mac ? '⌘⇧A' : 'Ctrl+Shift+A';

  return (
    <div style={{ width: 960, maxWidth: '100%', animation: 'fadeUp .3s ease' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 28, letterSpacing: -0.6, marginBottom: 20 }}>Settings</div>
      <div style={{ display: 'flex', gap: 6, background: '#1a1613', border: '1px solid #2a241e', borderRadius: 99, padding: 5, width: 'fit-content', marginBottom: 28 }}>
        {tabs.map(t => {
          const active = t === 'Desktop';
          return (
            <span key={t} style={{ borderRadius: 99, padding: '8px 17px', fontSize: 13.5, fontWeight: active ? 700 : 600, background: active ? '#f08b5f' : undefined, color: active ? '#241209' : '#a3988a', cursor: 'pointer' }}>{t}</span>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, overflow: 'hidden' }}>
        <SettingRow title="Launch Diss when I log in" hint={`Starts hidden in the ${mac ? 'menu bar' : 'system tray'}.`} on={s.tog.login} onClick={toggle('login')} />
        <SettingRow
          title={mac ? 'Keep Diss in the menu bar when I close the window' : 'Minimize Diss to the tray when I close the window'}
          hint="Meeting reminders keep working. Quit from the panel to stop them."
          on={s.tog.tray} onClick={toggle('tray')}
        />
        <SettingRow title="Float the mini window when I switch apps" hint="The meeting follows you, always on top." on={s.tog.top} onClick={toggle('top')} />
        <SettingRow title="Closing the meeting window shrinks it instead of leaving" hint="Calm under pressure — no one drops a call by hitting close." on={s.tog.close} onClick={toggle('close')} last />
      </div>

      <div style={{ marginTop: 26, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>Global shortcuts</div>
        <div style={{ fontSize: 12.5, color: '#968a7b', marginBottom: 18 }}>Work system-wide, even when Diss isn't focused.</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 14 }}>
          <span style={{ fontSize: 13.5, flex: 1 }}>Mute / unmute in the current meeting</span>
          <div onClick={() => set({ recording: true })} style={{ minWidth: 190, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#1c1815', border: `1px solid ${s.recording ? '#f08b5f' : '#362f28'}`, borderRadius: 11, padding: '9px 12px', cursor: 'pointer' }}>
            <span style={{ fontFamily: MONO, fontSize: 13, color: s.recording ? '#a3988a' : '#f0a97f' }}>
              {s.recording ? 'Press keys…' : s.combo || defaultCombo}
            </span>
            <span style={{ fontSize: 11, color: '#9a9084' }}>{s.recording ? 'Esc to cancel' : 'Click to change'}</span>
          </div>
          <button onClick={() => set({ combo: null, recording: false })} style={{ background: 'none', border: 'none', color: '#a3988a', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Reset</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ fontSize: 13.5, flex: 1 }}>Show / hide the mini window</span>
          <div style={{ minWidth: 190, display: 'flex', alignItems: 'center', background: '#1c1815', border: '1px solid #362f28', borderRadius: 11, padding: '9px 12px' }}>
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#f0a97f' }}>{mac ? '⌘⇧P' : 'Ctrl+Shift+P'}</span>
          </div>
          <span style={{ width: 52 }} />
        </div>

        <div style={{ marginTop: 16, fontSize: 12.5, color: '#9a9084', lineHeight: 1.5 }}>Leaving a meeting has no global shortcut on purpose — it's too easy to fire blind.</div>
      </div>

      <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 16, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, padding: '18px 20px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Diss updates itself automatically</div>
          <div style={{ fontSize: 12.5, color: '#968a7b', marginTop: 2 }}>Version 1.4.2 · up to date</div>
        </div>
        <button className="hv-bg-2e" style={{ background: '#241f1a', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 11, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Check now</button>
      </div>
    </div>
  );
}
