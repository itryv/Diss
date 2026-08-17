import { bridge } from './bridge';
import { PermissionsPanel } from './PermissionsPanel';

const DISPLAY = "'Bricolage Grotesque',sans-serif";

/**
 * Standalone Permissions window.
 *
 * Deliberately reachable without a session: the app has to be able to ask macOS
 * for the camera and microphone before anyone signs in, and an app that has never
 * asked doesn't appear in System Settings → Privacy & Security at all.
 */
export function PermissionsApp() {
  const api = bridge();
  return (
    <div
      className="satellite"
      style={{
        fontFamily: "'Instrument Sans',sans-serif", width: '100vw', height: '100vh',
        background: '#241f1a', border: '1px solid #3a332b', borderRadius: 18,
        color: '#f4eee5', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        userSelect: 'none', boxSizing: 'border-box',
      }}
    >
      <div style={{ padding: '22px 24px 16px', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20 }}>Permissions</div>
        <div style={{ fontSize: 13, color: '#a3988a', marginTop: 5, lineHeight: 1.5 }}>
          What Diss needs from your Mac. Anything not yet granted can be requested here.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px' }}>
        <PermissionsPanel />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 24px', borderTop: '1px solid #2e2822', background: '#1e1a16' }}>
        <button
          className="hv-bg-2e"
          onClick={() => window.close()}
          style={{ background: '#241f1a', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 11, padding: '10px 20px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
        >Done</button>
      </div>
      {!api && null}
    </div>
  );
}
