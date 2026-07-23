import { useApp } from '../store';
import { Ic } from '../icons';

const input: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 14px', color: '#f4eee5', fontSize: 15, fontFamily: 'inherit', outline: 'none' };
const oauthBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#2a241e', color: '#f4eee5', border: '1px solid #3a332b', borderRadius: 12, padding: 13, fontWeight: 600, fontSize: 15, cursor: 'pointer' };

export function Auth() {
  const app = useApp();
  const s = app.s;
  const signup = s.authMode === 'signup';
  const sendMagic = () => {
    if (/.+@.+\..+/.test(s.email)) app.patch({ authStep: 'sent' });
    else app.patch({ emailInvalid: true });
  };
  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(800px 500px at 30% 0%, rgba(240,139,95,.08), transparent 60%), #151210' }}>
      <div style={{ width: 400, background: '#1e1a16', border: '1px solid #362f28', borderRadius: 20, padding: 36, animation: 'fadeUp .4s ease' }}>
        <div onClick={() => app.go('landing')} style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, cursor: 'pointer', marginBottom: 24 }}>diss<span style={{ color: '#f08b5f' }}>.</span></div>
        {s.authStep === 'form' ? (
          <>
            <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 26, margin: '0 0 6px' }}>{signup ? 'Create your account' : 'Welcome back'}</h2>
            <p style={{ color: '#a3988a', fontSize: 14, margin: '0 0 24px' }}>{signup ? 'Free forever for meetings up to 60 minutes.' : 'Good to see you again.'}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="hv-bg-33" onClick={() => app.go('dash')} style={oauthBtn}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'conic-gradient(#ea4335 0 25%,#4285f4 0 50%,#34a853 0 75%,#fbbc05 0)' }} />Continue with Google
              </button>
              <button className="hv-bg-33" onClick={() => app.go('dash')} style={oauthBtn}>
                <span style={{ width: 18, height: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <span style={{ background: '#f25022' }} /><span style={{ background: '#7fba00' }} /><span style={{ background: '#00a4ef' }} /><span style={{ background: '#ffb900' }} />
                </span>Continue with Microsoft
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', color: '#6f665b', fontSize: 13 }}>
              <span style={{ flex: 1, height: 1, background: '#362f28' }} />or<span style={{ flex: 1, height: 1, background: '#362f28' }} />
            </div>
            <input value={s.email} onChange={e => app.patch({ email: e.target.value, emailInvalid: false })} placeholder="you@work.com" style={input} />
            {s.emailInvalid && <div style={{ color: '#e0836f', fontSize: 13, marginTop: 8 }}>Hmm, that doesn't look like an email address.</div>}
            <button className="hv-primary" onClick={sendMagic} style={{ width: '100%', marginTop: 12, background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: 13, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              {signup ? 'Continue with email' : 'Email me a sign-in link'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 18, fontSize: 14, color: '#a3988a' }}>
              {signup ? 'Already have an account?' : 'New here?'}{' '}
              <a href="#" onClick={e => { e.preventDefault(); app.patch({ authMode: signup ? 'signin' : 'signup' }); }} style={{ fontWeight: 600 }}>{signup ? 'Sign in' : 'Create account'}</a>
            </div>
            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#6f665b', lineHeight: 1.5 }}>
              By continuing you agree to our <a href="#" style={{ color: '#8a7f70' }}>Terms</a> and <a href="#" style={{ color: '#8a7f70' }}>Privacy Policy</a>.
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0', animation: 'fadeUp .3s ease' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(240,139,95,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <Ic name="mail" size={28} color="#f08b5f" />
            </div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 24, margin: '0 0 8px' }}>Check your inbox</h2>
            <p style={{ color: '#a3988a', fontSize: 14, lineHeight: 1.6, margin: '0 0 22px' }}>
              We sent a sign-in link to<br /><span style={{ color: '#f4eee5', fontWeight: 600 }}>{s.email}</span><br />It expires in 15 minutes.
            </p>
            <button onClick={() => app.go('dash')} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Open the link (prototype)</button>
            <div style={{ marginTop: 14 }}>
              <a href="#" onClick={e => { e.preventDefault(); app.patch({ authStep: 'form' }); }} style={{ fontSize: 13, color: '#8a7f70' }}>Use a different email</a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
