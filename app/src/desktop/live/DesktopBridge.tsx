import { useEffect, useRef } from 'react';
import { useApp } from '../../store';
import { bridge } from './bridge';
import type { ShortcutName } from './bridge';

/**
 * Keeps the Electron main process and the web app in sync. Mounted once inside
 * the main window; a no-op in a browser tab.
 */
export function DesktopBridge() {
  const app = useApp();
  const s = app.s;
  const api = bridge();
  const appRef = useRef(app);
  appRef.current = app;

  const inMeeting = s.screen === 'meeting';
  const title = s.meeting?.title || '';
  const peers = s.peers.length;

  // Push meeting state up: it drives the tray icon, the global shortcuts and the
  // quit guard, so it has to be reported even when no desktop UI is visible.
  useEffect(() => {
    api?.setMeeting({
      active: inMeeting,
      title,
      muted: s.micMuted,
      cameraOff: s.camOff,
      peers,
      speaker: s.peers.find(p => p.speaking && !p.isLocal)?.name || '',
    });
  }, [api, inMeeting, title, s.micMuted, s.camOff, peers, s.peers]);

  // Commands arriving from the OS: global shortcuts, the app menu, tray menu items.
  useEffect(() => {
    if (!api) return;
    const run = (name: ShortcutName) => {
      const a = appRef.current;
      switch (name) {
        case 'toggle-mute': if (a.s.screen === 'meeting') a.toggleMic(); break;
        case 'toggle-camera': if (a.s.screen === 'meeting') a.toggleCam(); break;
        case 'leave': if (a.s.screen === 'meeting') a.leaveMeeting('left'); break;
        case 'settings': a.go(a.s.user ? 'settings' : 'landing'); break;
        case 'new-meeting': if (a.s.user) a.createInstantMeeting(true); else a.go('landing'); break;
        case 'join': if (a.s.user) a.patch({ joinModal: true, code: '', codeInvalid: false }); else a.go('landing'); break;
      }
    };
    const offShortcut = api.onShortcut(run);
    const offAction = api.onNotificationAction(run);
    const offDeepLink = api.onDeepLink(({ code }) => { if (code) appRef.current.openCode(code); });
    return () => { offShortcut(); offAction(); offDeepLink(); };
  }, [api]);

  // The mini window is only meaningful during a meeting; hide it on the way out.
  useEffect(() => {
    if (api && !inMeeting) api.mini.hide();
  }, [api, inMeeting]);

  return null;
}
