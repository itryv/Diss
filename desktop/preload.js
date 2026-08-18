'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the renderer and Electron. Node stays out of the page:
 * everything below is an explicit, narrow call.
 */
const listeners = new Map();

function on(channel, cb) {
  const wrapped = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(cb, [channel, wrapped]);
  return () => {
    const entry = listeners.get(cb);
    if (entry) { ipcRenderer.removeListener(entry[0], entry[1]); listeners.delete(cb); }
  };
}

contextBridge.exposeInMainWorld('diss', {
  isDesktop: true,
  platform: process.platform,
  // Native desktop-audio capture is available through Electron on Windows and
  // macOS 13+. Keeping this synchronous lets the share picker render correctly
  // before it asks the main process for any capture source.
  systemAudio: process.platform === 'win32'
    || (process.platform === 'darwin' && Number(process.getSystemVersion().split('.')[0]) >= 13),

  info: () => ipcRenderer.invoke('app:info'),
  ready: () => ipcRenderer.invoke('renderer:ready'),
  setPrefs: patch => ipcRenderer.invoke('prefs:set', patch),
  quit: () => ipcRenderer.invoke('app:quit'),

  /** Report meeting state so the tray icon, shortcuts and quit guard can react. */
  setMeeting: patch => ipcRenderer.invoke('meeting:set', patch),

  /** Ask the main window to act (used by the mini window and tray panel). */
  command: name => ipcRenderer.invoke('command', name),

  mini: {
    show: () => ipcRenderer.invoke('mini:show'),
    hide: () => ipcRenderer.invoke('mini:hide'),
    expand: () => ipcRenderer.invoke('mini:expand'),
    resize: (width, height) => ipcRenderer.invoke('mini:resize', { width, height }),
    setFrame: frame => ipcRenderer.invoke('mini:frame', frame),
    onFrame: cb => on('mini:frame', cb),
  },

  tray: {
    hide: () => ipcRenderer.invoke('tray:hide'),
    resize: height => ipcRenderer.invoke('tray:resize', height),
  },
  showMain: () => ipcRenderer.invoke('window:show-main'),
  notify: opts => ipcRenderer.invoke('notify', opts),

  /** Real desktopCapturer sources, thumbnails included. */
  getSources: type => ipcRenderer.invoke('capture:sources', type),
  capture: {
    setIntent: intent => ipcRenderer.invoke('capture:set-intent', intent),
    intent: () => ipcRenderer.invoke('capture:intent'),
  },

  permissions: {
    /** Read camera/mic/screen status without prompting. */
    status: () => ipcRenderer.invoke('permissions:status'),
    /** Prompt for camera or microphone (no-op if already decided). */
    request: kind => ipcRenderer.invoke('permissions:request', kind),
    /** Nudge macOS into showing the Screen Recording prompt. */
    requestScreen: () => ipcRenderer.invoke('permissions:request-screen'),
    openSettings: pane => ipcRenderer.invoke('permissions:open-settings', pane),
    /** Open the standalone Permissions window (works signed out). */
    openWindow: () => ipcRenderer.invoke('permissions:open-window'),
  },

  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  /** Open a URL in the user's real browser, never in an app window. */
  openExternal: url => ipcRenderer.invoke('app:open-external', url),

  /** Screen-share picker window reporting the user's choice. */
  picker: {
    choose: choice => ipcRenderer.invoke('picker:choose', choice),
    cancel: () => ipcRenderer.invoke('picker:cancel'),
  },

  onMeeting: cb => on('meeting:state', cb),
  onPrefs: cb => on('prefs', cb),
  onShortcut: cb => on('shortcut', cb),
  onDeepLink: cb => on('deeplink', cb),
  onNotificationAction: cb => on('notification:action', cb),
});
