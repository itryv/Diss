import { DClose, DMic } from '../dicons';
import { DISPLAY, MONO, note, sectionLabel, useDesktop } from '../shell';

export function SystemStates() {
  const { s, set, mac } = useDesktop();
  const denied = s.perm === 'denied';

  const permBody = denied
    ? mac
      ? 'macOS is holding the door. Open Privacy & Security, switch Camera and Microphone on for Diss, and come back — we’ll pick up where you left off.'
      : 'Windows privacy settings are blocking access. Turn Camera and Microphone on for Diss, then try again.'
    : `So people can see and hear you. Your ${mac ? 'Mac' : 'PC'} will ask next — nothing is recorded until you join.`;

  return (
    <div style={{ width: 1120, maxWidth: '100%', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* Cold start from a deep link */}
        <div style={{ width: 340 }}>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>Cold start from diss://join</div>
          <div style={{ width: 340, height: 230, borderRadius: 16, background: 'radial-gradient(500px 300px at 50% 30%, rgba(240,139,95,.14), transparent 60%),#151210', border: '1px solid #2a241e', boxShadow: '0 24px 70px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <div style={{ position: 'relative', width: 56, height: 56, display: 'grid', placeItems: 'center' }}>
              <span style={{ position: 'absolute', width: 56, height: 56, borderRadius: '50%', background: 'rgba(240,139,95,.25)', animation: 'breathe 1.8s ease-in-out infinite' }} />
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#f08b5f' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Opening Weekly team sync…</div>
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: '#6f665b', marginTop: 6 }}>diss://join/abc-defg-hij</div>
            </div>
          </div>
          <div style={{ ...note, marginTop: 12 }}>Splash only covers the gap; the lobby must be on screen in a couple of seconds.</div>
        </div>

        {/* Permission explainer / denied */}
        <div style={{ width: 360 }}>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>{denied ? 'Permission denied (macOS)' : 'Pre-permission explainer'}</div>
          <div style={{ background: '#1e1a16', border: '1px solid #362f28', borderRadius: 16, padding: 20 }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(240,139,95,.14)', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
              <DMic size={20} color="#f08b5f" />
            </span>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 7 }}>
              {denied ? 'Diss can’t reach your camera yet' : 'We need your camera and mic'}
            </div>
            <div style={{ fontSize: 13.5, color: '#a3988a', lineHeight: 1.55, marginBottom: 16 }}>{permBody}</div>
            <button className="hv-primary" onClick={() => set({ perm: denied ? 'ask' : 'denied' })} style={{ width: '100%', background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {denied ? (mac ? 'Open Privacy & Security' : 'Open Windows settings') : 'Continue'}
            </button>
            <button onClick={() => set({ perm: denied ? 'ask' : 'denied' })} style={{ width: '100%', background: 'none', border: 'none', color: '#8a7f70', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginTop: 10 }}>
              {denied ? 'Join without camera and mic' : 'See the denied state'}
            </button>
          </div>
          <div style={{ marginTop: 16, background: '#1a1613', border: '1px solid #2a241e', borderRadius: 12, padding: '14px 16px', fontSize: 13, lineHeight: 1.5, color: '#d6cec2' }}>
            {mac
              ? 'Screen Recording is separate, and macOS needs Diss to restart once after you allow it. We say so up front rather than failing quietly.'
              : 'Windows grants screen capture without a system prompt — the picker itself is the consent moment.'}
          </div>
        </div>

        <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>Update toast — never modal</div>
            <div style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.5)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6fbf8f', flex: 'none' }} />
              <span style={{ flex: 1, fontSize: 13.5 }}>Diss updated to 1.4 — <a href="#">see what's new</a></span>
              <DClose size={15} color="#8a7f70" style={{ cursor: 'pointer' }} />
            </div>
          </div>
          <div>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>Quit while in a meeting</div>
            <div style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.6)', padding: 22 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Quitting will disconnect you from Weekly team sync</div>
              <div style={{ fontSize: 13.5, color: '#a3988a', lineHeight: 1.55, marginBottom: 18 }}>Six people are still in it. You can rejoin with the same link.</div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="hv-fg" style={{ background: 'none', border: '1px solid #3a332b', color: '#d6cec2', borderRadius: 11, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Stay in the meeting</button>
                <button className="hv-danger" style={{ background: '#c94a38', border: 'none', color: '#fff', borderRadius: 11, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Quit Diss</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
