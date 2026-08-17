import { useEffect, useState } from 'react';
import { bridge } from './bridge';
import type { CaptureSource } from './bridge';

const DISPLAY = "'Bricolage Grotesque',sans-serif";

function Warning({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div style={{ margin: '0 22px 16px', background: 'rgba(224,180,95,.09)', border: '1px solid rgba(224,180,95,.28)', borderRadius: 12, padding: '13px 15px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#e0b45f" strokeWidth="1.9" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}>
        <path d="M12 3.5l9.5 16.5H2.5z" /><path d="M12 10v4M12 17h.01" />
      </svg>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: '#e8d5b0' }}>
        Sharing your whole screen shows your notifications too — consider sharing a window instead.
        <button onClick={onDismiss} style={{ display: 'block', marginTop: 7, background: 'none', border: 'none', padding: 0, color: '#a3988a', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>
          Don't remind me
        </button>
      </div>
    </div>
  );
}

/**
 * Shown when the renderer calls getDisplayMedia. Runs in its own modal window;
 * whatever it picks is handed straight back to Electron's display-media handler.
 */
export function PickerApp() {
  const api = bridge();
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const [withAudio, setWithAudio] = useState(false);
  const [warn, setWarn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingWindows, setLoadingWindows] = useState(true);
  const mac = api?.platform === 'darwin';
  const audioBlocked = api?.systemAudio === false;

  // Screens first, then windows: capturing a dozen window bitmaps takes noticeably
  // longer, and there is no reason to make someone wait for them to pick a screen.
  useEffect(() => {
    if (!api) return;
    let live = true;
    (async () => {
      try {
        const screens = await api.getSources('screen');
        if (!live) return;
        setSources(screens);
        if (screens[0]) setSelected(screens[0].id);

        const windows = await api.getSources('window');
        if (!live) return;
        setSources([...screens, ...windows]);
      } catch (e) {
        if (live) setError((e as Error)?.message || 'Could not read your screens');
      } finally {
        if (live) setLoadingWindows(false);
      }
    })();
    return () => { live = false; };
  }, [api]);

  // Esc cancels, like any other picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') api?.picker.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  const shown = (sources ?? []).filter(s => s.kind === tab);
  const canShare = !!selected && shown.some(s => s.id === selected);

  const tabButton = (key: 'screen' | 'window', label: string) => {
    const active = tab === key;
    return (
      <button
        onClick={() => {
          setTab(key);
          const first = (sources ?? []).find(s => s.kind === key);
          setSelected(first ? first.id : null);
        }}
        style={{ border: 'none', borderRadius: 99, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: active ? '#2e2822' : 'transparent', color: active ? '#f4eee5' : '#a3988a' }}
      >{label}</button>
    );
  };

  return (
    <div className="satellite" style={{ fontFamily: "'Instrument Sans',sans-serif", width: '100vw', height: '100vh', background: '#241f1a', border: '1px solid #3a332b', borderRadius: 18, color: '#f4eee5', display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none', boxSizing: 'border-box' }}>
      <div style={{ padding: '20px 22px 0', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, marginBottom: 14 }}>Share your screen</div>
        <div style={{ display: 'flex', gap: 6, background: '#1c1815', border: '1px solid #2e2822', borderRadius: 99, padding: 4, width: 'fit-content', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {tabButton('screen', 'Screens')}
          {tabButton('window', 'Windows')}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
        {error && (
          <div style={{ background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.4)', borderRadius: 12, padding: 14, fontSize: 13.5, color: '#e0836f', lineHeight: 1.5 }}>
            {error}
            {mac && <div style={{ marginTop: 8, color: '#a3988a' }}>macOS may be blocking Screen Recording for Diss — check Settings → Desktop.</div>}
          </div>
        )}
        {!error && sources === null && <div style={{ color: '#8a7f70', fontSize: 13.5 }}>Looking for your screens…</div>}
        {!error && sources !== null && tab === 'window' && loadingWindows && shown.length === 0 && (
          <div style={{ color: '#8a7f70', fontSize: 13.5 }}>Looking for open windows…</div>
        )}
        {!error && sources !== null && shown.length === 0 && !(tab === 'window' && loadingWindows) && (
          <div style={{ color: '#8a7f70', fontSize: 13.5, lineHeight: 1.5 }}>
            Nothing to share here.
            {mac && tab === 'screen' && ' If your screens are missing, Diss may not have Screen Recording permission yet.'}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {shown.map(s => {
            const on = selected === s.id;
            return (
              <div key={s.id} onClick={() => setSelected(s.id)} onDoubleClick={() => api?.picker.choose({ id: s.id, withAudio })} style={{ cursor: 'pointer' }}>
                <div style={{ aspectRatio: '16/10', borderRadius: 12, background: '#14110f', border: `2px solid ${on ? '#f08b5f' : '#2e2822'}`, position: 'relative', overflow: 'hidden' }}>
                  {s.thumbnail ? (
                    <img src={s.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    // No preview available — say so plainly rather than showing a
                    // broken image; the surface is still perfectly shareable.
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, color: '#6f665b', padding: 12, textAlign: 'center' }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
                      </svg>
                      <span style={{ fontSize: 11.5, lineHeight: 1.35 }}>No preview — still shareable</span>
                    </div>
                  )}
                  <span style={{ position: 'absolute', right: 8, top: 8, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${on ? '#f08b5f' : '#2e2822'}`, background: on ? '#f08b5f' : 'rgba(20,17,15,.7)' }} />
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, color: '#d6cec2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      {warn && tab === 'screen' && !error && <Warning onDismiss={() => setWarn(false)} />}

      {audioBlocked && mac && !error && (
        <div style={{ margin: '0 22px 14px', fontSize: 12.5, color: '#8a7f70', lineHeight: 1.5 }}>
          Sharing computer sound natively requires macOS 13 or later.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 22px', borderTop: '1px solid #2e2822', background: '#1e1a16' }}>
        <div
          onClick={() => !audioBlocked && setWithAudio(v => !v)}
          title={audioBlocked ? 'Sharing computer sound requires macOS 13 or later' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: audioBlocked ? 'not-allowed' : 'pointer', flex: 1, opacity: audioBlocked ? 0.55 : 1 }}
        >
          <span style={{ width: 38, height: 22, borderRadius: 99, background: withAudio ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .18s ease', flex: 'none' }}>
            <span style={{ position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: '50%', background: '#f4eee5', transform: `translateX(${withAudio ? 16 : 0}px)`, transition: 'transform .18s ease' }} />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Share audio</span>
          <span style={{ fontSize: 12, color: '#6f665b' }}>
            {audioBlocked ? 'requires macOS 13 or later' : 'system audio'}
          </span>
        </div>
        <button className="hv-fg" onClick={() => api?.picker.cancel()} style={{ background: 'none', border: '1px solid #3a332b', color: '#a3988a', borderRadius: 11, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
        <button
          className="hv-primary"
          disabled={!canShare}
          onClick={() => selected && api?.picker.choose({ id: selected, withAudio })}
          style={{ background: canShare ? '#f08b5f' : '#2e2822', color: canShare ? '#241209' : '#6f665b', border: 'none', borderRadius: 11, padding: '10px 22px', fontSize: 13.5, fontWeight: 700, cursor: canShare ? 'pointer' : 'default' }}
        >Share</button>
      </div>
    </div>
  );
}
