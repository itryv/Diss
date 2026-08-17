import { useCallback, useEffect, useState } from 'react';
import { bridge } from './bridge';
import type { PermissionKind, PermissionState, PermissionStatuses } from './bridge';
import {
  PERMISSION_LABEL, PERMISSION_WHY, openPermissionSettings, permissionHint, readPermissions, requestScreenAccess,
} from './permissions';

const DOT: Record<PermissionState, string> = {
  granted: '#6fbf8f',
  denied: '#c94a38',
  restricted: '#c94a38',
  'not-determined': '#e0b45f',
  unknown: '#6f665b',
};

function Row({ kind, state, onFix, busy }: {
  kind: PermissionKind; state: PermissionState;
  onFix: (kind: PermissionKind, state: PermissionState) => void;
  busy: boolean;
}) {
  const needsAction = state !== 'granted';
  // Only an undecided permission can be prompted for. Once macOS has a decision
  // on file the app can never re-ask — System Settings is the only route back.
  const askable = state === 'not-determined';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '17px 20px', borderBottom: '1px solid #241f1a' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: DOT[state] ?? DOT.unknown, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{PERMISSION_LABEL[kind]}</div>
        <div style={{ fontSize: 12.5, color: '#8a7f70', marginTop: 2, lineHeight: 1.45 }}>
          {state === 'granted' ? PERMISSION_WHY[kind] : permissionHint(kind, state)}
        </div>
      </div>
      {needsAction && (
        <button
          className={askable ? 'hv-primary' : 'hv-bg-2e'}
          disabled={busy}
          onClick={() => onFix(kind, state)}
          style={{
            flex: 'none',
            background: askable ? '#f08b5f' : '#241f1a',
            color: askable ? '#241209' : '#f4eee5',
            border: askable ? 'none' : '1px solid #3a332b',
            borderRadius: 10, padding: '9px 15px', fontSize: 13, fontWeight: 600,
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          }}
        >{askable ? 'Ask macOS' : 'Open Settings'}</button>
      )}
    </div>
  );
}

/**
 * Live view of the OS permissions the app depends on. macOS only — on Windows
 * capture needs no pre-flight grant, so the panel says so instead of inventing
 * switches that do nothing.
 */
export function PermissionsPanel() {
  const api = bridge();
  const [perms, setPerms] = useState<PermissionStatuses | null>(null);
  const [busy, setBusy] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  const refresh = useCallback(() => { readPermissions().then(setPerms); }, []);

  useEffect(() => {
    refresh();
    // Grants happen in System Settings, outside this window — re-read whenever
    // the user comes back so the panel is never stale.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  if (!api) return null;

  if (perms && perms.platform !== 'darwin') {
    return (
      <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, padding: 20, fontSize: 13.5, color: '#a3988a', lineHeight: 1.55 }}>
        Windows doesn't gate the camera, microphone or screen capture behind a system grant for desktop apps — the share picker itself is the consent moment. Nothing to configure here.
      </div>
    );
  }

  const onFix = async (kind: PermissionKind, state: PermissionState) => {
    if (state !== 'not-determined') { openPermissionSettings(kind); return; }
    setBusy(true);
    try {
      if (kind === 'screen') {
        const res = await requestScreenAccess();
        setRestartNeeded(res.needsRestart);
      } else {
        // This is the call that makes macOS show the prompt — and the moment the
        // app first appears in System Settings → Privacy & Security.
        await api.permissions.request(kind);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const order: PermissionKind[] = ['camera', 'microphone', 'screen'];

  return (
    <div>
      <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, overflow: 'hidden' }}>
        {perms
          ? order.map(k => <Row key={k} kind={k} state={perms[k]} onFix={onFix} busy={busy} />)
          : <div style={{ padding: 20, fontSize: 13.5, color: '#8a7f70' }}>Checking…</div>}
        <div style={{ padding: '13px 20px', fontSize: 12.5, color: '#6f665b', lineHeight: 1.5 }}>
          macOS remembers these per app. Changes made in System Settings show up here as soon as you come back.
        </div>
      </div>

      {restartNeeded && (
        <div style={{ marginTop: 14, background: 'rgba(224,180,95,.09)', border: '1px solid rgba(224,180,95,.3)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, fontSize: 13.5, color: '#e8d5b0', lineHeight: 1.5 }}>
            Screen Recording is allowed, but macOS only applies it to a fresh launch. Restart Diss to finish.
          </div>
          <button className="hv-primary" onClick={() => api.relaunch()} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flex: 'none' }}>Restart now</button>
        </div>
      )}
    </div>
  );
}
