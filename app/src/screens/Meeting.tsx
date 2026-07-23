import { useEffect, useRef } from 'react';
import { useApp } from '../store';
import { useTiles } from '../tiles';
import type { Tile } from '../tiles';
import { Ic, Lbl } from '../icons';
import type { IconName } from '../icons';
import { fmtElapsed, initialsOf } from '../util';

const ctrlBtn: React.CSSProperties = { height: 50, minWidth: 58, borderRadius: 14, border: '1px solid #2e2822', color: '#f4eee5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 };

function SelfVideo({ style }: { style: React.CSSProperties }) {
  const app = useApp();
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && app.streamRef.current && ref.current.srcObject !== app.streamRef.current) {
      ref.current.srcObject = app.streamRef.current;
    }
  });
  if (app.s.realCam && app.streamRef.current) {
    return <video ref={ref} autoPlay muted playsInline style={{ ...style, transform: 'scaleX(-1)' }} />;
  }
  return <img src="https://i.pravatar.cc/420?img=47" alt="" style={{ ...style, transform: 'scaleX(-1)' }} />;
}

function TileMedia({ tile, big }: { tile: Tile; big?: boolean }) {
  const fill: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };
  if (!tile.camOn) {
    const size = big ? 110 : 64;
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#17130f' }}>
        <div style={{ width: size, height: size, borderRadius: '50%', background: tile.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: big ? 38 : 22 }}>{tile.initials}</div>
      </div>
    );
  }
  if (tile.you) return <SelfVideo style={fill} />;
  return <img src={big ? tile.imgBig : tile.img} alt="" style={fill} />;
}

function MutedBadge() {
  return (
    <span style={{ position: 'absolute', right: 10, bottom: 10, width: 26, height: 26, borderRadius: '50%', background: 'rgba(224,96,79,.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Ic name="micOff" size={14} color="#fff" />
    </span>
  );
}

function HandBadge({ q }: { q: string }) {
  return (
    <span style={{ position: 'absolute', left: 10, top: 10, background: 'rgba(240,180,95,.92)', color: '#241209', borderRadius: 8, padding: '4px 9px', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
      <Ic name="hand" size={13} /> {q}
    </span>
  );
}

function GridView() {
  const { tiles, gridCols } = useTiles();
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: `repeat(${gridCols},1fr)`, gridAutoRows: '1fr', gap: 10 }}>
      {tiles.map(p => (
        <div key={p.key} className="tile" style={{ position: 'relative', background: '#17130f', borderRadius: 16, overflow: 'hidden', minHeight: 0, boxShadow: p.ring, transition: 'box-shadow .3s' }}>
          <TileMedia tile={p} />
          <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 6, maxWidth: '75%' }}>
            <span style={{ background: 'rgba(14,12,10,.65)', backdropFilter: 'blur(4px)', borderRadius: 8, padding: '4px 10px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</span>
            {p.badge && <span style={{ background: 'rgba(240,139,95,.2)', color: '#f0a97f', borderRadius: 6, padding: '3px 7px', fontSize: 10.5, fontWeight: 700 }}>{p.badge}</span>}
          </div>
          {p.muted && <MutedBadge />}
          {p.hand && <HandBadge q={p.handQ} />}
          <div className="hv-reveal" style={{ position: 'absolute', right: 8, top: 8 }}>
            <button onClick={p.pinToggle} title="Pin" style={{ background: 'rgba(14,12,10,.7)', border: 'none', color: '#f4eee5', borderRadius: 8, padding: '6px 9px', fontSize: 12, cursor: 'pointer' }}>
              {p.pinned ? <Lbl name="pin" text="Unpin" size={13} /> : <Ic name="pin" size={13} />}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SpeakerView() {
  const app = useApp();
  const s = app.s;
  const { mainTile, strip, stripOverflow } = useTiles();
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexShrink: 0 }}>
        {strip.map(p => (
          <div key={p.key} onClick={p.pinToggle} style={{ position: 'relative', width: 128, aspectRatio: '16/10', background: '#17130f', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', boxShadow: p.ring, flexShrink: 0 }}>
            {p.camOn ? (
              p.you ? <SelfVideo style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={p.img} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{p.initials}</div>
              </div>
            )}
            <span style={{ position: 'absolute', left: 6, bottom: 6, background: 'rgba(14,12,10,.65)', borderRadius: 6, padding: '2px 7px', fontSize: 10.5, fontWeight: 600, maxWidth: '85%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.short}</span>
          </div>
        ))}
        {stripOverflow && (
          <div style={{ width: 64, aspectRatio: '16/10', background: '#1e1a16', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a7f70', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{stripOverflow}</div>
        )}
      </div>
      <div style={{ flex: 1, position: 'relative', background: '#17130f', borderRadius: 18, overflow: 'hidden', minHeight: 0, boxShadow: mainTile.ring }}>
        <TileMedia tile={mainTile} big />
        <div style={{ position: 'absolute', left: 14, bottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: 'rgba(14,12,10,.65)', backdropFilter: 'blur(4px)', borderRadius: 9, padding: '6px 13px', fontSize: 14, fontWeight: 600 }}>{mainTile.label}</span>
          {mainTile.badge && <span style={{ background: 'rgba(240,139,95,.2)', color: '#f0a97f', borderRadius: 7, padding: '4px 9px', fontSize: 11, fontWeight: 700 }}>{mainTile.badge}</span>}
        </div>
        {!s.selfCollapsed ? (
          <div style={{ position: 'absolute', right: 14, bottom: 14, width: 170, aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', border: '1px solid #2e2822', background: '#17130f' }}>
            {!s.camOff ? (
              <SelfVideo style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{initialsOf(s.lobbyName)}</div>
              </div>
            )}
            <button className="hv-fg" onClick={() => app.patch(st => ({ selfCollapsed: !st.selfCollapsed }))} style={{ position: 'absolute', right: 6, top: 6, background: 'rgba(14,12,10,.7)', border: 'none', color: '#a3988a', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>—</button>
          </div>
        ) : (
          <button className="hv-fg" onClick={() => app.patch(st => ({ selfCollapsed: !st.selfCollapsed }))} style={{ position: 'absolute', right: 14, bottom: 14, background: 'rgba(30,26,22,.9)', border: '1px solid #362f28', color: '#c9beb0', borderRadius: 99, padding: '8px 15px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Show self view</button>
        )}
      </div>
    </div>
  );
}

function SidePanel() {
  const app = useApp();
  const s = app.s;
  const { tiles } = useTiles();
  const isHost = s.role === 'host';
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [s.messages.length]);
  return (
    <div style={{ width: 340, flexShrink: 0, background: '#1a1613', border: '1px solid #2a241e', borderRadius: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'fadeUp .25s ease' }}>
      <div style={{ display: 'flex', padding: '10px 10px 0', gap: 4 }}>
        <button onClick={() => app.patch({ tab: 'chat', unread: 0 })} style={{ flex: 1, background: s.tab === 'chat' ? '#2a241e' : 'none', color: s.tab === 'chat' ? '#f4eee5' : '#8a7f70', border: 'none', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Chat</button>
        <button onClick={() => app.patch({ tab: 'people' })} style={{ flex: 1, background: s.tab === 'people' ? '#2a241e' : 'none', color: s.tab === 'people' ? '#f4eee5' : '#8a7f70', border: 'none', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>People · {tiles.length}</button>
        <button className="hv-fg" onClick={() => app.patch({ panel: false })} style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', padding: '0 10px' }}><Ic name="close" size={15} /></button>
      </div>
      {s.tab === 'chat' ? (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ textAlign: 'center', color: '#6f665b', fontSize: 11.5, padding: '4px 0' }}>Messages disappear when the meeting ends</div>
            {s.messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
                <div style={{ fontSize: 11.5, color: '#8a7f70', fontWeight: 600 }}>{m.who}</div>
                <div style={{ background: m.mine ? '#f08b5f' : '#241f1a', color: m.mine ? '#241209' : '#f4eee5', borderRadius: 14, padding: '9px 13px', fontSize: 13.5, lineHeight: 1.45, maxWidth: '85%' }}>{m.text}</div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #2a241e', display: 'flex', gap: 8 }}>
            <input
              value={s.chatInput}
              onChange={e => app.patch({ chatInput: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') app.sendChat(); }}
              placeholder="Message everyone…"
              style={{ flex: 1, background: '#1c1815', border: '1px solid #3a332b', borderRadius: 11, padding: '11px 13px', color: '#f4eee5', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }}
            />
            <button onClick={app.sendChat} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: '0 16px', fontWeight: 700, cursor: 'pointer' }}><Ic name="send" size={16} /></button>
          </div>
        </>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
            {s.waitingGuest && isHost && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#f0a97f', marginBottom: 8 }}>Waiting room · 1</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(240,139,95,.08)', border: '1px solid rgba(240,139,95,.25)', borderRadius: 12, padding: '10px 12px' }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#5a8a5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, fontFamily: "'Bricolage Grotesque',sans-serif" }}>LB</span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Leila Boum</span>
                  <button onClick={() => { app.patch({ waitingGuest: false, admitted: true, toasts: [] }); app.toast('Leila Boum joined'); }} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 8, padding: '7px 13px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Admit</button>
                  <button onClick={() => app.patch({ waitingGuest: false, toasts: [] })} style={{ background: 'none', border: '1px solid #3a332b', color: '#a3988a', borderRadius: 8, padding: '7px 11px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Deny</button>
                </div>
              </div>
            )}
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a7f70', marginBottom: 8 }}>In meeting · {tiles.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tiles.map(p => (
                <div key={p.key} className="hv-bg-21" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderRadius: 10 }}>
                  <img src={p.imgSm} alt="" style={{ width: 30, height: 30, borderRadius: '50%', background: p.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>
                    {p.badge && <div style={{ fontSize: 10.5, color: '#f0a97f', fontWeight: 700 }}>{p.badge}</div>}
                  </div>
                  <span style={{ color: p.muted ? '#e0836f' : '#6fbf8f' }}><Ic name={p.muted ? 'micOff' : 'mic'} size={14} /></span>
                  {isHost && (
                    <button className="hv-fg" onClick={p.hostMute} title="Host actions" style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', padding: 3 }}><Ic name="more" size={18} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {isHost && (
            <div style={{ padding: 12, borderTop: '1px solid #2a241e', display: 'flex', gap: 8 }}>
              <button className="hv-bg-2a" onClick={() => { app.patch({ mutedAll: true }); app.toast('Everyone is muted — they can unmute themselves'); }} style={{ flex: 1, background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Mute all</button>
              <button onClick={() => { const l = !s.locked; app.patch({ locked: l }); app.toast(l ? 'Meeting locked — no one else can join' : 'Meeting unlocked'); }} style={{ flex: 1, background: s.locked ? 'rgba(240,139,95,.15)' : '#241f1a', border: `1px solid ${s.locked ? 'rgba(240,139,95,.4)' : '#362f28'}`, color: s.locked ? '#f0a97f' : '#f4eee5', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>
                {s.locked ? <Lbl name="lock" text="Locked" /> : 'Lock meeting'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ControlBar() {
  const app = useApp();
  const s = app.s;
  const { tiles, handsAhead } = useTiles();
  const isHost = s.role === 'host';
  const emojis: IconName[] = ['thumbsUp', 'heart', 'laugh', 'party', 'clap'];

  const sendBurst = (name: IconName) => {
    const id = Math.random();
    app.patch(st => ({ bursts: [...st.bursts, { id, name, x: `${35 + Math.random() * 30}%` }], reactionsOpen: false }));
    window.setTimeout(() => app.patch(st => ({ bursts: st.bursts.filter(b => b.id !== id) })), 3600);
  };

  const moreItems: { label: React.ReactNode; color: string; go: () => void }[] = [
    ...(isHost ? [{
      label: s.recording ? <Lbl name="square" text="Stop recording" /> : <Lbl name="record" text="Start recording" />,
      color: '#f4eee5', go: app.toggleRec,
    }] : []),
    { label: <Lbl name="keyboard" text="Keyboard shortcuts" />, color: '#f4eee5', go: () => app.patch({ shortcutsOpen: true, moreOpen: false }) },
    { label: <Lbl name="fullscreen" text="Fullscreen" />, color: '#f4eee5', go: () => { app.patch({ moreOpen: false }); document.documentElement.requestFullscreen?.().catch(() => {}); } },
    { label: <Lbl name="wifiOff" text="Demo: connection drop" />, color: '#e0b45f', go: app.demoReconnect },
    { label: <Lbl name="flag" text="Report a problem" />, color: '#f4eee5', go: () => { app.patch({ moreOpen: false }); app.toast('Thanks — our team takes a look at every report'); } },
  ];

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 20px 18px', zIndex: 20, background: 'linear-gradient(transparent,rgba(14,12,10,.9))', opacity: s.bars ? 1 : 0, transition: 'opacity .4s', pointerEvents: s.bars ? 'auto' : 'none' }}>
      <button onClick={app.toggleMic} title="Mute (M)" style={{ ...ctrlBtn, background: s.micMuted ? 'rgba(201,74,56,.85)' : '#1e1a16', borderColor: s.micMuted ? '#c94a38' : '#2e2822' }}>
        <Ic name={s.micMuted ? 'micOff' : 'mic'} size={20} />
        <span style={{ color: '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
      </button>
      <button onClick={app.toggleCam} title="Camera (V)" style={{ ...ctrlBtn, background: s.camOff ? 'rgba(201,74,56,.85)' : '#1e1a16', borderColor: s.camOff ? '#c94a38' : '#2e2822' }}>
        <Ic name={s.camOff ? 'videoOff' : 'video'} size={20} />
        <span style={{ color: '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
      </button>
      <button
        onClick={() => { app.patch(st => ({ sharing: !st.sharing })); if (!s.sharing) app.toast('You started sharing — everyone sees your screen'); }}
        title="Share screen"
        style={{ ...ctrlBtn, background: s.sharing ? 'rgba(111,191,143,.2)' : '#1e1a16', borderColor: s.sharing ? 'rgba(111,191,143,.5)' : '#2e2822', color: s.sharing ? '#6fbf8f' : '#f4eee5' }}
      >
        <Ic name="share" size={20} />
      </button>
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.patch(st => ({ reactionsOpen: !st.reactionsOpen, moreOpen: false, leaveOpen: false }))} title="Reactions" style={{ ...ctrlBtn, background: s.reactionsOpen || s.hand ? '#2e2822' : '#1e1a16' }}>
          <Ic name="hand" size={18} />
        </button>
        {s.reactionsOpen && (
          <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            <button
              onClick={() => { const h = !s.hand; app.patch({ hand: h, reactionsOpen: false }); if (h) app.toast(`Your hand is up — you're #${handsAhead + 1} in line`); }}
              style={{ background: s.hand ? 'rgba(240,180,95,.2)' : '#2a241e', border: `1px solid ${s.hand ? 'rgba(240,180,95,.5)' : '#3a332b'}`, color: '#f4eee5', borderRadius: 10, padding: '9px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <Lbl name="hand" text={s.hand ? 'Lower hand' : 'Raise hand'} size={15} />
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              {emojis.map(e => (
                <button key={e} className="hv-bg-2e" onClick={() => sendBurst(e)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: '#f4eee5' }}><Ic name={e} size={22} /></button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.togglePanel('chat')} title="Chat (C)" style={{ ...ctrlBtn, background: s.panel && s.tab === 'chat' ? '#2e2822' : '#1e1a16' }}><Ic name="chat" size={18} /></button>
        {s.unread > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, background: '#f08b5f', color: '#241209', fontSize: 11, fontWeight: 800, borderRadius: 99, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{s.unread}</span>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.togglePanel('people')} title="People (P)" style={{ ...ctrlBtn, background: s.panel && s.tab === 'people' ? '#2e2822' : '#1e1a16', animation: s.waitingGuest && isHost ? 'badgePulse 1.6s infinite' : 'none' }}><Ic name="users" size={18} /></button>
        <span style={{ position: 'absolute', top: -5, right: -5, background: '#2e2822', color: '#c9beb0', fontSize: 11, fontWeight: 700, borderRadius: 99, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{tiles.length}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.patch(st => ({ moreOpen: !st.moreOpen, reactionsOpen: false, leaveOpen: false }))} title="More" style={{ ...ctrlBtn, background: s.moreOpen ? '#2e2822' : '#1e1a16' }}><Ic name="more" size={18} /></button>
        {s.moreOpen && (
          <div style={{ position: 'absolute', bottom: 60, right: 0, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, minWidth: 230, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            {moreItems.map((item, i) => (
              <button key={i} className="hv-bg-2e" onClick={item.go} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: item.color, padding: '10px 13px', fontSize: 13.5, fontWeight: 500, borderRadius: 9, cursor: 'pointer' }}>{item.label}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ width: 22 }} />
      <div style={{ position: 'relative' }}>
        <button className="hv-danger" onClick={() => app.patch(st => ({ leaveOpen: !st.leaveOpen, moreOpen: false, reactionsOpen: false }))} style={{ height: 50, borderRadius: 14, background: '#c94a38', border: 'none', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', padding: '0 24px' }}>Leave</button>
        {s.leaveOpen && (
          <div style={{ position: 'absolute', bottom: 60, right: 0, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, padding: 16, width: 260, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            {isHost ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Heading out?</div>
                <div style={{ color: '#a3988a', fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>You're the host — pick someone to hand the keys to, or end it for everyone.</div>
                <button className="hv-bg-33" onClick={() => { app.toast('Amara Okafor is the host now'); window.setTimeout(() => app.leaveMeeting('left'), 700); }} style={{ display: 'block', width: '100%', background: '#2a241e', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 10, padding: 11, fontWeight: 600, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>Leave — make Amara host</button>
                <button className="hv-danger-soft" onClick={() => app.leaveMeeting('ended')} style={{ display: 'block', width: '100%', background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.4)', color: '#e0836f', borderRadius: 10, padding: 11, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>End meeting for all · {tiles.length} people</button>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Leave the meeting?</div>
                <button onClick={() => app.leaveMeeting('left')} style={{ display: 'block', width: '100%', background: '#c94a38', border: 'none', color: '#fff', borderRadius: 10, padding: 11, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>Yes, leave</button>
                <button onClick={() => app.patch({ leaveOpen: false })} style={{ display: 'block', width: '100%', background: 'none', border: '1px solid #3a332b', color: '#c9beb0', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Stay</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Meeting() {
  const app = useApp();
  const s = app.s;
  const conn = s.reconnecting ? 'bad' : 'good';
  const connColor = conn === 'good' ? '#6fbf8f' : '#e0b45f';

  return (
    <section onMouseMove={app.wake} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0e0c0a', overflow: 'hidden', position: 'relative' }}>
      {s.youreIn && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, background: 'rgba(14,12,10,.85)', animation: 'fadeUp .3s ease' }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 40, display: 'flex', alignItems: 'center', gap: 10 }}>
            You're in <Ic name="sparkles" size={36} color="#f08b5f" />
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, background: 'linear-gradient(rgba(14,12,10,.85),transparent)', opacity: s.bars ? 1 : 0, transition: 'opacity .4s', pointerEvents: s.bars ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16 }}>Weekly team sync</span>
          <span style={{ color: '#8a7f70', fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed(s.elapsedS)}</span>
          {s.recording && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(224,96,79,.15)', border: '1px solid rgba(224,96,79,.4)', color: '#e0836f', fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: '4px 11px' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e0604f', animation: 'recBlink 1.4s infinite' }} />REC
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="hv-fg" onClick={() => app.patch(st => ({ view: st.view === 'grid' ? 'speaker' : 'grid' }))} style={{ background: '#1e1a16', border: '1px solid #2e2822', color: '#c9beb0', borderRadius: 99, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {s.view === 'grid' ? <Lbl name="grid" text="Grid" size={15} /> : <Lbl name="user" text="Speaker" size={15} />}
          </button>
          <button onClick={() => app.patch(st => ({ connPop: !st.connPop }))} title="Connection quality" style={{ background: 'none', border: 'none', color: connColor, cursor: 'pointer', padding: 7, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ width: 3, height: 5, background: 'currentColor', borderRadius: 1 }} />
            <span style={{ width: 3, height: 9, background: 'currentColor', borderRadius: 1 }} />
            <span style={{ width: 3, height: 13, background: 'currentColor', borderRadius: 1, opacity: conn === 'good' ? 1 : 0.25 }} />
          </button>
          <button className="hv-fg" onClick={app.copyLink} title="Copy invite link" style={{ background: 'none', border: 'none', color: '#a3988a', cursor: 'pointer', padding: 7 }}><Ic name="link" size={18} /></button>
          {s.connPop && (
            <div style={{ position: 'absolute', top: 48, right: 60, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 16, zIndex: 40, width: 240, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, color: connColor }}>{conn === 'good' ? 'Your connection looks great' : 'Your connection is unstable'}</div>
              <div style={{ color: '#a3988a', fontSize: 12.5, lineHeight: 1.7 }}>
                Bitrate <span style={{ color: '#f4eee5', float: 'right' }}>{conn === 'good' ? '2.4 Mbps' : '0.3 Mbps'}</span><br />
                Latency <span style={{ color: '#f4eee5', float: 'right' }}>{conn === 'good' ? '38 ms' : '410 ms'}</span><br />
                Packet loss <span style={{ color: '#f4eee5', float: 'right' }}>{conn === 'good' ? '0.1%' : '8.2%'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video area + side panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, padding: '56px 12px 86px', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {s.view === 'grid' ? <GridView /> : <SpeakerView />}
          {s.reconnecting && (
            <div style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', zIndex: 30, background: 'rgba(36,31,26,.95)', border: '1px solid rgba(240,180,95,.4)', borderRadius: 14, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
              <span style={{ width: 16, height: 16, border: '2px solid rgba(240,180,95,.3)', borderTopColor: '#e0b45f', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e0b45f' }}>Reconnecting…</div>
                <div style={{ color: '#a3988a', fontSize: 12 }}>Hang tight — we're getting you back.</div>
              </div>
            </div>
          )}
          {s.mutedNudge && (
            <div style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 30, background: '#241f1a', border: '1px solid rgba(240,139,95,.5)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 12px 40px rgba(0,0,0,.5)', animation: 'fadeUp .25s ease' }}>
              <span style={{ display: 'inline-flex', color: '#f0a97f' }}><Ic name="micOff" size={18} /></span>
              <div style={{ fontSize: 13.5 }}><span style={{ fontWeight: 700 }}>Trying to say something?</span> <span style={{ color: '#a3988a' }}>You're muted.</span></div>
              <button onClick={app.toggleMic} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 9, padding: '8px 15px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Unmute</button>
              <button className="hv-fg" onClick={() => app.patch({ mutedNudge: false })} style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', padding: 2 }}><Ic name="close" size={15} /></button>
            </div>
          )}
          {s.bursts.map(b => (
            <span key={b.id} style={{ position: 'absolute', left: b.x, bottom: 60, animation: 'floatUp 3.5s ease-out forwards', pointerEvents: 'none', zIndex: 35, color: '#f4eee5' }}>
              <Ic name={b.name as IconName} size={34} />
            </span>
          ))}
        </div>
        {s.panel && <SidePanel />}
      </div>

      <ControlBar />

      {/* Sharing pill */}
      {s.sharing && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 30, background: '#241f1a', border: '1px solid rgba(111,191,143,.4)', borderRadius: 99, padding: '9px 10px 9px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <span style={{ fontSize: 13, color: '#6fbf8f', fontWeight: 600 }}>You're sharing your screen</span>
          <button onClick={() => app.patch({ sharing: false })} style={{ background: '#c94a38', border: 'none', color: '#fff', borderRadius: 99, padding: '8px 16px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Stop sharing</button>
        </div>
      )}
      {/* Recording banner */}
      {s.recBanner && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 31, background: 'rgba(224,96,79,.13)', border: '1px solid rgba(224,96,79,.45)', borderRadius: 14, padding: '11px 18px', fontSize: 13.5, fontWeight: 600, color: '#e0836f', animation: 'fadeUp .25s ease', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Ic name="record" size={14} color="#e0836f" /> {s.recBanner}
        </div>
      )}
      {/* Toasts */}
      <div style={{ position: 'absolute', left: 18, bottom: 92, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 36 }}>
        {s.toasts.map(t => (
          <div key={t.id} style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 12, padding: '11px 15px', fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,.4)', animation: 'fadeUp .25s ease', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 320 }}>
            <span>{t.text}</span>
            {t.admit && (
              <>
                <button onClick={() => { app.patch({ waitingGuest: false, admitted: true, toasts: [] }); app.toast('Leila Boum joined'); }} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Admit</button>
                <button onClick={() => app.patch({ waitingGuest: false, toasts: [] })} style={{ background: 'none', border: '1px solid #3a332b', color: '#a3988a', borderRadius: 8, padding: '6px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Deny</button>
              </>
            )}
          </div>
        ))}
      </div>
      {/* Shortcuts overlay */}
      {s.shortcutsOpen && (
        <div onClick={() => app.patch({ shortcutsOpen: false })} style={{ position: 'absolute', inset: 0, background: 'rgba(10,8,6,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 20, padding: 28, width: 380 }}>
            <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 19, margin: '0 0 16px' }}>Keyboard shortcuts</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5, color: '#c9beb0' }}>
              {[
                ['Mute / unmute', 'M'], ['Camera on / off', 'V'], ['Push to talk (hold)', 'Space'],
                ['Chat', 'C'], ['People', 'P'], ['Fullscreen', 'F'], ['Copy invite link', '⌘D'], ['Close panel', 'Esc'],
              ].map(([what, key]) => (
                <div key={what} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{what}</span>
                  <span style={{ background: '#1c1815', border: '1px solid #362f28', borderRadius: 6, padding: '2px 9px', fontFamily: 'monospace', fontSize: 12, color: '#f0a97f' }}>{key}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
