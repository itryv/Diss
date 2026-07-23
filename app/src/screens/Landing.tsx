import { useApp } from '../store';
import { codeOk } from '../util';

export function Landing() {
  const app = useApp();
  const s = app.s;
  const ok = codeOk(s.code);
  const join = () => {
    if (ok) app.go('lobby', { joinModal: false, permState: 'prompt' });
    else app.patch({ codeInvalid: true });
  };
  return (
    <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'radial-gradient(1000px 600px at 70% -10%, rgba(240,139,95,.10), transparent 60%), #151210' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 48px' }}>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          diss<span style={{ color: '#f08b5f', fontSize: 30, lineHeight: 0.6 }}>.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="hv-fg" onClick={() => app.go('auth', { authMode: 'signin', authStep: 'form' })} style={{ background: 'none', border: 'none', color: '#c9beb0', fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '10px 14px' }}>Sign in</button>
          <button className="hv-primary" onClick={() => app.go('auth', { authMode: 'signup', authStep: 'form' })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '11px 20px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Sign up free</button>
        </div>
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px 80px' }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 72, lineHeight: 1.02, letterSpacing: -2, margin: '0 0 20px', maxWidth: 820, textWrap: 'pretty' }}>Click the link.<br />You're in.</h1>
        <p style={{ fontSize: 19, color: '#a3988a', maxWidth: 520, margin: '0 0 36px', lineHeight: 1.55, textWrap: 'pretty' }}>Video meetings that start in seconds. No downloads, no sign-up for guests, no drama.</p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="hv-primary" onClick={() => app.go('auth', { authMode: 'signup', authStep: 'form' })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 14, padding: '16px 28px', fontWeight: 700, fontSize: 17, cursor: 'pointer', boxShadow: '0 8px 30px rgba(240,139,95,.25)' }}>Start a meeting</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#1e1a16', border: '1px solid #362f28', borderRadius: 14, padding: '6px 6px 6px 16px' }}>
            <input value={s.code} onChange={e => app.patch({ code: e.target.value, codeInvalid: false })} placeholder="Enter a code or link" style={{ background: 'none', border: 'none', outline: 'none', color: '#f4eee5', fontSize: 16, fontFamily: 'inherit', width: 210 }} />
            <button onClick={join} disabled={!ok && s.code.length === 0} style={{ background: ok ? '#f08b5f' : '#2e2822', color: ok ? '#241209' : '#6f665b', border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Join</button>
          </div>
        </div>
        {s.codeInvalid && (
          <div style={{ marginTop: 14, color: '#e0836f', fontSize: 14 }}>
            That code doesn't look right — check it and try again. Codes look like <span style={{ fontWeight: 600 }}>abc-defg-hij</span>.
          </div>
        )}
        <div style={{ marginTop: 90, display: 'flex', gap: 56, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            ['10 seconds to join', 'Guests never see a signup wall. Ever.'],
            ['Calm under pressure', 'Broken mic? Bad Wi-Fi? Every hiccup comes with a fix.'],
            ['Video is the hero', 'Controls show up when you need them, then get out of the way.'],
          ].map(([t, d]) => (
            <div key={t} style={{ maxWidth: 200 }}>
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{t}</div>
              <div style={{ color: '#a3988a', fontSize: 14, lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
      <footer style={{ padding: '20px 48px', color: '#6f665b', fontSize: 13, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #241f1a' }}>
        <span>© 2026 Diss</span>
        <span style={{ display: 'flex', gap: 18 }}><a href="#" style={{ color: '#6f665b' }}>Privacy</a><a href="#" style={{ color: '#6f665b' }}>Terms</a></span>
      </footer>
    </section>
  );
}
