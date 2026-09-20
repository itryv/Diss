import { DCam, DExpand, DHangup, DMic, DMicOff } from '../dicons';
import { DISPLAY, sectionLabel, useDesktop } from '../shell';

const SHADOW = '0 24px 60px rgba(0,0,0,.6)';
const SPEAKING_RING = '0 0 0 2px #f08b5f, 0 0 26px rgba(240,139,95,.45)';

function HoverControl({ children, danger, onClick }: { children: React.ReactNode; danger?: boolean; onClick?: () => void }) {
  return (
    <span onClick={onClick} style={{
      position: 'relative', width: 32, height: 32, borderRadius: 10,
      background: danger ? '#c94a38' : 'rgba(36,31,26,.9)',
      border: danger ? 'none' : '1px solid #3a332b',
      display: 'grid', placeItems: 'center', cursor: 'pointer',
    }}>{children}</span>
  );
}

function Caption({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span style={{
      position: 'absolute', left: 9, bottom: 9, display: 'flex', alignItems: 'center', gap: 6,
      background: muted ? 'rgba(201,74,56,.18)' : 'rgba(14,12,10,.72)',
      border: muted ? '1px solid rgba(224,96,79,.32)' : undefined,
      backdropFilter: muted ? undefined : 'blur(8px)',
      borderRadius: 99, padding: '4px 10px', fontSize: 11.5, fontWeight: 600,
      color: muted ? '#e0836f' : undefined,
    }}>{children}</span>
  );
}

export function MiniWindow() {
  const { s, set, go } = useDesktop();
  return (
    <div style={{ width: 1120, maxWidth: '100%', animation: 'fadeUp .3s ease' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: -0.4, marginBottom: 6 }}>Floating mini window</div>
      <div style={{ color: '#a3988a', fontSize: 14, maxWidth: 620, lineHeight: 1.55, marginBottom: 32 }}>
        Always-on-top, frameless, magnetic corner snapping, remembers its corner. Controls fade in on hover exactly like the meeting bars. Double-click restores the meeting window.
      </div>

      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* S — hover reveals controls */}
        <div>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>S · 280×175 — hover</div>
          <div
            onMouseEnter={() => set({ miniHover: true })}
            onMouseLeave={() => set({ miniHover: false })}
            onDoubleClick={() => go('meeting')}
            style={{ width: 280, height: 175, borderRadius: 14, overflow: 'hidden', position: 'relative', background: 'linear-gradient(150deg,#2a2320,#14110f)', boxShadow: `${SPEAKING_RING}, ${SHADOW}`, cursor: 'grab' }}
          >
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 66, height: 66, borderRadius: '50%', background: '#5a7a6a', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>LB</span>
            </div>
            <Caption><DMic size={11} color="#6fbf8f" sw={2.4} />Leila</Caption>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg,rgba(10,8,7,.55),transparent 38%,transparent 55%,rgba(10,8,7,.6))',
              opacity: s.miniHover ? 1 : 0, transition: 'opacity .18s ease',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 11,
            }}>
              <div style={{ display: 'flex', gap: 7 }}>
                <HoverControl><DMic size={15} color="#f4eee5" sw={1.9} /></HoverControl>
                <HoverControl><DCam size={15} color="#f4eee5" sw={1.9} /></HoverControl>
                <HoverControl danger><DHangup size={15} color="#fff" /></HoverControl>
                <HoverControl onClick={() => go('meeting')}>
                  <DExpand size={15} color="#f4eee5" />
                  <span style={{ position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: '50%', background: '#f08b5f', border: '2px solid #14110f' }} />
                </HoverControl>
              </div>
            </div>
          </div>
          <div style={{ color: '#9a9084', fontSize: 12, marginTop: 10, maxWidth: 280, lineHeight: 1.5 }}>Speaking ring + unread-chat dot on expand.</div>
        </div>

        {/* M — 2-up with self view */}
        <div>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>M · 360×225 — 2-up</div>
          <div style={{ width: 360, height: 225, borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#0e0c0a', boxShadow: SHADOW, border: '1px solid #2a241e', display: 'flex', gap: 2 }}>
            <div style={{ flex: 2, background: 'linear-gradient(150deg,#2a2320,#14110f)', position: 'relative', display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 60, height: 60, borderRadius: '50%', background: '#5a7a6a', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 20, fontWeight: 700 }}>LB</span>
              <span style={{ position: 'absolute', left: 8, bottom: 8, background: 'rgba(14,12,10,.72)', borderRadius: 99, padding: '3px 9px', fontSize: 11, fontWeight: 600 }}>Leila</span>
            </div>
            <div style={{ flex: 1, background: 'linear-gradient(150deg,#2b2620,#141110)', position: 'relative', display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#8a5a44', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700 }}>AO</span>
              <span style={{ position: 'absolute', left: 8, bottom: 8, background: 'rgba(14,12,10,.72)', borderRadius: 99, padding: '3px 9px', fontSize: 10.5, fontWeight: 600 }}>You</span>
            </div>
          </div>
          <div style={{ color: '#9a9084', fontSize: 12, marginTop: 10, maxWidth: 360, lineHeight: 1.5 }}>Answering open question 2: self-view only at M and larger — at S it costs more than it tells you.</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>Camera off · muted</div>
            <div style={{ width: 280, height: 175, borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#0e0c0a', border: '1px solid #2a241e', boxShadow: SHADOW, display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 66, height: 66, borderRadius: '50%', background: '#7a5a7a', display: 'grid', placeItems: 'center', fontFamily: DISPLAY, fontSize: 22, fontWeight: 700 }}>PR</span>
              <Caption muted><DMicOff size={11} color="#e0836f" sw={2.2} />Priya</Caption>
            </div>
          </div>
          <div>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>Reconnecting · recording</div>
            <div style={{ width: 280, height: 175, borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#14110f', border: '1px solid #2a241e', boxShadow: SHADOW, display: 'grid', placeItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', border: '2.5px solid rgba(224,180,95,.25)', borderTopColor: '#e0b45f', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 12.5, color: '#e0b45f', fontWeight: 600 }}>Reconnecting…</span>
              </div>
              <span style={{ position: 'absolute', right: 9, top: 9, display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: '#e0836f' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c94a38', animation: 'recBlink 1.6s ease-in-out infinite' }} />REC
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
