'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, Notification,
  screen, nativeImage, desktopCapturer, shell, dialog, systemPreferences, net, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const IS_MAC = process.platform === 'darwin';
const DEV_URL = process.env.DISS_DEV_URL || '';

// A packaged build carries NSAudioCaptureUsageDescription and uses Chromium's
// CoreAudio Tap path. The stock Electron.app used by `electron .` cannot inherit
// that Info.plist entry, so macOS 14.2+ would hand local development a silent,
// dead audio track. Electron documents this flag as the fallback to the older
// native Screen & System Audio Recording permission for that case.
if (IS_MAC && !app.isPackaged) {
  app.commandLine.appendSwitch('disable-features', 'MacCatapLoopbackAudioForScreenShare');
}

// Packaged builds carry the renderer in ./renderer; running from the repo falls
// back to the sibling web app's build output.
const PACKED_RENDERER = path.join(__dirname, 'renderer');
const RENDERER_DIR = fs.existsSync(path.join(PACKED_RENDERER, 'index.html'))
  ? PACKED_RENDERER
  : path.join(__dirname, '..', 'app', 'dist');
const DIST = path.join(RENDERER_DIR, 'index.html');

/**
 * Where the Diss backend lives. The renderer only ever calls the relative
 * `/api/…` paths it uses on the web; those are proxied below.
 *
 * Defaults to the deployed server so the installed app works without anything
 * running locally. Point it at a dev backend with
 * `DISS_API_ORIGIN=http://localhost:8787`.
 */
const API_ORIGIN = (process.env.DISS_API_ORIGIN || 'https://diss.remilekun.dev').replace(/\/+$/, '');

/**
 * The renderer is served over http from localhost rather than loaded from file://.
 *
 * A file:// page has a null origin, which breaks the two things this app needs
 * most: relative `/api/…` requests resolve to `file:///api/…`, and the session
 * cookie has nowhere to live (Chromium refuses credentialed requests on non-http
 * schemes, custom protocols included). Serving from a real http origin — and
 * proxying `/api` through it — means the renderer behaves exactly as it does on
 * the web: same-origin calls, ordinary cookies, no CORS.
 *
 * The port is fixed so the origin is stable across launches and the session
 * survives a restart; if it is taken we walk to the next one.
 */
const BASE_PORT = Number(process.env.DISS_UI_PORT) || 8790;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

let uiOrigin = '';

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', () => resolve(undefined));
  });
}

/**
 * Rewrite an upstream Set-Cookie so it survives on the local origin.
 *
 * The session cookie is issued for the API's own host over TLS, so it may carry
 * `Domain=` and `Secure`. Replayed verbatim to http://127.0.0.1 the browser would
 * drop it and the app would look permanently signed out. Dropping those two
 * attributes is safe here: the cookie only ever travels over loopback on this
 * side, and its trip to the real server is TLS-protected by the proxy.
 */
function localiseCookie(cookie) {
  return cookie
    .split(';')
    .filter(part => {
      const name = part.trim().toLowerCase();
      return !name.startsWith('domain=') && name !== 'secure';
    })
    // SameSite=None is only valid alongside Secure, which we just removed.
    .map(part => (part.trim().toLowerCase() === 'samesite=none' ? ' SameSite=Lax' : part))
    .join(';');
}

async function proxyApi(req, res) {
  const target = `${API_ORIGIN}${req.url}`;
  try {
    // Forward only what the API needs. Passing the browser's full header set
    // through (hop-by-hop, sec-fetch-*, encoding negotiation) makes Electron's
    // net stack reject the request outright with ERR_INVALID_ARGUMENT.
    const PASS = ['cookie', 'content-type', 'accept', 'authorization'];
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (PASS.includes(k) || k.startsWith('x-')) headers[k] = v;
    }
    const upstream = await net.fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req),
    });

    const out = {};
    upstream.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    // Multiple Set-Cookie headers must survive as an array, or the session breaks.
    const cookies = (upstream.headers.getSetCookie?.() ?? []).map(localiseCookie);
    res.writeHead(upstream.status, cookies.length ? { ...out, 'Set-Cookie': cookies } : out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    console.error('[diss] api proxy failed:', target, e && e.message);
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Can't reach the server at ${API_ORIGIN}` }));
  }
}

function serveRenderer(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(RENDERER_DIR, rel));
  // Unknown paths fall back to index.html so hash routes keep working.
  const target = file.startsWith(RENDERER_DIR) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : DIST;
  // Built assets carry a content hash in the filename, so they can be cached hard.
  // index.html must not be: it is what points at the current hashes, and a cached
  // copy pins the app to a previous build even after an update.
  const isHtml = target.endsWith('.html');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(target).pipe(res);
}

function startUiServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) return proxyApi(req, res);
      serveRenderer(req, res);
    });
    let port = BASE_PORT;
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && port < BASE_PORT + 10) return server.listen(++port, '127.0.0.1');
      reject(err);
    });
    server.on('listening', () => {
      uiOrigin = `http://127.0.0.1:${server.address().port}`;
      // Naming the directory matters: a stale ./renderer from a previous pack
      // silently shadows ../app/dist, which looks exactly like "my changes did nothing".
      console.log(`[diss] renderer served at ${uiOrigin} from ${RENDERER_DIR}, api proxied to ${API_ORIGIN}`);
      resolve(uiOrigin);
    });
    server.listen(port, '127.0.0.1');
  });
}

/* ---------------------------------------------------------------- permissions */

/**
 * What the renderer is allowed to ask the OS for.
 *
 * Electron grants every permission request by default, so an explicit allowlist
 * is the difference between "a meeting app" and "a browser that will hand any
 * loaded page the microphone". Anything not listed here is denied, and requests
 * from an origin we didn't serve are denied outright.
 */
const ALLOWED_PERMISSIONS = new Set([
  'media',              // camera + microphone
  'display-capture',    // screen share
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
]);

function isOwnOrigin(url) {
  if (!url) return false;
  try {
    const origin = new URL(url).origin;
    return origin === uiOrigin || (!!DEV_URL && origin === new URL(DEV_URL).origin);
  } catch { return false; }
}

function installPermissionHandlers(sess) {
  sess.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details?.requestingUrl || contents?.getURL?.();
    const ok = ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(url);
    if (!ok) console.warn('[diss] permission denied:', permission, url);
    callback(ok);
  });

  // Synchronous counterpart — used by things like navigator.permissions.query().
  sess.setPermissionCheckHandler((_contents, permission, origin) =>
    ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(origin || uiOrigin));

  // Screen share: Electron denies getDisplayMedia unless this is handled, which
  // is why sharing silently fails without it. We answer with our own picker.
  sess.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isOwnOrigin(request?.frame?.url ?? request?.securityOrigin)) return callback({});
    try {
      const choice = await pickShareSource();
      if (!choice) return callback({});                     // user cancelled
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find(s => s.id === choice.id);
      if (!source) return callback({});
      // Electron 39+ uses Apple's native CoreAudio Tap API on macOS 14.2+ and
      // ScreenCaptureKit on macOS 13/14.1. Windows uses WASAPI loopback. Both
      // arrive through the same Electron `loopback` source — no virtual audio
      // device is required.
      const canLoopback = process.platform === 'win32'
        || (IS_MAC && Number(process.getSystemVersion().split('.')[0]) >= 13);
      const audio = choice.withAudio && canLoopback ? 'loopback' : undefined;
      callback(audio ? { video: source, audio } : { video: source });
    } catch (e) {
      console.error('[diss] display media request failed:', e && e.message);
      callback({});
    }
  }, { useSystemPicker: false });
}

/**
 * macOS gates camera, microphone and screen recording behind TCC. Ask at the
 * moment the feature is used, and report a status the UI can act on.
 */
async function ensureMediaAccess(kind) {
  if (!IS_MAC) return 'granted';
  const status = systemPreferences.getMediaAccessStatus(kind);
  if (status !== 'not-determined') return status;
  try {
    return (await systemPreferences.askForMediaAccess(kind)) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/* --------------------------------------------------------------- share picker */

/** Resolves with the chosen source, or null when the user cancels. */
let pendingPick = null;

function pickShareSource() {
  if (pendingPick) return pendingPick.promise;

  const parent = win.main && !win.main.isDestroyed() ? win.main : undefined;
  const picker = new BrowserWindow({
    width: 680, height: 620,
    parent, modal: !!parent && !IS_MAC, show: false, frame: false, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRoute(picker, 'picker');
  picker.once('ready-to-show', () => { picker.show(); activate(); });

  let settle;
  const promise = new Promise(resolve => { settle = resolve; });
  const finish = choice => {
    if (!pendingPick) return;
    pendingPick = null;
    if (!picker.isDestroyed()) picker.destroy();
    settle(choice);
  };
  picker.on('closed', () => finish(null));
  pendingPick = { promise, finish };
  return promise;
}

/* ------------------------------------------------------------------- windows */

/** Windows and cross-cutting app state. */
const win = { main: null, mini: null, tray: null, permissions: null };
let tray = null;
let quitting = false;

/** Mirrors what the renderer reports so the tray, shortcuts and quit guard can act on it. */
const meeting = { active: false, title: '', muted: false, cameraOff: false, speaker: '', peers: 0 };

/** Persisted-ish preferences. Mirrors Settings → Desktop; in-memory for v1. */
const prefs = {
  launchAtLogin: false,
  keepRunning: true,
  floatMini: true,
  closeShrinks: true,
  muteCombo: IS_MAC ? 'Command+Shift+A' : 'Control+Shift+A',
  miniCombo: IS_MAC ? 'Command+Shift+P' : 'Control+Shift+P',
};

/* ------------------------------------------------------------------ helpers */

/** Load a renderer route: the dev server when running `npm run dev`, else the app:// bundle. */
function loadRoute(target, hash) {
  const base = DEV_URL || `${uiOrigin}/index.html`;
  return target.loadURL(`${base}${hash ? `#${hash}` : ''}`);
}

/**
 * Tray artwork, drawn as a BGRA bitmap so the app carries no image assets.
 * On macOS the plain dot ships as a template image so it follows the menu bar's
 * light/dark tint; the coloured states opt out because their colour is the signal.
 */
function trayIcon(state) {
  const S = 32, scale = 2, buf = Buffer.alloc(S * S * 4);
  const px = (x, y, [b, g, r, a]) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a;
  };
  const disc = (cx, cy, rad, color) => {
    for (let y = Math.floor(cy - rad) - 1; y <= cy + rad + 1; y++) {
      for (let x = Math.floor(cx - rad) - 1; x <= cx + rad + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > rad + 0.5) continue;
        const a = Math.round(255 * Math.min(1, rad + 0.5 - d)); // cheap antialias
        px(x, y, [color[0], color[1], color[2], Math.round((color[3] ?? 255) * (a / 255))]);
      }
    }
  };

  const ACCENT = [95, 139, 240, 255];  // #f08b5f in BGRA
  const DANGER = [56, 74, 201, 255];   // #c94a38
  const INK = [0, 0, 0, 255];

  let template = false;
  if (state === 'idle') { disc(16, 16, 9, INK); template = true; }
  else if (state === 'soon') { disc(16, 16, 9, INK); disc(24, 8, 5, ACCENT); }
  else if (state === 'muted') {
    disc(16, 16, 9, DANGER);
    for (let t = -13; t <= 13; t++) for (let w = -1; w <= 1; w++) px(16 + t + w, 16 - t, [255, 255, 255, 255]);
  } else { disc(16, 16, 9, ACCENT); }

  const img = nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: scale });
  if (IS_MAC && template) img.setTemplateImage(true);
  return img;
}

function trayState() {
  if (!meeting.active) return 'idle';
  return meeting.muted ? 'muted' : 'inmeeting';
}

function refreshTray() {
  if (!tray) return;
  tray.setImage(trayIcon(trayState()));
  tray.setToolTip(meeting.active ? `Diss — ${meeting.title || 'In a meeting'}` : 'Diss');
}

/** Push state to every renderer so tray panel, mini window and main app stay in step. */
function broadcast(channel, payload) {
  for (const w of [win.main, win.mini, win.tray, win.permissions]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function syncMeetingState() {
  refreshTray();
  broadcast('meeting:state', meeting);
  // The mini window only makes sense during a meeting.
  if (!meeting.active && win.mini && !win.mini.isDestroyed()) win.mini.hide();
}

/* ------------------------------------------------------------------ windows */

function createMainWindow() {
  win.main = new BrowserWindow({
    width: 1200, height: 800, minWidth: 940, minHeight: 640,
    backgroundColor: '#151210',
    show: false,
    // macOS keeps the traffic lights floating over our own dark chrome; Windows
    // keeps its native frame in v1 rather than half-implementing a caption bar.
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: IS_MAC ? { x: 16, y: 14 } : undefined,
    title: 'Diss',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadRoute(win.main);
  win.main.once('ready-to-show', () => { win.main.show(); activate(); });

  // Closing while in a meeting shrinks to the mini window instead of dropping the
  // call — the "calm under pressure" rule from the spec.
  win.main.on('close', e => {
    if (quitting) return;
    if (meeting.active && prefs.closeShrinks) {
      e.preventDefault();
      win.main.hide();
      showMini();
      notify({ title: 'Still in the meeting', body: 'Diss shrank to the mini window. Use the tray to leave.' });
      return;
    }
    if (prefs.keepRunning) { e.preventDefault(); win.main.hide(); }
  });

  win.main.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createMiniWindow() {
  win.mini = new BrowserWindow({
    width: 280, height: 175,
    show: false, frame: false, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
    // Transparent so the renderer's own rounded corners are the window's shape.
    transparent: true, backgroundColor: '#00000000', hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' keeps it above full-screen apps; visible on every Space.
  win.mini.setAlwaysOnTop(true, 'screen-saver');
  win.mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRoute(win.mini, 'mini');
  win.mini.on('close', e => { if (!quitting) { e.preventDefault(); win.mini.hide(); } });
}

/** Park the mini window in the last-used corner (bottom-right by default). */
function positionMini() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w, h] = win.mini.getSize();
  win.mini.setPosition(workArea.x + workArea.width - w - 24, workArea.y + workArea.height - h - 24);
}

function showMini() {
  if (!win.mini || win.mini.isDestroyed()) createMiniWindow();
  positionMini();
  win.mini.showInactive();
}

function createTrayPanel() {
  win.tray = new BrowserWindow({
    width: 320, height: 360,
    show: false, frame: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false,
    transparent: true, backgroundColor: '#00000000',
    // macOS: a non-activating NSPanel, like every real menu-bar app. A regular
    // window here steals app activation, and when it hides on blur with no other
    // Diss window visible, macOS hands the menu bar to whichever app is next —
    // which reads as "Diss's menu bar opens another app".
    ...(IS_MAC ? { type: 'panel', hiddenInMissionControl: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRoute(win.tray, 'tray');
  win.tray.on('blur', () => win.tray.hide());
}

/** macOS hangs the panel from the menu bar; Windows raises it from the tray. */
function positionTrayPanel() {
  const bounds = tray.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const [w, h] = win.tray.getSize();
  const x = Math.min(Math.max(workArea.x + 8, Math.round(bounds.x + bounds.width / 2 - w / 2)), workArea.x + workArea.width - w - 8);
  const y = IS_MAC ? Math.round(bounds.y + bounds.height + 6) : workArea.y + workArea.height - h - 8;
  win.tray.setPosition(x, y, false);
}

function toggleTrayPanel() {
  if (!win.tray || win.tray.isDestroyed()) createTrayPanel();
  if (win.tray.isVisible()) return win.tray.hide();
  positionTrayPanel();
  win.tray.show();
  win.tray.focus();
}

function createTray() {
  tray = new Tray(trayIcon('idle'));
  tray.setToolTip('Diss');
  tray.on('click', toggleTrayPanel);
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Open Diss', click: showMain },
      { label: 'Permissions…', click: () => openPermissionsWindow() },
      { label: meeting.active ? `Leave ${meeting.title || 'meeting'}` : 'New meeting', click: () => broadcast('shortcut', meeting.active ? 'leave' : 'new-meeting') },
      { type: 'separator' },
      { label: 'Quit Diss', click: () => app.quit() },
    ]));
  });
}

/**
 * Standalone Permissions window. Kept independent of the signed-in app because
 * the camera/mic prompts must be reachable before anyone logs in — an app that
 * has never asked doesn't even appear in System Settings → Privacy & Security.
 */
function openPermissionsWindow() {
  if (win.permissions && !win.permissions.isDestroyed()) {
    win.permissions.show();
    win.permissions.focus();
    return win.permissions;
  }
  win.permissions = new BrowserWindow({
    width: 520, height: 480,
    show: false, frame: false, resizable: false,
    transparent: true, backgroundColor: '#00000000',
    title: 'Permissions',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRoute(win.permissions, 'permissions');
  win.permissions.once('ready-to-show', () => { win.permissions.show(); activate(); });
  win.permissions.on('closed', () => { win.permissions = null; });
  return win.permissions;
}

/**
 * Bring Diss to the front for real.
 *
 * Showing and focusing a window is not the same as activating the application:
 * without this the window appears but macOS keeps the previously-active app
 * frontmost, so the menu bar at the top of the screen still belongs to that other
 * app. `app.focus({ steal: true })` is what actually hands Diss the menu bar.
 */
function activate() {
  if (IS_MAC) app.focus({ steal: true });
}

function showMain() {
  if (!win.main || win.main.isDestroyed()) createMainWindow();
  if (win.main.isMinimized()) win.main.restore();
  win.main.show();
  win.main.focus();
  activate();
  if (win.tray && win.tray.isVisible()) win.tray.hide();
}

/* ------------------------------------------------------------ notifications */

function notify({ title, body, action }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: title || 'Diss', body: body || '', silent: false });
  n.on('click', () => {
    showMain();
    if (action) broadcast('notification:action', action);
  });
  n.show();
  return n;
}

/* -------------------------------------------------------- global shortcuts */

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const bind = (accel, fn) => {
    if (!accel) return false;
    try { return globalShortcut.register(accel, fn); } catch { return false; }
  };
  const muted = bind(prefs.muteCombo, () => {
    if (!meeting.active) return;
    meeting.muted = !meeting.muted;
    syncMeetingState();
    broadcast('shortcut', 'toggle-mute');
  });
  const mini = bind(prefs.miniCombo, () => {
    if (!meeting.active) return;
    if (win.mini && win.mini.isVisible()) win.mini.hide();
    else showMini();
  });
  return { muted, mini };
}

/* ---------------------------------------------------------------- deep link */

function handleDeepLink(url) {
  if (!url || !url.startsWith('diss://')) return;
  const code = url.replace(/^diss:\/\/(join\/)?/, '').replace(/\/+$/, '');
  showMain();
  broadcast('deeplink', { code });
}

/* ---------------------------------------------------------------------- IPC */

ipcMain.handle('app:info', () => ({
  platform: process.platform,
  version: app.getVersion(),
  electron: process.versions.electron,
  prefs,
  meeting,
}));

ipcMain.handle('prefs:set', (_e, patch) => {
  Object.assign(prefs, patch || {});
  if (patch && ('muteCombo' in patch || 'miniCombo' in patch)) registerShortcuts();
  if (patch && 'launchAtLogin' in patch) {
    app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin, openAsHidden: true });
  }
  broadcast('prefs', prefs);
  return prefs;
});

ipcMain.handle('meeting:set', (_e, patch) => {
  Object.assign(meeting, patch || {});
  syncMeetingState();
  return meeting;
});

/** A satellite window (mini / tray panel) asking the main window to act. */
ipcMain.handle('command', (_e, name) => {
  if (name === 'toggle-mute') { meeting.muted = !meeting.muted; syncMeetingState(); }
  if (name === 'toggle-camera') { meeting.cameraOff = !meeting.cameraOff; syncMeetingState(); }
  broadcast('shortcut', name);
  if (name === 'new-meeting' || name === 'join' || name === 'settings') showMain();
  return true;
});

ipcMain.handle('permissions:open-window', () => { openPermissionsWindow(); return true; });
ipcMain.handle('mini:show', () => { showMini(); return true; });
ipcMain.handle('mini:hide', () => { win.mini && win.mini.hide(); return true; });
ipcMain.handle('mini:expand', () => { win.mini && win.mini.hide(); showMain(); return true; });
ipcMain.handle('mini:resize', (_e, { width, height }) => {
  if (!win.mini) return false;
  win.mini.setSize(Math.round(width), Math.round(height));
  positionMini();
  return true;
});

ipcMain.handle('tray:hide', () => { win.tray && win.tray.hide(); return true; });
/** The panel measures its own content so the window is never taller than what's in it. */
ipcMain.handle('tray:resize', (_e, height) => {
  if (!win.tray || win.tray.isDestroyed()) return false;
  const h = Math.max(200, Math.min(700, Math.round(height)));
  const [w] = win.tray.getSize();
  win.tray.setSize(w, h);
  if (win.tray.isVisible()) positionTrayPanel();
  return true;
});
ipcMain.handle('window:show-main', () => { showMain(); return true; });
ipcMain.handle('notify', (_e, opts) => { notify(opts || {}); return true; });

/**
 * Real screen/window picker data, including live thumbnails.
 *
 * Screens and windows are fetched separately, and empty thumbnails are retried
 * once: asking for every surface in a single call makes macOS drop the bitmap for
 * some of them, which reaches the UI as a broken image rather than an error.
 */
const THUMB = { width: 480, height: 300 };

async function collectSources(type) {
  const sources = await desktopCapturer.getSources({
    types: [type], thumbnailSize: THUMB, fetchWindowIcons: false,
  });
  const empties = sources.filter(s => s.thumbnail.isEmpty()).map(s => s.id);
  let retried = [];
  if (empties.length) {
    retried = await desktopCapturer.getSources({
      types: [type], thumbnailSize: THUMB, fetchWindowIcons: false,
    });
  }
  return sources.map(s => {
    const better = s.thumbnail.isEmpty() ? retried.find(r => r.id === s.id) : null;
    const thumb = better && !better.thumbnail.isEmpty() ? better.thumbnail : s.thumbnail;
    return {
      id: s.id,
      name: s.name,
      kind: type === 'screen' ? 'screen' : 'window',
      // An absent thumbnail is reported as such, so the UI can show a labelled
      // placeholder instead of a broken image.
      thumbnail: thumb.isEmpty() ? null : thumb.toDataURL(),
    };
  });
}

/**
 * Fetched one kind at a time, and never concurrently: overlapping getSources
 * calls make macOS hand back sources with empty bitmaps for every surface. The
 * picker asks for screens first so it can render them while windows are still
 * being captured — grabbing a dozen window bitmaps is the slow part.
 */
ipcMain.handle('capture:sources', async (_e, type) => {
  if (type === 'screen' || type === 'window') {
    const list = await collectSources(type);
    const blank = list.filter(s => !s.thumbnail).length;
    console.log(`[diss] capture sources: ${list.length} ${type}(s), ${blank} without a thumbnail`);
    return list;
  }
  const screens = await collectSources('screen');
  const windows = await collectSources('window');
  return [...screens, ...windows];
});

/** Ask for (or read) one permission. Triggers the OS prompt when undecided. */
ipcMain.handle('permissions:request', (_e, kind) => ensureMediaAccess(kind));

/** Read every permission's status without prompting — drives the settings panel. */
ipcMain.handle('permissions:status', () => {
  if (!IS_MAC) {
    // Windows has no equivalent pre-flight: capture is granted at use time and
    // the picker itself is the consent moment.
    return { camera: 'granted', microphone: 'granted', screen: 'granted', platform: 'win32' };
  }
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
    platform: 'darwin',
  };
});

const SETTINGS_PANE = {
  camera: 'Privacy_Camera',
  microphone: 'Privacy_Microphone',
  screen: 'Privacy_ScreenCapture',
};

ipcMain.handle('permissions:open-settings', (_e, pane) => {
  if (!IS_MAC) {
    const win32 = { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone' };
    return shell.openExternal(win32[pane] || 'ms-settings:privacy');
  }
  return shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${SETTINGS_PANE[pane] || SETTINGS_PANE.camera}`,
  );
});

/**
 * Screen Recording can't be prompted for from inside the app: macOS only offers
 * it once capture is attempted, and the grant needs a relaunch to take effect.
 * Trigger the system prompt by touching the capture API, then tell the truth.
 */
ipcMain.handle('permissions:request-screen', async () => {
  if (!IS_MAC) return { status: 'granted', needsRestart: false };
  const before = systemPreferences.getMediaAccessStatus('screen');
  if (before === 'granted') return { status: 'granted', needsRestart: false };
  try {
    // Asking for a thumbnail is what makes macOS surface the prompt.
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch { /* the prompt is the point; the result doesn't matter here */ }
  const after = systemPreferences.getMediaAccessStatus('screen');
  return { status: after, needsRestart: after === 'granted' && before !== 'granted' };
});

ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });

/** Only ever open http(s) externally — never let a renderer hand us a file: or custom scheme. */
ipcMain.handle('app:open-external', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    shell.openExternal(u.toString());
    return true;
  } catch { return false; }
});

/* The picker window reporting back. */
ipcMain.handle('picker:choose', (_e, choice) => { pendingPick?.finish(choice); return true; });
ipcMain.handle('picker:cancel', () => { pendingPick?.finish(null); return true; });

ipcMain.handle('app:quit', async () => {
  if (meeting.active) {
    const { response } = await dialog.showMessageBox(win.main, {
      type: 'warning',
      buttons: ['Stay in the meeting', 'Quit Diss'],
      defaultId: 0, cancelId: 0,
      message: `Quitting will disconnect you from ${meeting.title || 'the meeting'}`,
      detail: meeting.peers ? `${meeting.peers} people are still in it. You can rejoin with the same link.` : 'You can rejoin with the same link.',
    });
    if (response !== 1) return false;
  }
  app.quit();
  return true;
});

/* -------------------------------------------------------------- app menu */

function buildAppMenu() {
  const template = [
    ...(IS_MAC ? [{
      label: 'Diss',
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: () => { showMain(); broadcast('shortcut', 'settings'); } },
        { label: 'Permissions…', click: () => openPermissionsWindow() },
        { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' },
        { label: 'Quit Diss', accelerator: 'Command+Q', click: () => { quitting = true; app.quit(); } },
      ],
    }] : []),
    { label: 'File', submenu: [
      { label: 'New meeting', accelerator: 'CommandOrControl+N', click: () => { showMain(); broadcast('shortcut', 'new-meeting'); } },
      { label: 'Join with a code…', accelerator: 'CommandOrControl+J', click: () => { showMain(); broadcast('shortcut', 'join'); } },
      ...(IS_MAC ? [] : [{ label: 'Permissions…', click: () => openPermissionsWindow() }]),
      { type: 'separator' },
      IS_MAC ? { role: 'close' } : { label: 'Quit', accelerator: 'Control+Q', click: () => { quitting = true; app.quit(); } },
    ] },
    { role: 'editMenu' },
    { label: 'Meeting', submenu: [
      { label: 'Mute / unmute', accelerator: 'CommandOrControl+Shift+A', click: () => broadcast('shortcut', 'toggle-mute') },
      { label: 'Camera on / off', accelerator: 'CommandOrControl+Shift+V', click: () => broadcast('shortcut', 'toggle-camera') },
      { type: 'separator' },
      { label: 'Show / hide mini window', accelerator: 'CommandOrControl+Shift+P', click: () => (win.mini && win.mini.isVisible() ? win.mini.hide() : showMini()) },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Learn more', click: () => shell.openExternal('https://diss.app') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* --------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showMain();
    const link = argv.find(a => a.startsWith('diss://'));
    if (link) handleDeepLink(link);
  });
}

app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); });

app.whenReady().then(async () => {
  if (!DEV_URL) await startUiServer();
  installPermissionHandlers(session.defaultSession);
  app.setAsDefaultProtocolClient('diss');
  if (IS_MAC) app.setAboutPanelOptions({ applicationName: 'Diss', applicationVersion: app.getVersion() });

  createMainWindow();
  createMiniWindow();
  createTrayPanel();
  createTray();
  buildAppMenu();
  const shortcuts = registerShortcuts();
  console.log('[diss] global shortcuts:', JSON.stringify(shortcuts), prefs.muteCombo, prefs.miniCombo);

  app.on('activate', () => showMain());

  if (process.env.DISS_SELFTEST) {
    require('./selftest')({
      win, tray, showMini, toggleTrayPanel, meeting, syncMeetingState, notify,
      uiBase: DEV_URL || `${uiOrigin}/index.html`,
    });
  }

  // Startup health check: `DISS_SMOKE=1 Diss` reports what came up, then exits.
  // Useful for verifying a packaged build on a machine you can't click around on.
  if (process.env.DISS_SMOKE) {
    win.main.webContents.once('did-finish-load', async () => {
      const bridged = await win.main.webContents.executeJavaScript('!!window.diss').catch(() => false);
      const rendered = await win.main.webContents.executeJavaScript(
        'document.getElementById("root") && document.getElementById("root").children.length > 0'
      ).catch(() => false);
      // The API path is the thing most likely to be broken in a packaged build,
      // so exercise it exactly as the app does: a relative fetch from the page.
      const api = await win.main.webContents.executeJavaScript(
        `fetch('/api/auth/me', { credentials: 'include' })
           .then(r => 'HTTP ' + r.status)
           .catch(e => 'FAILED: ' + e.message)`
      ).catch(e => `FAILED: ${e.message}`);
      console.log(JSON.stringify({
        source: DEV_URL || `${uiOrigin} (${RENDERER_DIR})`,
        origin: await win.main.webContents.executeJavaScript('location.origin').catch(() => '?'),
        apiOrigin: API_ORIGIN,
        apiReachable: api,
        mainWindow: !!win.main && !win.main.isDestroyed(),
        rendererMounted: !!rendered,
        preloadBridge: !!bridged,
        tray: !!tray && !tray.isDestroyed(),
        miniAlwaysOnTop: win.mini.isAlwaysOnTop(),
        protocol: app.isDefaultProtocolClient('diss'),
        bundleId: app.getName ? require('electron').app.getPath('exe') : '',
        permissions: IS_MAC ? {
          camera: systemPreferences.getMediaAccessStatus('camera'),
          microphone: systemPreferences.getMediaAccessStatus('microphone'),
          screen: systemPreferences.getMediaAccessStatus('screen'),
        } : 'n/a',
        shortcuts,
      }, null, 2));
      app.exit(bridged && rendered ? 0 : 1);
    });
  }
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
// The app deliberately outlives its windows: reminders keep working from the tray.
app.on('window-all-closed', () => { if (!prefs.keepRunning) app.quit(); });
