import { DISPLAY, sectionLabel, useDesktop } from '../shell';

const NOTIFS: { when: string; body: string; primary: string; secondary?: string }[] = [
  { when: 'now', body: 'Weekly team sync starts in 10 min', primary: 'Join', secondary: 'Snooze 5 min' },
  { when: 'now', body: 'Amara started Weekly team sync', primary: 'Join' },
  { when: '2m ago', body: 'Leila Boum is waiting to join', primary: 'Admit', secondary: 'View' },
  { when: '4m ago', body: 'Priya: can you see my notes?', primary: 'Reply', secondary: 'Open' },
  { when: '1h ago', body: 'Sprint retro recording is ready', primary: 'Open' },
  { when: '1h ago', body: 'You lost connection to Weekly team sync', primary: 'Rejoin' },
];

function Rule({ lead, children }: { lead?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1a1613', border: '1px solid #2a241e', borderRadius: 12, padding: '14px 16px', fontSize: 13.5, lineHeight: 1.5, color: '#d6cec2' }}>
      {lead && <span style={{ color: '#f0a97f', fontWeight: 700 }}>{lead}</span>}{lead && ' '}{children}
    </div>
  );
}

export function Notifications() {
  const { mac } = useDesktop();
  return (
    <div style={{ width: 1120, maxWidth: '100%', animation: 'fadeUp .3s ease' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: -0.4, marginBottom: 6 }}>
        {mac ? 'Notification Center content' : 'Windows toast content'}
      </div>
      <div style={{ color: '#a3988a', fontSize: 14, maxWidth: 640, lineHeight: 1.55, marginBottom: 30 }}>
        The OS owns the chrome; we own content, actions and timing. Never notify about something already visible in the focused window, and always respect Focus / Do Not Disturb.
      </div>

      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 400 }}>
          {NOTIFS.map(n => (
            <div key={n.body} style={{
              // macOS notifications are translucent and heavily rounded; Windows toasts are flatter.
              background: mac ? 'rgba(30,26,22,.96)' : '#1e1a16',
              border: `1px solid ${mac ? '#3a332b' : '#2e2822'}`,
              borderRadius: mac ? 16 : 8,
              boxShadow: '0 16px 44px rgba(0,0,0,.55)', padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 9, background: '#f08b5f', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, color: '#241209' }}>
                d<span style={{ fontSize: 19, lineHeight: 0.5 }}>.</span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Diss</span>
                  <span style={{ fontSize: 11.5, color: '#968a7b' }}>{n.when}</span>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.45, marginTop: 3, color: '#e8e0d5' }}>{n.body}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                  <span style={{ background: '#f08b5f', color: '#241209', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{n.primary}</span>
                  {n.secondary && <span style={{ background: '#2e2822', color: '#d6cec2', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{n.secondary}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 340, maxWidth: 460 }}>
          <div style={{ ...sectionLabel, marginBottom: 14 }}>Rules</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Rule lead="Deny is never a toast action.">Admitting from a notification is safe; denying someone by fat-finger isn't. Deny lives in the app.</Rule>
            <Rule lead="Chat is suppressed">whenever the meeting window is focused — the message is already on screen.</Rule>
            <Rule lead="Disconnected fires only after auto-reconnect fails.">The first two attempts stay quiet inside the meeting.</Rule>
            <Rule>Starting-soon fires even when the app is closed to the {mac ? 'menu bar' : 'system tray'} — that's the whole reason the app exists.</Rule>
          </div>
        </div>
      </div>
    </div>
  );
}
