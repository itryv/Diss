import { useApp } from '../store';
import { Ic } from '../icons';
import { fmtElapsed } from '../util';

export function Post() {
  const app = useApp();
  const s = app.s;
  const ended = s.postKind === 'ended';
  const ratedLow = s.rating > 0 && s.rating < 4 && !s.ratedDone;
  return (
    <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, textAlign: 'center', padding: 32 }}>
      <div>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 38, margin: '0 0 8px' }}>{ended ? 'The host ended the meeting' : 'You left the meeting'}</h1>
        <p style={{ color: '#a3988a', fontSize: 15.5, margin: 0 }}>{ended ? 'Thanks for coming — see you at the next one.' : 'Left by accident? Happens to the best of us.'}</p>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {!ended && s.meeting && (
          <button className="hv-primary" onClick={() => app.go('lobby', { permState: 'prompt', joinError: null })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 13, padding: '14px 30px', fontWeight: 700, fontSize: 15.5, cursor: 'pointer' }}>Rejoin</button>
        )}
        <button className="hv-bg-2a" onClick={() => app.go(s.user ? 'dash' : 'landing')} style={{ background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 13, padding: '14px 26px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Back to home</button>
      </div>
      <div style={{ background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 18, padding: '22px 28px', width: 360 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#c9beb0', marginBottom: 12 }}>How was the call quality?</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
          {[1, 2, 3, 4, 5].map(v => (
            <button key={v} onClick={() => app.patch({ rating: v, ratedDone: v >= 4 })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: v <= s.rating ? '#f0b45f' : '#3a332b', padding: 2 }}>
              <Ic name="star" size={26} />
            </button>
          ))}
        </div>
        {ratedLow && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['Audio', 'Video', 'Connection'].map(label => {
              const on = s.issues.includes(label);
              return (
                <button
                  key={label}
                  onClick={() => app.patch(st => ({ issues: on ? st.issues.filter(x => x !== label) : [...st.issues, label], ratedDone: false }))}
                  style={{ background: on ? 'rgba(240,139,95,.15)' : 'none', border: `1px solid ${on ? 'rgba(240,139,95,.5)' : '#3a332b'}`, color: on ? '#f0a97f' : '#a3988a', borderRadius: 99, padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                >{label}</button>
              );
            })}
          </div>
        )}
        {s.ratedDone && <div style={{ color: '#6fbf8f', fontSize: 13, fontWeight: 600 }}>Thanks — that helps us a lot</div>}
        <div style={{ marginTop: 10 }}>
          <a href="#" onClick={e => { e.preventDefault(); app.patch({ ratedDone: true }); }} style={{ fontSize: 12, color: '#6f665b' }}>Skip</a>
        </div>
      </div>
      <div style={{ color: '#6f665b', fontSize: 13 }}>That was <span style={{ color: '#a3988a', fontWeight: 600 }}>{fmtElapsed(s.elapsedS)}</span> well spent.</div>
    </section>
  );
}
