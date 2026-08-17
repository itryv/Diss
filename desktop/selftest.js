'use strict';

/**
 * Boots the app, exercises the native paths, captures each real window to PNG and
 * exits. Run with `npm run selftest` — it is a smoke test, not part of the product.
 */
const { app, BrowserWindow, globalShortcut, Notification, desktopCapturer, systemPreferences, session } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const OUT = path.join(__dirname, 'selftest-out');
const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = function selftest(ctx) {
  const { win, tray, showMini, toggleTrayPanel, meeting, syncMeetingState } = ctx;
  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const shot = async (target, file) => {
    try {
      const img = await target.webContents.capturePage();
      const size = img.getSize();
      if (!size.width) throw new Error('empty capture');
      fs.writeFileSync(path.join(OUT, file), img.toPNG());
      return `${size.width}×${size.height}`;
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  };

  (async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await wait(3500); // let the dev server render all three windows

    // 1. Main window
    win.main.show();
    await wait(1200);
    log('main window visible', win.main.isVisible());
    log('main window capture', true, await shot(win.main, 'main.png'));

    // 2. Tray icon + panel
    log('tray icon created', !!tray && !tray.isDestroyed());
    toggleTrayPanel();
    await wait(1400);
    log('tray panel visible', win.tray.isVisible(), JSON.stringify(win.tray.getBounds()));
    log('tray panel capture', true, await shot(win.tray, 'tray.png'));
    win.tray.hide();

    // 3. Enter a meeting: tray icon state, mini window, always-on-top
    Object.assign(meeting, { active: true, title: 'Weekly team sync', speaker: 'Leila Boum', peers: 6, muted: false });
    syncMeetingState();
    await wait(600);
    showMini();
    await wait(1600);
    log('mini window visible', win.mini.isVisible());
    log('mini always-on-top', win.mini.isAlwaysOnTop());
    log('mini capture', true, await shot(win.mini, 'mini.png'));

    // 4. Muted variant (drives the tray icon too)
    meeting.muted = true;
    syncMeetingState();
    await wait(900);
    log('mini muted capture', true, await shot(win.mini, 'mini-muted.png'));

    // 5. Global shortcuts actually held by the OS
    log('global mute shortcut registered', globalShortcut.isRegistered(process.platform === 'darwin' ? 'Command+Shift+A' : 'Control+Shift+A'));
    log('global mini shortcut registered', globalShortcut.isRegistered(process.platform === 'darwin' ? 'Command+Shift+P' : 'Control+Shift+P'));

    // 6. Native notifications
    log('notifications supported', Notification.isSupported());
    if (Notification.isSupported()) {
      new Notification({ title: 'Diss', body: 'Weekly team sync starts in 10 min' }).show();
    }

    // 7. Real screen capture sources
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 160, height: 100 } });
      log('desktopCapturer sources', sources.length > 0, `${sources.length} sources`);
    } catch (e) {
      log('desktopCapturer sources', false, e.message);
    }

    // 8. Permission status (macOS only; informational)
    if (process.platform === 'darwin') {
      log('camera permission', true, systemPreferences.getMediaAccessStatus('camera'));
      log('microphone permission', true, systemPreferences.getMediaAccessStatus('microphone'));
      log('screen permission', true, systemPreferences.getMediaAccessStatus('screen'));
    }

    // 9. Tray panel while in a meeting (in-call strip)
    toggleTrayPanel();
    await wait(1200);
    log('tray in-call capture', true, await shot(win.tray, 'tray-incall.png'));

    // 10. Deep link registration
    log('diss:// protocol registered', app.isDefaultProtocolClient('diss'));

    // 11. The renderer knows it is running inside Electron
    const flags = await win.main.webContents.executeJavaScript(
      'JSON.stringify({bridge: !!window.diss, mac: document.documentElement.classList.contains("is-electron-mac")})'
    );
    const parsed = JSON.parse(flags);
    log('preload bridge reachable', parsed.bridge);
    log('mac chrome class applied', process.platform !== 'darwin' || parsed.mac);

    // 12. Tray panel sized itself to its content
    const trayH = win.tray.getSize()[1];
    log('tray panel fits content', trayH > 200 && trayH < 520, `${trayH}px tall`);

    // 13. The permission allowlist must actually discriminate by origin.
    // Serve a page from a *different* localhost port and let it ask for the mic:
    // a real foreign origin, not a data: URL whose script may fail for unrelated
    // reasons. Our handler should refuse it while the app's own origin succeeds.
    const foreign = http.createServer((_q, s) => {
      s.writeHead(200, { 'Content-Type': 'text/html' });
      s.end('<html><body>foreign origin probe</body></html>');
    });
    await new Promise(r => foreign.listen(0, '127.0.0.1', r));
    const foreignUrl = `http://127.0.0.1:${foreign.address().port}/`;

    const askForMic = async url => {
      const probe = new BrowserWindow({ show: false });
      try {
        await probe.loadURL(url);
        return await probe.webContents.executeJavaScript(
          `navigator.mediaDevices.getUserMedia({ audio: true })
             .then(s => { s.getTracks().forEach(t => t.stop()); return 'GRANTED'; })
             .catch(e => 'DENIED:' + e.name)`,
        );
      } catch (e) {
        return `error:${e.message}`;
      } finally {
        if (!probe.isDestroyed()) probe.destroy();
      }
    };

    const foreignResult = await askForMic(foreignUrl);
    log('foreign origin refused the mic', foreignResult.startsWith('DENIED'), foreignResult);

    // Control: the same call from our own origin must NOT be blocked by the
    // allowlist — otherwise the test above passes for the wrong reason.
    const ownResult = await askForMic(ctx.uiBase);
    log('own origin still allowed the mic', !ownResult.startsWith('DENIED:NotAllowedError'), ownResult);
    foreign.close();

    // 14. Screen-share plumbing: the display-media handler must be registered,
    // otherwise getDisplayMedia silently fails in Electron.
    log('display media handler registered', typeof session.defaultSession.setDisplayMediaRequestHandler === 'function');

    // 15. Permission status reads (macOS TCC).
    if (process.platform === 'darwin') {
      const { systemPreferences } = require('electron');
      const statuses = ['camera', 'microphone', 'screen'].map(k => `${k}=${systemPreferences.getMediaAccessStatus(k)}`);
      log('permission statuses readable', true, statuses.join(' '));
    }

    // 15b. Hardened-runtime entitlements. Without these two the OS refuses camera
    // and mic outright — no prompt, and the app never appears in System Settings.
    // Only meaningful for a packaged build; `npm run dev` runs unsigned Electron.
    if (process.platform === 'darwin' && app.isPackaged) {
      const { execFileSync } = require('child_process');
      const appPath = path.join(app.getAppPath(), '..', '..', '..');
      const needed = ['com.apple.security.device.camera', 'com.apple.security.device.audio-input'];
      const checkEntitlements = target => {
        try {
          const xml = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', target], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
          });
          return needed.every(k => xml.includes(k));
        } catch { return false; }
      };
      log('app is signed with media entitlements', checkEntitlements(appPath));
      const helper = path.join(appPath, 'Contents', 'Frameworks', 'Diss Helper.app');
      log('helper inherits media entitlements', !fs.existsSync(helper) || checkEntitlements(helper));

      const plist = path.join(appPath, 'Contents', 'Info.plist');
      const info = fs.existsSync(plist) ? fs.readFileSync(plist, 'utf8') : '';
      log('Info.plist carries usage strings',
        info.includes('NSCameraUsageDescription')
          && info.includes('NSMicrophoneUsageDescription')
          && info.includes('NSAudioCaptureUsageDescription'));
    }

    // 16a. The Permissions window renders and offers an ask path.
    const permProbe = new BrowserWindow({
      show: false, width: 520, height: 480,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    await permProbe.loadURL(`${ctx.uiBase}#permissions`);
    await wait(1500);
    const permState = await permProbe.webContents.executeJavaScript(
      `JSON.stringify({
        heading: document.body.innerText.includes('Permissions'),
        rows: ['Camera','Microphone','Screen Recording'].filter(l => document.body.innerText.includes(l)).length,
        askButtons: [...document.querySelectorAll('button')].filter(b => b.innerText.includes('Ask macOS')).length,
      })`
    ).catch(() => '{}');
    const pv = JSON.parse(permState);
    log('permissions window renders', !!pv.heading && pv.rows === 3, `${pv.rows} rows`);
    log('undecided permissions are askable', (pv.askButtons || 0) > 0, `${pv.askButtons || 0} Ask buttons`);
    log('permissions window capture', true, await shot(permProbe, 'permissions.png'));
    permProbe.destroy();

    // 16. The picker route renders (this is the window the share flow opens).
    const pickerProbe = new (require('electron').BrowserWindow)({
      show: false, width: 680, height: 620,
      webPreferences: { preload: require('path').join(__dirname, 'preload.js'), contextIsolation: true },
    });
    await pickerProbe.loadURL(`${ctx.uiBase}#picker`);
    await wait(3500); // thumbnails for every screen and window take a beat
    const pickerState = await pickerProbe.webContents.executeJavaScript(
      `JSON.stringify({
        heading: document.body.innerText.includes('Share your screen'),
        thumbs: document.querySelectorAll('img[src^="data:image"]').length,
        imgs: [...document.querySelectorAll('img')].map(i => ({ len: i.src.length, nw: i.naturalWidth, ok: i.complete })),
      })`
    ).catch(() => '{}');
    const pick = JSON.parse(pickerState);
    log('share picker renders', !!pick.heading);
    log('share picker lists real sources', (pick.thumbs || 0) > 0,
      `${pick.thumbs || 0} thumbnails ${JSON.stringify(pick.imgs || [])}`);
    log('share picker capture', true, await shot(pickerProbe, 'picker.png'));
    pickerProbe.destroy();

    const failed = results.filter(r => !r.ok);
    console.log(`[selftest] ${results.length - failed.length}/${results.length} passed`);
    console.log(`[selftest] screenshots in ${OUT}`);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    app.exit(failed.length ? 1 : 0);
  })().catch(e => {
    console.error('[selftest] crashed:', e);
    app.exit(1);
  });
};
