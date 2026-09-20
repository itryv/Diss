import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { api } from '../api';
import type { TranscriptLine } from '../api';
import { Ic } from '../icons';

/** `14:32:05` — wall-clock is more useful than an offset when cross-referencing. */
const clockOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false });
};

/**
 * Plain text, one line per utterance with a timestamp and a speaker.
 *
 * Deliberately not JSON or CSV: the thing people do with a transcript is paste
 * it somewhere or search it, and a .txt does that everywhere.
 */
function asText(title: string, lines: TranscriptLine[]): string {
  const header = `${title}\n${'='.repeat(title.length)}\n\n`;
  return header + lines.map(l => `[${clockOf(l.ts)}] ${l.displayName}: ${l.text}`).join('\n') + '\n';
}

export function Transcript() {
  const app = useApp();
  const s = app.s;
  const meeting = s.meeting;
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meeting) return;
    let alive = true;
    api.transcript(meeting.code)
      .then(r => { if (alive) { setLines(r.lines); setError(null); } })
      .catch(() => {
        if (alive) {
          setLines([]);
          setError("Couldn't load the transcript. Only the host and co-hosts can read one.");
        }
      });
    return () => { alive = false; };
  }, [meeting]);

  const download = () => {
    if (!meeting || !lines) return;
    const blob = new Blob([asText(meeting.title || 'Meeting', lines)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meeting.code}-transcript.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async () => {
    if (!meeting || !lines) return;
    try {
      await navigator.clipboard?.writeText(asText(meeting.title || 'Meeting', lines));
      app.toast('Transcript copied');
    } catch { app.toast("Couldn't copy — use Download instead"); }
  };

  const btn: React.CSSProperties = {
    background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 11,
    padding: '10px 16px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
  };

  return (
    <div style={{ maxWidth: 760, animation: 'fadeUp .35s ease' }}>
      <button className="hv-fg" onClick={() => app.go('dash')} style={{ background: 'none', border: 'none', color: '#a3988a', cursor: 'pointer', padding: 0, marginBottom: 14, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Ic name="arrowBack" size={15} /> Back
      </button>
      <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 28, margin: '0 0 4px' }}>Transcript</h1>
      <p style={{ color: '#a3988a', fontSize: 14.5, margin: '0 0 20px' }}>
        {meeting?.title || 'Meeting'} · <span style={{ fontFamily: 'monospace' }}>{meeting?.code}</span>
      </p>

      {error && (
        <div role="alert" style={{ background: 'rgba(224,96,79,.1)', border: '1px solid rgba(224,96,79,.35)', color: '#e0836f', borderRadius: 12, padding: '12px 15px', fontSize: 13.5, marginBottom: 16 }}>{error}</div>
      )}

      {lines === null && <div style={{ color: '#968a7b', fontSize: 14 }}>Loading…</div>}

      {lines !== null && lines.length === 0 && !error && (
        <div style={{ color: '#968a7b', fontSize: 14, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 14, padding: '16px 18px' }}>
          Nothing captured yet. Captions have to be switched on during the meeting for a transcript to be recorded, and only your browser&rsquo;s own speech recognition contributes — so anyone on a browser without it will not appear here.
        </div>
      )}

      {lines !== null && lines.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="hv-bg-2a" onClick={download} style={btn}>Download .txt</button>
            <button className="hv-bg-2a" onClick={copy} style={btn}>Copy all</button>
            <span style={{ alignSelf: 'center', color: '#968a7b', fontSize: 13 }}>{lines.length} lines</span>
          </div>
          <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 14, lineHeight: 1.5 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#968a7b', flexShrink: 0 }}>{clockOf(l.ts)}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: '#f0a97f', fontWeight: 700, marginRight: 7 }}>{l.displayName}</span>
                  <span style={{ color: '#f4eee5' }}>{l.text}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
