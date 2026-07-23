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
