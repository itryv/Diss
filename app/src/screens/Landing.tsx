import { useEffect, useState } from 'react';
import { useApp } from '../store';

const DESKTOP_VERSION = '1.0.1';
const MAC_ARM_DOWNLOAD = `/downloads/Diss-${DESKTOP_VERSION}-arm64.dmg`;
const MAC_INTEL_DOWNLOAD = `/downloads/Diss-${DESKTOP_VERSION}.dmg`;

export function Landing() {
  const app = useApp();
  const s = app.s;
  const ok = s.code.trim().length > 0;
  const join = () => app.openCode(s.code);
  const [recommendedMac, setRecommendedMac] = useState<'arm64' | 'x64'>('arm64');
  useEffect(() => {
    const ua = navigator as Navigator & {
      userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
    };
    void ua.userAgentData?.getHighEntropyValues?.(['architecture']).then(({ architecture }) => {
      if (/x86|x64/i.test(architecture || '')) setRecommendedMac('x64');
      else if (/arm/i.test(architecture || '')) setRecommendedMac('arm64');
    }).catch(() => undefined);
  }, []);
  return (
    <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'radial-gradient(1000px 600px at 70% -10%, rgba(240,139,95,.10), transparent 60%), #151210' }}>
      {/* max(): --titlebar is the macOS traffic-light strip in the packaged app, 0px on the web. */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'max(22px, var(--titlebar)) 48px 22px' }}>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          diss<span style={{ color: '#f08b5f', fontSize: 30, lineHeight: 0.6 }}>.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <a className="hv-fg" href="#desktop-app" style={{ color: '#c9beb0', fontSize: 15, fontWeight: 500, textDecoration: 'none', padding: '10px 14px' }}>Desktop app</a>
          <button className="hv-fg" onClick={() => app.go('auth', { authMode: 'signin', authError: null })} style={{ background: 'none', border: 'none', color: '#c9beb0', fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '10px 14px' }}>Sign in</button>
          <button className="hv-primary" onClick={() => app.go('auth', { authMode: 'signup', authError: null })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '11px 20px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Sign up free</button>
        </div>
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px 80px' }}>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 72, lineHeight: 1.02, letterSpacing: -2, margin: '0 0 20px', maxWidth: 820, textWrap: 'pretty' }}>Click the link.<br />You're in.</h1>
        <p style={{ fontSize: 19, color: '#a3988a', maxWidth: 520, margin: '0 0 36px', lineHeight: 1.55, textWrap: 'pretty' }}>Video meetings that start in seconds. No downloads, no sign-up for guests, no drama.</p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="hv-primary" onClick={() => s.user ? app.createInstantMeeting(true) : app.go('auth', { authMode: 'signup', authError: null })} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 14, padding: '16px 28px', fontWeight: 700, fontSize: 17, cursor: 'pointer', boxShadow: '0 8px 30px rgba(240,139,95,.25)' }}>Start a meeting</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#1e1a16', border: '1px solid #362f28', borderRadius: 14, padding: '6px 6px 6px 16px' }}>
            <input value={s.code} onChange={e => app.patch({ code: e.target.value, codeInvalid: false })} placeholder="Enter a code or link" style={{ background: 'none', border: 'none', outline: 'none', color: '#f4eee5', fontSize: 16, fontFamily: 'inherit', width: 210 }} />
            <button onClick={join} disabled={!ok && s.code.length === 0} style={{ background: ok ? '#f08b5f' : '#2e2822', color: ok ? '#241209' : '#9a9084', border: 'none', borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Join</button>
          </div>
        </div>
        {s.codeInvalid && (
          <div style={{ marginTop: 14, color: '#e0836f', fontSize: 14 }}>
            We couldn't find that meeting — check the code and try again. Codes look like <span style={{ fontWeight: 600 }}>abc-defg-hij</span>.
          </div>
        )}
        <div id="desktop-app" style={{ marginTop: 64, width: 'min(680px, 100%)', border: '1px solid #362f28', borderRadius: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(240,139,95,.09), rgba(30,26,22,.8))' }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 750, fontSize: 23, marginBottom: 7 }}>Diss for Mac</div>
          <div style={{ color: '#a3988a', fontSize: 14.5, lineHeight: 1.55, maxWidth: 540, margin: '0 auto 18px' }}>
            Native screen and computer-audio sharing, global mute shortcuts, a menu-bar panel, and a floating meeting window. Requires macOS 13 or later.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={MAC_ARM_DOWNLOAD} download style={{ background: recommendedMac === 'arm64' ? '#f08b5f' : '#241f1a', border: recommendedMac === 'arm64' ? '1px solid transparent' : '1px solid #4a4036', color: recommendedMac === 'arm64' ? '#241209' : '#f4eee5', borderRadius: 11, padding: '11px 18px', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Apple Silicon{recommendedMac === 'arm64' ? ' — Recommended' : ''}</a>
            <a href={MAC_INTEL_DOWNLOAD} download style={{ background: recommendedMac === 'x64' ? '#f08b5f' : '#241f1a', border: recommendedMac === 'x64' ? '1px solid transparent' : '1px solid #4a4036', color: recommendedMac === 'x64' ? '#241209' : '#f4eee5', borderRadius: 11, padding: '11px 18px', fontWeight: 650, fontSize: 14, textDecoration: 'none' }}>Intel{recommendedMac === 'x64' ? ' — Recommended' : ''}</a>
          </div>
          <div style={{ color: '#756b60', fontSize: 11.5, lineHeight: 1.45, marginTop: 14 }}>
            Preview release v{DESKTOP_VERSION}. It is not yet Apple-notarized, so macOS may ask you to confirm the first launch in Privacy &amp; Security.
          </div>
        </div>
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
      <footer style={{ padding: '20px 48px', color: '#9a9084', fontSize: 13, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #241f1a' }}>
        <span>© 2026 Diss</span>
        <span style={{ display: 'flex', gap: 18 }}><a href="#" style={{ color: '#9a9084' }}>Privacy</a><a href="#" style={{ color: '#9a9084' }}>Terms</a></span>
      </footer>
    </section>
  );
}
