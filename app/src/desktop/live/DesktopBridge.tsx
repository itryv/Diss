import { useEffect, useRef } from 'react';
import { useApp } from '../../store';
import { meetingLink } from '../../api';
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
  const framePeer = s.peers.find(p => p.screenTrack)
    || s.peers.find(p => p.speaking && p.videoTrack)
    || s.peers.find(p => !p.isLocal && p.videoTrack)
    || s.peers.find(p => p.videoTrack);
  const frameTrack = framePeer?.screenTrack || framePeer?.videoTrack || null;
  const frameFit = framePeer?.screenTrack ? 'contain' : 'cover';

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
      link: s.meeting?.code ? meetingLink(s.meeting.code) : '',
    });
  }, [api, inMeeting, title, s.micMuted, s.camOff, peers, s.peers, s.meeting?.code]);

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
    void api.ready();
    return () => { offShortcut(); offAction(); offDeepLink(); };
  }, [api]);

  // The mini window is only meaningful during a meeting; hide it on the way out.
  useEffect(() => {
    if (api && !inMeeting) api.mini.hide();
  }, [api, inMeeting]);

  // The mini window is deliberately not a second LiveKit participant. The main
  // renderer samples the already-decoded active video into a small JPEG frame,
  // avoiding duplicate network/media connections while still showing real media.
  useEffect(() => {
    if (!api || !inMeeting || !frameTrack) {
      void api?.mini.setFrame({ dataUrl: null, fit: 'cover', name: '' });
      return;
    }
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    canvas.width = 336;
    canvas.height = 210;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    frameTrack.attach(video);
    void video.play().catch(() => undefined);
    const draw = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const scale = frameFit === 'contain'
        ? Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
        : Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.fillStyle = '#14110f';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      void api.mini.setFrame({ dataUrl: canvas.toDataURL('image/jpeg', 0.58), fit: frameFit, name: framePeer?.name || '' });
    };
    const timer = window.setInterval(draw, 250);
    draw();
    return () => {
      window.clearInterval(timer);
      frameTrack.detach(video);
      video.srcObject = null;
      void api.mini.setFrame({ dataUrl: null, fit: 'cover', name: '' });
    };
  }, [api, inMeeting, frameTrack, frameFit, framePeer?.name]);

  return null;
}
