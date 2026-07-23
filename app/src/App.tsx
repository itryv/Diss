import { AppProvider, useApp } from './store';
import { Landing } from './screens/Landing';
import { Auth } from './screens/Auth';
import { Shell } from './screens/Shell';
import { Lobby, Waiting } from './screens/Lobby';
import { Meeting } from './screens/Meeting';
import { Post } from './screens/Post';
import { ProtoNav } from './ProtoNav';

const APP_SCREENS = ['dash', 'schedule', 'schedDone', 'settings', 'recordings', 'detail'];

function Screens() {
  const { s } = useApp();
  return (
    <div style={{ fontFamily: "'Instrument Sans',sans-serif", minHeight: '100vh', background: '#151210', color: '#f4eee5', WebkitFontSmoothing: 'antialiased' }}>
      {s.screen === 'landing' && <Landing />}
      {s.screen === 'auth' && <Auth />}
      {APP_SCREENS.includes(s.screen) && <Shell />}
      {s.screen === 'lobby' && <Lobby />}
      {s.screen === 'waiting' && <Waiting />}
      {s.screen === 'meeting' && <Meeting />}
      {s.screen === 'post' && <Post />}
      {/* Global toasts (the meeting screen renders its own, above the control bar) */}
      {s.screen !== 'meeting' && s.toasts.length > 0 && (
        <div style={{ position: 'fixed', left: 18, bottom: 18, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 120 }}>
          {s.toasts.map(t => (
            <div key={t.id} style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 12, padding: '11px 15px', fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,.4)', animation: 'fadeUp .25s ease', maxWidth: 320 }}>
              {t.text}
            </div>
          ))}
        </div>
      )}
      <ProtoNav />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Screens />
    </AppProvider>
  );
}
