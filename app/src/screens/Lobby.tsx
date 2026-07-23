import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../store';
import type { PermState } from '../store';
import { Ic } from '../icons';
import { initialsOf } from '../util';

const centered: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center', padding: 32 };
const primaryBtn: React.CSSProperties = { background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '13px 26px', fontWeight: 700, fontSize: 15, cursor: 'pointer' };
const selectStyle: React.CSSProperties = { width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 11, padding: '11px 12px', color: '#c9beb0', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' };

export function AvControlButton({ kind, size = 48 }: { kind: 'mic' | 'cam'; size?: number }) {
  const app = useApp();
  const s = app.s;
  const on = kind === 'mic' ? s.lobbyMic : s.lobbyCam;
  const icon = kind === 'mic' ? (on ? 'mic' : 'micOff') : on ? 'video' : 'videoOff';
  const title = kind === 'mic' ? (on ? 'Mute' : 'Unmute') : on ? 'Turn camera off' : 'Turn camera on';
  const toggle = () => app.patch(st => (kind === 'mic' ? { lobbyMic: !st.lobbyMic } : { lobbyCam: !st.lobbyCam }));
  return (
    <button onClick={toggle} title={title} style={{ width: size, height: size, borderRadius: '50%', background: on ? 'rgba(30,26,22,.8)' : 'rgba(201,74,56,.9)', border: `1px solid ${on ? '#3a332b' : '#c94a38'}`, color: '#f4eee5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Ic name={icon} size={18} />
    </button>
  );
}

function MicMeter() {
  const app = useApp();
  const s = app.s;
  const bars = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    color: i < 12 ? '#6fbf8f' : '#f0b45f',
    dur: `${0.5 + ((i * 37) % 10) / 14}s`,
    delay: `${((i * 53) % 10) / 12}s`,
  })), []);
  const playing = s.lobbyMic && s.permState === 'granted';
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 26, background: '#1c1815', border: '1px solid #2e2822', borderRadius: 10, padding: '5px 10px' }}>
      {bars.map((b, i) => (
        <span key={i} style={{ flex: 1, height: '100%', background: b.color, borderRadius: 2, transformOrigin: 'bottom', animation: `meterA ${b.dur} ease-in-out infinite`, animationDelay: b.delay, animationPlayState: playing ? 'running' : 'paused' }} />
      ))}
    </div>
  );
}

export function Lobby() {
  const app = useApp();
  const s = app.s;
  const videoRef = useRef<HTMLVideoElement>(null);
  const initials = initialsOf(s.lobbyName);
  const isHost = s.role === 'host';

  useEffect(() => {
    if (videoRef.current && app.streamRef.current && videoRef.current.srcObject !== app.streamRef.current) {
      videoRef.current.srcObject = app.streamRef.current;
    }
  });

  const permChips: [PermState, string][] = [['prompt', 'ask'], ['granted', 'granted'], ['denied', 'denied'], ['nodevice', 'no camera'], ['busy', 'camera busy']];

  return (
    <section style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 36, flexWrap: 'wrap' }}>
      <div style={{ width: 'min(58vw,760px)', minWidth: 420 }}>
        <div style={{ position: 'relative', aspectRatio: '16/10', background: '#0e0c0a', borderRadius: 22, overflow: 'hidden', border: '1px solid #2e2822' }}>
          {s.permState === 'prompt' && (
            <div style={centered}>
              <div style={{ display: 'flex' }}><Ic name="video" size={36} /></div>
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20 }}>We need access to your camera and mic</div>
              <div style={{ color: '#a3988a', fontSize: 14, maxWidth: 360, lineHeight: 1.5 }}>So people can see and hear you. You can turn either off any time.</div>
              <button className="hv-primary" onClick={app.allowAccess} style={{ ...primaryBtn, marginTop: 6 }}>Allow access</button>
            </div>
          )}
          {s.permState === 'denied' && (
            <div style={centered}>
              <div style={{ display: 'flex' }}><Ic name="lock" size={34} /></div>
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20 }}>Your browser blocked the camera and mic</div>
              <div style={{ color: '#a3988a', fontSize: 14, maxWidth: 400, lineHeight: 1.6 }}>
                Click the <span style={{ background: '#2a241e', borderRadius: 6, padding: '2px 8px', fontWeight: 600, color: '#f4eee5' }}><Ic name="videoOff" size={15} style={{ verticalAlign: -2 }} /></span> icon in the address bar, choose <span style={{ color: '#f4eee5', fontWeight: 600 }}>Allow</span>, then reload. No luck? You can still join to watch and listen.
              </div>
              <button className="hv-bg-2a" onClick={() => { app.patch({ lobbyMic: false, lobbyCam: false }); app.proceedJoin(); }} style={{ background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 12, padding: '12px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 4 }}>Join without camera or mic</button>
            </div>
          )}
          {s.permState === 'nodevice' && (
            <div style={centered}>
              <div style={{ width: 88, height: 88, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 30 }}>{initials}</div>
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 19 }}>No camera detected</div>
              <div style={{ color: '#a3988a', fontSize: 14, maxWidth: 360, lineHeight: 1.5 }}>You'll show up as your initials — totally fine. Plug one in any time and we'll pick it up.</div>
            </div>
          )}
          {s.permState === 'busy' && (
            <div style={centered}>
              <div style={{ display: 'flex' }}><Ic name="camera" size={36} /></div>
              <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 20 }}>Another app is using your camera</div>
              <div style={{ color: '#a3988a', fontSize: 14, maxWidth: 380, lineHeight: 1.5 }}>Close the other app (often Zoom, FaceTime, or OBS) and try again.</div>
              <button className="hv-primary" onClick={() => app.patch({ permState: 'granted', realCam: false })} style={primaryBtn}>Try again</button>
            </div>
          )}
          {s.permState === 'granted' && (
            <>
              {s.lobbyCam ? (
                s.realCam ? (
                  <video ref={videoRef} autoPlay muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                ) : (
                  <>
                    <img src="https://i.pravatar.cc/900?img=47" alt="Camera preview placeholder" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', filter: 'saturate(.9)' }} />
                    <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(14,12,10,.6)', borderRadius: 99, padding: '5px 12px', fontSize: 11.5, color: '#a3988a', fontFamily: 'monospace' }}>simulated camera preview</div>
                  </>
                )
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141110' }}>
                  <div style={{ width: 96, height: 96, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 32 }}>{initials}</div>
                </div>
              )}
              <div style={{ position: 'absolute', left: 14, bottom: 14, background: 'rgba(14,12,10,.65)', backdropFilter: 'blur(6px)', borderRadius: 99, padding: '6px 14px', fontSize: 13, fontWeight: 600 }}>{s.lobbyName || 'You'}</div>
              <div style={{ position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', display: 'flex', gap: 10 }}>
                <AvControlButton kind="mic" />
                <AvControlButton kind="cam" />
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: '#6f665b', fontFamily: 'monospace' }}>demo the permission states:</span>
          {permChips.map(([k, label]) => (
            <button key={k} onClick={() => app.patch(st => ({ permState: k, realCam: k === 'granted' ? st.realCam : false }))} style={{ background: s.permState === k ? '#2e2822' : 'none', border: `1px solid ${s.permState === k ? '#4a4238' : '#2e2822'}`, color: s.permState === k ? '#f0a97f' : '#6f665b', borderRadius: 99, padding: '5px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 24 }}>Weekly team sync</div>
          <div style={{ color: '#a3988a', fontSize: 14, marginTop: 3 }}>hosted by {isHost ? 'you' : 'Amara Okafor'}</div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#a3988a', marginBottom: 7 }}>Your name</label>
          <input value={s.lobbyName} onChange={e => app.patch({ lobbyName: e.target.value })} placeholder="How should we introduce you?" style={{ width: '100%', background: '#1c1815', border: '1px solid #3a332b', borderRadius: 12, padding: '13px 14px', color: '#f4eee5', fontSize: 15, fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <select style={selectStyle}><option>MacBook Pro Microphone</option><option>AirPods Pro</option></select>
          <select style={selectStyle}><option>FaceTime HD Camera</option></select>
          <select style={selectStyle}><option>MacBook Pro Speakers</option><option>AirPods Pro</option></select>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#a3988a' }}>Speak to test your mic</span>
            <a href="#" onClick={e => { e.preventDefault(); app.patch({ speakerTesting: true }); window.setTimeout(() => app.patch({ speakerTesting: false }), 1500); }} style={{ fontSize: 12.5 }}>{s.speakerTesting ? 'Playing…' : 'Test speaker'}</a>
          </div>
          <MicMeter />
        </div>
        <button className="hv-primary" onClick={app.proceedJoin} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 14, padding: 16, fontWeight: 700, fontSize: 16.5, cursor: 'pointer', boxShadow: '0 8px 30px rgba(240,139,95,.2)' }}>
          {!isHost && s.waitingRoom ? 'Ask to join' : 'Join now'}
        </button>
        <button className="hv-fg" onClick={() => app.go('landing')} style={{ background: 'none', border: 'none', color: '#8a7f70', fontSize: 13.5, cursor: 'pointer' }}>Cancel</button>
      </div>
    </section>
  );
}

export function Waiting() {
  const app = useApp();
  const s = app.s;
  const initials = initialsOf(s.lobbyName);
  return (
    <section style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center', padding: 32 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 0.3, 0.6].map(d => (
          <span key={d} style={{ width: 10, height: 10, borderRadius: '50%', background: '#f08b5f', animation: `breathe 1.8s ease-in-out ${d}s infinite` }} />
        ))}
      </div>
      <div>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 30, margin: '0 0 8px' }}>Weekly team sync</h1>
        <p style={{ color: '#a3988a', fontSize: 15.5, margin: 0 }}>Amara will let you in soon. Sit tight — you look great, by the way.</p>
      </div>
      <div style={{ position: 'relative', width: 220, aspectRatio: '16/10', background: '#0e0c0a', borderRadius: 14, overflow: 'hidden', border: '1px solid #2e2822' }}>
        {s.lobbyCam ? (
          <img src="https://i.pravatar.cc/400?img=47" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 17, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{initials}</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <AvControlButton kind="mic" size={44} />
        <AvControlButton kind="cam" size={44} />
        <button className="hv-fg" onClick={() => app.go('landing')} style={{ height: 44, borderRadius: 99, background: 'none', border: '1px solid #3a332b', color: '#c9beb0', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', padding: '0 18px' }}>Leave</button>
      </div>
    </section>
  );
}
