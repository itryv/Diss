import { WindowFrame } from '../chrome';
import { DCam, DChat, DMic, DPip, DShare } from '../dicons';
import { DISPLAY, useDesktop } from '../shell';

function CtrlButton({ children, onClick, title, wide }: { children: React.ReactNode; onClick?: () => void; title?: string; wide?: boolean }) {
  return (
    <button
      className="hv-bg-2e"
      onClick={onClick}
      title={title}
      style={{
        display: wide ? 'flex' : 'grid', placeItems: wide ? undefined : 'center',
        alignItems: wide ? 'center' : undefined, gap: wide ? 9 : undefined,
        width: wide ? undefined : 46, height: 46, padding: wide ? '0 18px' : undefined,
        borderRadius: 14, background: '#241f1a', border: '1px solid #362f28',
        color: '#f4eee5', cursor: 'pointer', fontSize: 14, fontWeight: 600,
      }}
    >{children}</button>
  );
}

function StripTile({ label, gradient }: { label: string; gradient: string }) {
  return (
    <div style={{ flex: 1, borderRadius: 12, background: gradient, position: 'relative' }}>
      <span style={{ position: 'absolute', left: 10, bottom: 8, fontSize: 11.5, fontWeight: 600, color: '#d6cec2' }}>{label}</span>
    </div>
  );
}

export function MeetingWindow() {
  const { s, set, go } = useDesktop();
  return (
    <WindowFrame
      title="Weekly team sync"
      dot
      background="#0e0c0a"
      barBg="rgba(20,17,14,.9)"
      borderBg="#1e1a16"
      onClose={() => set({ closeToast: true })}
      style={{ boxShadow: '0 40px 120px rgba(0,0,0,.7)', position: 'relative' }}
    >
      <div style={{ height: 600, background: '#0e0c0a', display: 'flex', flexDirection: 'column', padding: 16, gap: 12, position: 'relative' }}>
        {/* Active speaker — the glow ring is the same speaking treatment as the web tiles. */}
        <div style={{ flex: 1, borderRadius: 14, background: 'linear-gradient(150deg,#2a2320,#14110f)', position: 'relative', overflow: 'hidden', animation: 'glowPulse 2.6s ease-in-out infinite' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span style={{ width: 112, height: 112, borderRadius: '50%', background: '#5a7a6a', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 38, fontWeight: 700 }}>LB</span>
          </div>
          <div style={{ position: 'absolute', left: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(14,12,10,.72)', backdropFilter: 'blur(8px)', borderRadius: 99, padding: '6px 13px', fontSize: 13, fontWeight: 600 }}>
            <DMic size={13} color="#6fbf8f" sw={2.2} />Leila Boum
          </div>
          <div style={{ position: 'absolute', right: 14, top: 14, display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(201,74,56,.16)', border: '1px solid rgba(224,96,79,.35)', borderRadius: 99, padding: '5px 11px', fontSize: 11.5, fontWeight: 700, color: '#e0836f' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c94a38', animation: 'recBlink 1.6s ease-in-out infinite' }} />REC
          </div>
        </div>

        <div style={{ height: 104, display: 'flex', gap: 12 }}>
          <StripTile label="Amara (you)" gradient="linear-gradient(150deg,#2b2620,#141110)" />
          <StripTile label="Priya R." gradient="linear-gradient(150deg,#26242c,#141110)" />
          <StripTile label="Tom N." gradient="linear-gradient(150deg,#242a2c,#141110)" />
          <div style={{ flex: 1, borderRadius: 12, background: '#161311', display: 'grid', placeItems: 'center', color: '#8a7f70', fontSize: 13, fontWeight: 600 }}>+6</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 2 }}>
          <CtrlButton><DMic size={19} /></CtrlButton>
          <CtrlButton><DCam size={19} /></CtrlButton>
          <CtrlButton wide onClick={() => go('share')}><DShare size={19} />Share</CtrlButton>
          <CtrlButton><DChat size={19} /></CtrlButton>
          <CtrlButton onClick={() => go('mini')} title="Collapse to mini window"><DPip size={19} /></CtrlButton>
          <button className="hv-danger" style={{ height: 46, padding: '0 22px', borderRadius: 14, background: '#c94a38', border: 'none', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', marginLeft: 8 }}>Leave</button>
        </div>

        {/* Closing the window shrinks to the mini window rather than dropping the call. */}
        {s.closeToast && (
          <div style={{ position: 'absolute', left: '50%', bottom: 88, transform: 'translateX(-50%)', background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.6)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, animation: 'fadeUp .25s ease', maxWidth: 520 }}>
            <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, background: 'rgba(240,139,95,.14)', display: 'grid', placeItems: 'center' }}>
              <DPip size={17} color="#f08b5f" />
            </span>
            <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45 }}>
              Closing the window keeps you in the meeting — it shrinks to the mini window. <span style={{ color: '#a3988a' }}>You can change this in Settings → Desktop.</span>
            </div>
            <button onClick={() => go('mini')} style={{ background: '#2e2822', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 10, padding: '8px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Got it</button>
            <button onClick={() => set({ closeToast: false })} style={{ background: 'none', border: 'none', color: '#e0836f', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Leave instead</button>
          </div>
        )}
      </div>
    </WindowFrame>
  );
}
