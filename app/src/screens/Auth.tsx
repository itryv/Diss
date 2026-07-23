import { useApp } from '../store';

const input: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 14px', color: '#f4eee5', fontSize: 15, fontFamily: 'inherit', outline: 'none' };
const oauthBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#2a241e', color: '#f4eee5', border: '1px solid #3a332b', borderRadius: 12, padding: 13, fontWeight: 600, fontSize: 15, cursor: 'pointer' };

export function Auth() {
  const app = useApp();
  const s = app.s;
  const signup = s.authMode === 'signup';
  const oauthSoon = () => app.patch({ authError: 'Social sign-in is coming soon — use email and password for now.' });
  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(800px 500px at 30% 0%, rgba(240,139,95,.08), transparent 60%), #151210' }}>
      <div style={{ width: 400, background: '#1e1a16', border: '1px solid #362f28', borderRadius: 20, padding: 36, animation: 'fadeUp .4s ease' }}>
        <div onClick={() => app.go('landing')} style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, cursor: 'pointer', marginBottom: 24 }}>diss<span style={{ color: '#f08b5f' }}>.</span></div>
        <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 26, margin: '0 0 6px' }}>{signup ? 'Create your account' : 'Welcome back'}</h2>
        <p style={{ color: '#a3988a', fontSize: 14, margin: '0 0 24px' }}>{signup ? 'Free forever for meetings up to 60 minutes.' : 'Good to see you again.'}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="hv-bg-33" onClick={oauthSoon} style={oauthBtn}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'conic-gradient(#ea4335 0 25%,#4285f4 0 50%,#34a853 0 75%,#fbbc05 0)' }} />Continue with Google
          </button>
          <button className="hv-bg-33" onClick={oauthSoon} style={oauthBtn}>
            <span style={{ width: 18, height: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <span style={{ background: '#f25022' }} /><span style={{ background: '#7fba00' }} /><span style={{ background: '#00a4ef' }} /><span style={{ background: '#ffb900' }} />
            </span>Continue with Microsoft
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', color: '#6f665b', fontSize: 13 }}>
          <span style={{ flex: 1, height: 1, background: '#362f28' }} />or<span style={{ flex: 1, height: 1, background: '#362f28' }} />
        </div>
        <form
          onSubmit={e => { e.preventDefault(); app.submitAuth(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {signup && (
            <input value={s.authName} onChange={e => app.patch({ authName: e.target.value, authError: null })} placeholder="Your name" autoComplete="name" style={input} />
          )}
          <input value={s.email} onChange={e => app.patch({ email: e.target.value, authError: null })} placeholder="you@work.com" type="email" autoComplete="email" style={input} />
          <input value={s.authPassword} onChange={e => app.patch({ authPassword: e.target.value, authError: null })} placeholder="Password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} style={input} />
          {s.authError && <div style={{ color: '#e0836f', fontSize: 13 }}>{s.authError}</div>}
          <button className="hv-primary" type="submit" disabled={s.authBusy} style={{ width: '100%', marginTop: 2, background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: 13, fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: s.authBusy ? 0.7 : 1 }}>
            {s.authBusy ? 'One sec…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 14, color: '#a3988a' }}>
          {signup ? 'Already have an account?' : 'New here?'}{' '}
          <a href="#" onClick={e => { e.preventDefault(); app.patch({ authMode: signup ? 'signin' : 'signup', authError: null }); }} style={{ fontWeight: 600 }}>{signup ? 'Sign in' : 'Create account'}</a>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#6f665b', lineHeight: 1.5 }}>
          By continuing you agree to our <a href="#" style={{ color: '#8a7f70' }}>Terms</a> and <a href="#" style={{ color: '#8a7f70' }}>Privacy Policy</a>.
        </div>
      </div>
    </section>
  );
}
