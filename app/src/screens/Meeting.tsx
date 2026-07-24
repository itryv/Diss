import { Fragment, memo, useEffect, useRef, useState } from 'react';
import { ConnectionQuality } from 'livekit-client';
import type { Room, Track } from 'livekit-client';
import { useApp } from '../store';
import type { ShareMode, VideoQuality } from '../store';
import { GRID_GAP, useGridMeasure, useTiles } from '../tiles';
import type { Tile } from '../tiles';
import { Ic, Lbl } from '../icons';
import type { IconName } from '../icons';
import { fmtElapsed, initialsOf } from '../util';

/** Touch targets are >= 44px everywhere, and grow on narrow viewports. */
const ctrlBtnFor = (narrow: boolean): React.CSSProperties => ({
  height: narrow ? 48 : 50,
  minWidth: narrow ? 52 : 58,
  borderRadius: 14,
  border: '1px solid #2e2822',
  color: '#f4eee5',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
});

const EMOJIS: IconName[] = ['thumbsUp', 'heart', 'laugh', 'party', 'clap'];

const SHARE_MODES: { mode: ShareMode; icon: IconName; text: string; hint: string }[] = [
  { mode: 'screen', icon: 'share', text: 'Share your screen', hint: 'Picture only' },
  { mode: 'screen-audio', icon: 'speaker', text: 'Screen + computer audio', hint: 'Great for video clips' },
  { mode: 'audio', icon: 'speaker', text: 'Computer audio only', hint: 'No picture, just sound' },
];

const QUALITIES: { q: VideoQuality; text: string; hint: string }[] = [
  { q: 'auto', text: 'Auto', hint: 'Adapts to your connection' },
  { q: 'high', text: 'Hi-Res', hint: 'Up to 1080p — needs bandwidth' },
  { q: 'saver', text: 'Data saver', hint: '360p, gentle on data' },
];

const activeShareMode = (hasAudio: boolean, audioOnly: boolean): ShareMode =>
  audioOnly ? 'audio' : hasAudio ? 'screen-audio' : 'screen';

function TrackVideo({ track, mirror, mainStage, style }: { track: Track; mirror?: boolean; mainStage?: boolean; style: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} autoPlay muted playsInline data-main-stage={mainStage ? '1' : undefined} style={{ ...style, transform: mirror ? 'scaleX(-1)' : undefined }} />;
}

function TrackAudio({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

function TileMedia({ tile, big }: { tile: Tile; big?: boolean }) {
  const fill: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: tile.isScreen ? 'contain' : 'cover' };
  if (tile.videoTrack && (tile.camOn || tile.isScreen)) {
    return <TrackVideo track={tile.videoTrack} mirror={tile.you && !tile.isScreen} mainStage={big} style={fill} />;
  }
  const size = big ? 110 : 64;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#17130f' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: tile.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: big ? 38 : 22 }}>{tile.initials}</div>
    </div>
  );
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

/**
 * Everything a tile actually paints from. The store pushes a brand-new state
 * object every second (clock) and on every active-speaker event, so tiles are
 * memoised against exactly these fields — callbacks are excluded because they
 * are all stable-by-behaviour (identity-captured + functional `patch`).
 * Track identity IS compared, so a new/removed track still re-renders.
 */
function sameTile(a: { tile: Tile; w: number; h: number; cols?: number }, b: { tile: Tile; w: number; h: number; cols?: number }) {
  if (a.w !== b.w || a.h !== b.h || a.cols !== b.cols) return false;
  const x = a.tile, y = b.tile;
  return x.key === y.key
    && x.videoTrack === y.videoTrack
    && x.camOn === y.camOn
    && x.isScreen === y.isScreen
    && x.you === y.you
    && x.muted === y.muted
    && x.hand === y.hand
    && x.handQ === y.handQ
    && x.ring === y.ring
    && x.pinned === y.pinned
    && x.label === y.label
    && x.short === y.short
    && x.badge === y.badge
    && x.color === y.color
    && x.initials === y.initials;
}

const GridTile = memo(function GridTile({ tile, w, h, cols = 0 }: { tile: Tile; w: number; h: number; cols?: number }) {
  // `cols > 0` only happens on the very first frame, before the container has
  // been measured — fall back to an even share of the row.
  const sized: React.CSSProperties = w > 0
    ? { width: w, height: h, flex: '0 0 auto' }
    : { width: `calc((100% - ${GRID_GAP * Math.max(0, cols - 1)}px) / ${Math.max(1, cols)})`, aspectRatio: '16 / 9', flex: '0 0 auto' };
  return (
    <div
      className="tile"
      style={{ position: 'relative', ...sized, background: '#17130f', borderRadius: 16, overflow: 'hidden', minHeight: 0, boxShadow: tile.ring, transition: 'box-shadow .3s', contain: 'layout paint' }}
    >
      <TileMedia tile={tile} />
      <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 6, maxWidth: '75%' }}>
        <span style={{ background: 'rgba(14,12,10,.65)', backdropFilter: 'blur(4px)', borderRadius: 8, padding: '4px 10px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.label}</span>
        {tile.badge && <span style={{ background: 'rgba(240,139,95,.2)', color: '#f0a97f', borderRadius: 6, padding: '3px 7px', fontSize: 10.5, fontWeight: 700 }}>{tile.badge}</span>}
      </div>
      {tile.muted && <MutedBadge />}
      {tile.hand && <HandBadge q={tile.handQ} />}
      <div className="hv-reveal" style={{ position: 'absolute', right: 8, top: 8 }}>
        <button onClick={tile.pinToggle} title="Pin" style={{ background: 'rgba(14,12,10,.7)', border: 'none', color: '#f4eee5', borderRadius: 8, padding: '6px 9px', fontSize: 12, cursor: 'pointer' }}>
          {tile.pinned ? <Lbl name="pin" text="Unpin" size={13} /> : <Ic name="pin" size={13} />}
        </button>
      </div>
    </div>
  );
}, sameTile);

function GridView() {
  const app = useApp();
  const { gridTiles, gridCols, gridTileW, gridTileH, gridPage, gridPages } = useTiles();
  const measure = useGridMeasure();
  const pageBtn: React.CSSProperties = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 15, width: 36, height: 56, borderRadius: 12, background: 'rgba(30,26,22,.9)', border: '1px solid #362f28', color: '#c9beb0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const solved = gridTileW > 0;
  return (
    // The page indicator needs its own room — padding on the measured element is
    // outside the ResizeObserver's content box, so the solver accounts for it free.
    <div ref={measure} style={{ height: '100%', position: 'relative', overflow: 'hidden', paddingBottom: gridPages > 1 ? 26 : 0 }}>
      {/* flex-wrap rather than a grid: with exact tile sizes from the solver each
          row holds `gridCols` tiles, and a short last row centres itself. */}
      <div style={{ height: '100%', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', gap: GRID_GAP }}>
      {gridTiles.map(p => (
        <GridTile key={p.key} tile={p} w={gridTileW} h={gridTileH} cols={solved ? 0 : gridCols} />
      ))}
      </div>
      {gridPages > 1 && (
        <>
          {gridPage > 0 && (
            <button className="hv-fg" onClick={() => app.patch({ gridPage: gridPage - 1 })} title="Previous page" style={{ ...pageBtn, left: 6 }}>
              <Ic name="arrowLeft" size={16} />
            </button>
          )}
          {gridPage < gridPages - 1 && (
            <button className="hv-fg" onClick={() => app.patch({ gridPage: gridPage + 1 })} title="Next page" style={{ ...pageBtn, right: 6 }}>
              <Ic name="arrowRight" size={16} />
            </button>
          )}
          <span style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 15, background: 'rgba(30,26,22,.9)', border: '1px solid #362f28', borderRadius: 99, padding: '5px 13px', fontSize: 12, fontWeight: 600, color: '#a3988a', fontVariantNumeric: 'tabular-nums' }}>
            page {gridPage + 1}/{gridPages}
          </span>
        </>
      )}
    </div>
  );
}

const StripTile = memo(function StripTile({ tile, w }: { tile: Tile; w: number; h: number }) {
  return (
    <div onClick={tile.pinToggle} style={{ position: 'relative', width: w, aspectRatio: '16/10', background: '#17130f', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', boxShadow: tile.ring, flexShrink: 0, contain: 'layout paint' }}>
      {tile.videoTrack && tile.camOn ? (
        <TrackVideo track={tile.videoTrack} mirror={tile.you} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: tile.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{tile.initials}</div>
        </div>
      )}
      <span style={{ position: 'absolute', left: 6, bottom: 6, background: 'rgba(14,12,10,.65)', borderRadius: 6, padding: '2px 7px', fontSize: 10.5, fontWeight: 600, maxWidth: '85%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.short}</span>
    </div>
  );
}, sameTile);

function SpeakerView() {
  const app = useApp();
  const s = app.s;
  const narrow = s.isNarrow;
  const { mainTile, strip, stripOverflow } = useTiles();
  if (!mainTile) return null;
  const selfTile = strip.find(t => t.you);
  const stripW = narrow ? 92 : 128;
  const selfW = narrow ? 104 : 170;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start', flexShrink: 0, overflowX: 'auto', overflowY: 'hidden', padding: '0 2px 2px', scrollbarWidth: 'none' }}>
        <div style={{ display: 'flex', gap: 8, margin: '0 auto' }}>
        {strip.map(p => (
          <StripTile key={p.key} tile={p} w={stripW} h={0} />
        ))}
        {stripOverflow && (
          <div style={{ width: 64, aspectRatio: '16/10', background: '#1e1a16', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a7f70', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{stripOverflow}</div>
        )}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', background: '#17130f', borderRadius: 18, overflow: 'hidden', minHeight: 0, boxShadow: mainTile.ring }}>
        <TileMedia tile={mainTile} big />
        <div style={{ position: 'absolute', left: 14, bottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: 'rgba(14,12,10,.65)', backdropFilter: 'blur(4px)', borderRadius: 9, padding: '6px 13px', fontSize: 14, fontWeight: 600 }}>{mainTile.label}</span>
          {mainTile.badge && <span style={{ background: 'rgba(240,139,95,.2)', color: '#f0a97f', borderRadius: 7, padding: '4px 9px', fontSize: 11, fontWeight: 700 }}>{mainTile.badge}</span>}
        </div>
        {selfTile && !mainTile.you && (
          !s.selfCollapsed ? (
            <div style={{ position: 'absolute', right: 14, bottom: 14, width: selfW, aspectRatio: '16/10', borderRadius: 12, overflow: 'hidden', border: '1px solid #2e2822', background: '#17130f' }}>
              {selfTile.videoTrack && selfTile.camOn ? (
                <TrackVideo track={selfTile.videoTrack} mirror style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#8a5a44', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, fontFamily: "'Bricolage Grotesque',sans-serif" }}>{initialsOf(s.lobbyName)}</div>
                </div>
              )}
              <button className="hv-fg" onClick={() => app.patch(st => ({ selfCollapsed: !st.selfCollapsed }))} style={{ position: 'absolute', right: 6, top: 6, background: 'rgba(14,12,10,.7)', border: 'none', color: '#a3988a', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>—</button>
            </div>
          ) : (
            <button className="hv-fg" onClick={() => app.patch(st => ({ selfCollapsed: !st.selfCollapsed }))} style={{ position: 'absolute', right: 14, bottom: 14, background: 'rgba(30,26,22,.9)', border: '1px solid #362f28', color: '#c9beb0', borderRadius: 99, padding: '8px 15px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Show self view</button>
          )
        )}
      </div>
    </div>
  );
}

function SidePanel() {
  const app = useApp();
  const s = app.s;
  const { tiles } = useTiles();
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [s.messages.length]);
  // Narrow: a full-screen sheet over the video instead of a 340px sidebar that
  // would push the page wider than the viewport.
  const sheet: React.CSSProperties = s.isNarrow
    ? { position: 'fixed', inset: 0, width: '100%', maxWidth: '100%', borderRadius: 0, border: 'none', zIndex: 45 }
    : { width: 340, flexShrink: 0, borderRadius: 18, border: '1px solid #2a241e' };
  return (
    <div style={{ background: '#1a1613', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'fadeUp .25s ease', ...sheet }}>
      <div style={{ display: 'flex', padding: s.isNarrow ? '12px 10px 2px' : '10px 10px 0', gap: 4, alignItems: 'center' }}>
        <button onClick={() => app.patch({ tab: 'chat', unread: 0 })} style={{ flex: 1, minHeight: 44, background: s.tab === 'chat' ? '#2a241e' : 'none', color: s.tab === 'chat' ? '#f4eee5' : '#8a7f70', border: 'none', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Chat</button>
        <button onClick={() => app.patch({ tab: 'people' })} style={{ flex: 1, minHeight: 44, background: s.tab === 'people' ? '#2a241e' : 'none', color: s.tab === 'people' ? '#f4eee5' : '#8a7f70', border: 'none', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>People · {tiles.length}</button>
        <button className="hv-fg" onClick={() => app.patch({ panel: false })} title="Close panel" style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic name="close" size={s.isNarrow ? 20 : 15} /></button>
      </div>
      {s.tab === 'chat' ? (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ textAlign: 'center', color: '#6f665b', fontSize: 11.5, padding: '4px 0' }}>Messages are saved with this meeting</div>
            {s.messages.map((m, i) => {
              const lastHistory = m.history && !s.messages[i + 1]?.history;
              return (
                <Fragment key={i}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: m.mine ? 'flex-end' : 'flex-start', opacity: m.history ? 0.75 : 1 }}>
                    <div style={{ fontSize: 11.5, color: '#8a7f70', fontWeight: 600 }}>
                      {m.who}
                      {m.ts !== undefined && <span style={{ color: '#6f665b', fontWeight: 400, marginLeft: 6 }}>{new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
                    </div>
                    <div style={{ background: m.mine ? '#f08b5f' : '#241f1a', color: m.mine ? '#241209' : '#f4eee5', borderRadius: 14, padding: '9px 13px', fontSize: 13.5, lineHeight: 1.45, maxWidth: '85%' }}>{m.text}</div>
                  </div>
                  {lastHistory && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6f665b', fontSize: 11 }}>
                      <span style={{ flex: 1, height: 1, background: '#2a241e' }} />
                      earlier in this meeting
                      <span style={{ flex: 1, height: 1, background: '#2a241e' }} />
                    </div>
                  )}
                </Fragment>
              );
            })}
            <div ref={chatEnd} />
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #2a241e', display: 'flex', gap: 8 }}>
            <input
              value={s.chatInput}
              maxLength={2000}
              onChange={e => app.patch({ chatInput: e.target.value.slice(0, 2000) })}
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
            {(s.isHost || s.isCoHost) && s.waitingGuests.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#f0a97f', marginBottom: 8 }}>Waiting to join · {s.waitingGuests.length}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {s.waitingGuests.map(g => (
                    <div key={g.waitingId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(240,139,95,.07)', border: '1px solid rgba(240,139,95,.25)', borderRadius: 12, padding: '9px 10px' }}>
                      <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#8a7a4a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10.5, fontFamily: "'Bricolage Grotesque',sans-serif", flexShrink: 0 }}>{initialsOf(g.displayName)}</span>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.displayName}</div>
                      <button className="hv-primary" onClick={() => app.actOnWaiting(g.waitingId, 'admit')} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Admit</button>
                      <button className="hv-fg" onClick={() => app.actOnWaiting(g.waitingId, 'deny')} style={{ background: 'none', border: '1px solid #3a332b', color: '#8a7f70', borderRadius: 8, padding: '5px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Deny</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8a7f70', marginBottom: 8 }}>In meeting · {tiles.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tiles.map(p => (
                <div key={p.key} className="hv-bg-21" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderRadius: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, fontFamily: "'Bricolage Grotesque',sans-serif", flexShrink: 0 }}>{p.initials}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>
                    {p.badge && <div style={{ fontSize: 10.5, color: '#f0a97f', fontWeight: 700 }}>{p.badge}</div>}
                  </div>
                  {p.hand && <span style={{ color: '#f0b45f' }}><Ic name="hand" size={14} /></span>}
                  <span style={{ color: p.muted ? '#e0836f' : '#6fbf8f' }}><Ic name={p.muted ? 'micOff' : 'mic'} size={14} /></span>
                  {p.canPromote && (
                    <button className="hv-fg" onClick={p.promoteToggle} title={p.isCoHost ? 'Remove co-host' : 'Make co-host'} style={{ background: 'none', border: 'none', color: p.isCoHost ? '#f0a97f' : '#6f665b', cursor: 'pointer', padding: 3 }}><Ic name="star" size={14} /></button>
                  )}
                  {p.canModerate && (
                    <>
                      <button className="hv-fg" onClick={p.hostMute} title="Mute for everyone" disabled={p.muted} style={{ background: 'none', border: 'none', color: p.muted ? '#3a332b' : '#6f665b', cursor: p.muted ? 'default' : 'pointer', padding: 3 }}><Ic name="micOff" size={15} /></button>
                      <button className="hv-fg" onClick={p.hostRemove} title="Remove from meeting" style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', padding: 3 }}><Ic name="close" size={14} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          {(s.isHost || s.isCoHost) && !s.devMode && (
            <div style={{ padding: 12, borderTop: '1px solid #2a241e', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="hv-bg-2a" onClick={app.muteAll} style={{ flex: 1, background: '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Mute all</button>
                {s.isHost && (
                  <button
                    onClick={() => app.setMeetingFlag({ locked: !s.meeting?.locked })}
                    style={{ flex: 1, background: s.meeting?.locked ? 'rgba(224,96,79,.12)' : '#241f1a', border: `1px solid ${s.meeting?.locked ? 'rgba(224,96,79,.45)' : '#362f28'}`, color: s.meeting?.locked ? '#e0836f' : '#c9beb0', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
                  >
                    <Lbl name="lock" text={s.meeting?.locked ? 'Locked' : 'Lock meeting'} size={13} />
                  </button>
                )}
              </div>
              {s.isHost && (
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '2px 4px' }}>
                  <span style={{ fontSize: 12.5, color: '#c9beb0', fontWeight: 600 }}>Waiting room for new guests</span>
                  <span onClick={() => app.setMeetingFlag({ waitingRoom: !s.meeting?.waitingRoom })} style={{ width: 38, height: 22, borderRadius: 99, background: s.meeting?.waitingRoom ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .15s', flexShrink: 0, cursor: 'pointer' }}>
                    <span style={{ position: 'absolute', top: 3, left: s.meeting?.waitingRoom ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#f4eee5', transition: 'left .15s' }} />
                  </span>
                </label>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Screen / screen+audio / computer-audio-only, with the live mode ticked. */
function ShareMenu({ onPick, onStop, sharing, mode }: { onPick: (m: ShareMode) => void; onStop: () => void; sharing: boolean; mode: ShareMode }) {
  return (
    <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, width: 262, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
      {SHARE_MODES.map(m => {
        const on = sharing && mode === m.mode;
        return (
          <button
            key={m.mode}
            className="hv-bg-2e"
            onClick={() => onPick(m.mode)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, textAlign: 'left', background: on ? '#2e2822' : 'none', border: 'none', color: on ? '#6fbf8f' : '#f4eee5', padding: '9px 11px', borderRadius: 9, cursor: 'pointer' }}
          >
            <Ic name={m.icon} size={17} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{m.text}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: '#8a7f70' }}>{m.hint}</span>
            </span>
            {on && <Ic name="check" size={15} />}
          </button>
        );
      })}
      {sharing && (
        <>
          <div style={{ borderTop: '1px solid #3a332b', margin: '5px 0' }} />
          <button className="hv-danger-ghost" onClick={onStop} style={{ display: 'block', width: '100%', minHeight: 44, textAlign: 'left', background: 'none', border: 'none', color: '#e0836f', padding: '10px 11px', fontSize: 13.5, fontWeight: 700, borderRadius: 9, cursor: 'pointer' }}>Stop sharing</button>
        </>
      )}
    </div>
  );
}

function ControlBar() {
  const app = useApp();
  const s = app.s;
  const narrow = s.isNarrow;
  const ctrlBtn = ctrlBtnFor(narrow);
  const { tiles, handsAhead } = useTiles();
  const [shareOpen, setShareOpen] = useState(false);
  const shareMode = activeShareMode(s.shareHasAudio, s.shareAudioOnly);

  // The share menu is the only popup not in the store — close it when another opens.
  useEffect(() => {
    if (s.moreOpen || s.leaveOpen || s.reactionsOpen) setShareOpen(false);
  }, [s.moreOpen, s.leaveOpen, s.reactionsOpen]);

  /** Picking the mode you're already in stops the share; picking another swaps to it. */
  const pickShare = async (m: ShareMode) => {
    setShareOpen(false);
    if (s.sharing) {
      await app.toggleShare(m); // any mode stops the current share
      if (m === shareMode) return;
    }
    await app.toggleShare(m);
  };

  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled;
  const moreItems: { label: React.ReactNode; color: string; go: () => void }[] = [
    ...(s.isHost || s.isCoHost ? [{
      label: <Lbl name="record" text={s.recOn ? 'Stop recording' : 'Start recording'} />,
      color: s.recOn ? '#e0836f' : '#f4eee5', go: app.toggleRec,
    }] : []),
    { label: <Lbl name="captions" text={s.captionsOn ? 'Turn off captions' : 'Captions'} />, color: s.captionsOn ? '#f0a97f' : '#f4eee5', go: app.toggleCaptions },
    ...(s.blurSupported ? [{
      label: <Lbl name="blur" text={s.blurOn ? 'Remove background blur' : 'Blur my background'} />,
      color: s.blurOn ? '#f0a97f' : '#f4eee5', go: app.toggleBlur,
    }] : []),
    { label: <Lbl name="mic" text={`Noise suppression · ${s.nsOn ? 'on' : 'off'}`} />, color: s.nsOn ? '#f0a97f' : '#f4eee5', go: app.toggleNs },
    ...(pipSupported ? [{
      label: <Lbl name="pip" text="Picture-in-picture" />, color: '#f4eee5', go: app.togglePip,
    }] : []),
    { label: <Lbl name="keyboard" text="Keyboard shortcuts" />, color: '#f4eee5', go: () => app.patch({ shortcutsOpen: true, moreOpen: false }) },
    { label: <Lbl name="fullscreen" text="Fullscreen" />, color: '#f4eee5', go: () => { app.patch({ moreOpen: false }); document.documentElement.requestFullscreen?.().catch(() => {}); } },
    { label: <Lbl name="flag" text="Report a problem" />, color: '#f4eee5', go: () => { app.patch({ moreOpen: false }); app.toast('Thanks — our team takes a look at every report'); } },
  ];

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: narrow ? 'wrap' : 'nowrap', gap: narrow ? 8 : 10, padding: narrow ? '10px 10px calc(12px + env(safe-area-inset-bottom))' : '14px 20px 18px', zIndex: 20, background: 'linear-gradient(transparent,rgba(14,12,10,.9))', opacity: s.bars ? 1 : 0, transition: 'opacity .4s', pointerEvents: s.bars ? 'auto' : 'none' }}>
      <button onClick={app.toggleMic} title="Mute (M)" style={{ ...ctrlBtn, background: s.micMuted ? 'rgba(201,74,56,.85)' : '#1e1a16', borderColor: s.micMuted ? '#c94a38' : '#2e2822' }}>
        <Ic name={s.micMuted ? 'micOff' : 'mic'} size={20} />
        <span style={{ color: '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
      </button>
      <button onClick={app.toggleCam} title="Camera (V)" style={{ ...ctrlBtn, background: s.camOff ? 'rgba(201,74,56,.85)' : '#1e1a16', borderColor: s.camOff ? '#c94a38' : '#2e2822' }}>
        <Ic name={s.camOff ? 'videoOff' : 'video'} size={20} />
        <span style={{ color: '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setShareOpen(o => !o); app.patch({ moreOpen: false, leaveOpen: false, reactionsOpen: false }); }}
          title={s.sharing ? 'Sharing — change or stop' : 'Share your screen'}
          aria-expanded={shareOpen}
          style={{ ...ctrlBtn, background: s.sharing ? 'rgba(111,191,143,.2)' : shareOpen ? '#2e2822' : '#1e1a16', borderColor: s.sharing ? 'rgba(111,191,143,.5)' : '#2e2822', color: s.sharing ? '#6fbf8f' : '#f4eee5' }}
        >
          <Ic name={s.shareAudioOnly ? 'speaker' : 'share'} size={20} />
          <span style={{ color: s.sharing ? '#6fbf8f' : '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
        </button>
        {shareOpen && (
          <ShareMenu
            sharing={s.sharing}
            mode={shareMode}
            onPick={pickShare}
            onStop={() => { setShareOpen(false); app.toggleShare(shareMode); }}
          />
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.patch(st => ({ reactionsOpen: !st.reactionsOpen, moreOpen: false, leaveOpen: false }))} title="Reactions" style={{ ...ctrlBtn, background: s.reactionsOpen || s.hand ? '#2e2822' : '#1e1a16' }}>
          <Ic name="hand" size={18} />
        </button>
        {s.reactionsOpen && (
          <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            <button
              onClick={app.toggleHand}
              style={{ background: s.hand ? 'rgba(240,180,95,.2)' : '#2a241e', border: `1px solid ${s.hand ? 'rgba(240,180,95,.5)' : '#3a332b'}`, color: '#f4eee5', borderRadius: 10, padding: '9px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <Lbl name="hand" text={s.hand ? 'Lower hand' : `Raise hand${handsAhead > 0 ? ` · ${handsAhead} up` : ''}`} size={15} />
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              {EMOJIS.map(e => (
                <button key={e} className="hv-bg-2e" onClick={() => app.sendReaction(e)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: '#f4eee5' }}><Ic name={e} size={22} /></button>
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
        <button onClick={() => app.togglePanel('people')} title="People (P)" style={{ ...ctrlBtn, background: s.panel && s.tab === 'people' ? '#2e2822' : '#1e1a16' }}><Ic name="users" size={18} /></button>
        {s.waitingGuests.length > 0 && (s.isHost || s.isCoHost) ? (
          <span style={{ position: 'absolute', top: -5, right: -5, background: '#f08b5f', color: '#241209', fontSize: 11, fontWeight: 800, borderRadius: 99, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', animation: 'badgePulse 1.6s infinite' }}>+{s.waitingGuests.length}</span>
        ) : (
          <span style={{ position: 'absolute', top: -5, right: -5, background: '#2e2822', color: '#c9beb0', fontSize: 11, fontWeight: 700, borderRadius: 99, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{tiles.length}</span>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.patch(st => ({ moreOpen: !st.moreOpen, reactionsOpen: false, leaveOpen: false }))} title="More" style={{ ...ctrlBtn, background: s.moreOpen ? '#2e2822' : '#1e1a16' }}><Ic name="more" size={18} /></button>
        {s.moreOpen && (
          <div style={{ position: 'absolute', bottom: 60, right: 0, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, width: 250, maxWidth: '92vw', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            {moreItems.map((item, i) => (
              <button key={i} className="hv-bg-2e" onClick={item.go} style={{ display: 'block', width: '100%', minHeight: 44, textAlign: 'left', background: 'none', border: 'none', color: item.color, padding: '10px 13px', fontSize: 13.5, fontWeight: 500, borderRadius: 9, cursor: 'pointer' }}>{item.label}</button>
            ))}
            <div style={{ borderTop: '1px solid #3a332b', margin: '6px 0 2px' }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '6px 13px 4px' }}>Video quality</div>
            {QUALITIES.map(q => {
              const on = s.videoQuality === q.q;
              return (
                <button
                  key={q.q}
                  className="hv-bg-2e"
                  onClick={() => { app.patch({ moreOpen: false }); app.setVideoQuality(q.q); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, textAlign: 'left', background: on ? '#2e2822' : 'none', border: 'none', color: on ? '#f0a97f' : '#f4eee5', padding: '8px 13px', borderRadius: 9, cursor: 'pointer' }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{q.text}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#8a7f70' }}>{q.hint}</span>
                  </span>
                  {on && <Ic name="check" size={15} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!narrow && <div style={{ width: 22 }} />}
      <div style={{ position: 'relative' }}>
        <button className="hv-danger" onClick={() => app.patch(st => ({ leaveOpen: !st.leaveOpen, moreOpen: false, reactionsOpen: false }))} style={{ height: narrow ? 48 : 50, borderRadius: 14, background: '#c94a38', border: 'none', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', padding: narrow ? '0 18px' : '0 24px' }}>Leave</button>
        {s.leaveOpen && (
          <div style={{ position: 'absolute', bottom: 60, right: 0, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, padding: 16, width: 260, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            {s.isHost ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Heading out?</div>
                <div style={{ color: '#a3988a', fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>You're the host — leave quietly, or end it for everyone.</div>
                <button className="hv-bg-33" onClick={() => app.leaveMeeting('left')} style={{ display: 'block', width: '100%', background: '#2a241e', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 10, padding: 11, fontWeight: 600, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>Leave — keep the meeting going</button>
                <button className="hv-danger-soft" onClick={app.endForAll} style={{ display: 'block', width: '100%', background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.4)', color: '#e0836f', borderRadius: 10, padding: 11, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>End meeting for all · {tiles.length} people</button>
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

interface StatSample { up: number | null; down: number | null; rtt: number | null; loss: number | null; res: string; fps: number | null; }

const fmtBitrate = (bps: number | null) =>
  bps === null ? null : bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.max(0, Math.round(bps / 1000))} kbps`;

/** Live WebRTC stats for the popup — polls getRTCStatsReport() on all tracks every 2s while open. */
function ConnStats({ goodConn, connColor, narrow }: { goodConn: boolean; connColor: string; narrow: boolean }) {
  const app = useApp();
  const [sample, setSample] = useState<StatSample | null>(null);
  const prevRef = useRef<{ ts: number; sent: number; recv: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const collect = async () => {
      const room: Room | null = app.getRoom();
      if (!room) return;
      type StatsCapable = { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> };
      const tracks: StatsCapable[] = [];
      room.localParticipant.trackPublications.forEach(pub => { if (pub.track) tracks.push(pub.track as StatsCapable); });
      room.remoteParticipants.forEach(p => p.trackPublications.forEach(pub => { if (pub.track) tracks.push(pub.track as StatsCapable); }));
      const reports = (await Promise.all(
        tracks.map(t => (typeof t.getRTCStatsReport === 'function' ? t.getRTCStatsReport().catch(() => undefined) : Promise.resolve(undefined))),
      )).filter((r): r is RTCStatsReport => !!r);
      if (!alive) return;

      let sent = 0, recv = 0, rtt: number | null = null, loss: number | null = null, res = '', fps: number | null = null;
      for (const report of reports) {
        report.forEach(stat => {
          if (stat.type === 'outbound-rtp') {
            sent += stat.bytesSent ?? 0;
            if (!res && stat.frameWidth) { res = `${stat.frameWidth}×${stat.frameHeight}`; fps = stat.framesPerSecond ?? fps; }
          } else if (stat.type === 'inbound-rtp') {
            recv += stat.bytesReceived ?? 0;
            if (stat.frameWidth) { res = `${stat.frameWidth}×${stat.frameHeight}`; fps = stat.framesPerSecond ?? fps; }
          } else if (stat.type === 'candidate-pair' && stat.currentRoundTripTime !== undefined && (stat.nominated || stat.state === 'succeeded')) {
            rtt = Math.round(stat.currentRoundTripTime * 1000);
          } else if (stat.type === 'remote-inbound-rtp' && stat.fractionLost !== undefined) {
            loss = Math.max(loss ?? 0, stat.fractionLost * 100);
          }
        });
      }
      const now = Date.now();
      const prev = prevRef.current;
      prevRef.current = { ts: now, sent, recv };
      if (!prev || now - prev.ts <= 0) return; // need two samples for bitrate
      const dt = (now - prev.ts) / 1000;
      setSample({
        up: Math.max(0, ((sent - prev.sent) * 8) / dt),
        down: Math.max(0, ((recv - prev.recv) * 8) / dt),
        rtt, loss, res, fps,
      });
    };
    collect();
    const t = window.setInterval(collect, 2000);
    return () => { alive = false; window.clearInterval(t); };
  }, [app]);

  const gathering = <span style={{ color: '#6f665b' }}>gathering…</span>;
  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>{label}</span>
      <span style={{ color: '#f4eee5', fontVariantNumeric: 'tabular-nums' }}>{value ?? gathering}</span>
    </div>
  );
  return (
    <div style={{ position: 'absolute', top: 48, right: narrow ? 8 : 60, background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 16, zIndex: 40, width: 250, maxWidth: 'calc(100vw - 20px)', boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, color: connColor }}>{goodConn ? 'Your connection looks great' : 'Your connection is unstable'}</div>
      <div style={{ color: '#a3988a', fontSize: 12.5, lineHeight: 1.9, display: 'flex', flexDirection: 'column' }}>
        {row('Bitrate up', sample ? fmtBitrate(sample.up) : null)}
        {row('Bitrate down', sample ? fmtBitrate(sample.down) : null)}
        {row('Round trip', sample?.rtt !== null && sample?.rtt !== undefined ? `${sample.rtt} ms` : null)}
        {row('Packet loss', sample ? `${(sample.loss ?? 0).toFixed(1)}%` : null)}
        {row('Video', sample?.res ? `${sample.res}${sample.fps ? ` @ ${Math.round(sample.fps)}` : ''}` : null)}
      </div>
      <div style={{ color: '#6f665b', fontSize: 11.5, marginTop: 8 }}>Updates every couple of seconds.</div>
    </div>
  );
}

export function Meeting() {
  const app = useApp();
  const s = app.s;
  const narrow = s.isNarrow;
  const { tiles, hasScreenShare, audioShareName, audioShareIsYou } = useTiles();
  const goodConn = !s.reconnecting && s.connQuality !== ConnectionQuality.Poor && s.connQuality !== ConnectionQuality.Lost;
  const connColor = goodConn ? '#6fbf8f' : '#e0b45f';

  return (
    <section onMouseMove={app.wake} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0e0c0a', overflow: 'hidden', position: 'relative' }}>
      {/* Remote audio */}
      {s.peers.filter(p => !p.isLocal && p.audioTrack).map(p => (
        <TrackAudio key={p.identity} track={p.audioTrack!} />
      ))}

      {s.youreIn && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, background: 'rgba(14,12,10,.85)', animation: 'fadeUp .3s ease' }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: narrow ? 30 : 40, display: 'flex', alignItems: 'center', gap: 10 }}>
            You're in
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: narrow ? '8px 10px' : '12px 20px', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, background: 'linear-gradient(rgba(14,12,10,.85),transparent)', opacity: s.bars ? 1 : 0, transition: 'opacity .4s', pointerEvents: s.bars ? 'auto' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 8 : 14, minWidth: 0 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: narrow ? 14.5 : 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: narrow ? '46vw' : undefined }}>{s.meeting?.title || 'Meeting'}</span>
          {narrow ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8a7f70', fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>
              <Ic name="users" size={13} /> {tiles.length}
            </span>
          ) : (
            <span style={{ color: '#8a7f70', fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed(s.elapsedS)}</span>
          )}
          {s.meeting?.locked && !narrow && (
            <span title="Meeting is locked" style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.35)', color: '#e0836f', borderRadius: 99, padding: '4px 11px', fontSize: 11.5, fontWeight: 700 }}>
              <Ic name="lock" size={12} /> Locked
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button className="hv-fg" onClick={() => app.patch(st => ({ view: st.view === 'grid' ? 'speaker' : 'grid' }))} title={s.view === 'grid' ? 'Grid view' : 'Speaker view'} style={{ background: '#1e1a16', border: '1px solid #2e2822', color: '#c9beb0', borderRadius: 99, padding: narrow ? '9px 11px' : '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {narrow
              ? <Ic name={s.view === 'grid' ? 'grid' : 'user'} size={15} />
              : s.view === 'grid' ? <Lbl name="grid" text="Grid" size={15} /> : <Lbl name="user" text="Speaker" size={15} />}
          </button>
          <button onClick={() => app.patch(st => ({ connPop: !st.connPop }))} title="Connection quality" style={{ background: 'none', border: 'none', color: connColor, cursor: 'pointer', padding: 7, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ width: 3, height: 5, background: 'currentColor', borderRadius: 1 }} />
            <span style={{ width: 3, height: 9, background: 'currentColor', borderRadius: 1 }} />
            <span style={{ width: 3, height: 13, background: 'currentColor', borderRadius: 1, opacity: goodConn ? 1 : 0.25 }} />
          </button>
          <button className="hv-fg" onClick={app.copyLink} title="Copy invite link" style={{ background: 'none', border: 'none', color: '#a3988a', cursor: 'pointer', padding: 7 }}><Ic name="link" size={18} /></button>
          {s.connPop && <ConnStats goodConn={goodConn} connColor={connColor} narrow={narrow} />}
        </div>
      </div>

      {/* Video area + side panel */}
      <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, padding: narrow ? '46px 8px 124px' : '56px 12px 86px', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {s.view === 'grid' && !hasScreenShare ? <GridView /> : <SpeakerView />}
          {s.reconnecting && (
            <div style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', zIndex: 30, background: 'rgba(36,31,26,.95)', border: '1px solid rgba(240,180,95,.4)', borderRadius: 14, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
              <span style={{ width: 16, height: 16, border: '2px solid rgba(240,180,95,.3)', borderTopColor: '#e0b45f', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e0b45f' }}>Reconnecting…</div>
                <div style={{ color: '#a3988a', fontSize: 12 }}>Hang tight — we're getting you back.</div>
              </div>
            </div>
          )}
          {s.bursts.map(b => (
            <span key={b.id} style={{ position: 'absolute', left: b.x, bottom: 60, animation: 'floatUp 3.5s ease-out forwards', pointerEvents: 'none', zIndex: 35, color: '#f4eee5' }}>
              {(EMOJIS as string[]).includes(b.name)
                ? <Ic name={b.name as IconName} size={34} />
                : <span style={{ fontSize: 30 }}>{b.name}</span>}
            </span>
          ))}
        </div>
        {s.panel && <SidePanel />}
      </div>

      <ControlBar />

      {/* Recording indicator — visible to everyone, even when the bars fade */}
      {s.recOn && (
        <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 26, display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(36,31,26,.92)', border: '1px solid rgba(224,96,79,.5)', borderRadius: 99, padding: '6px 14px', boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e0604f', animation: 'recBlink 1.2s infinite' }} />
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.09em', color: '#e0836f' }}>REC</span>
        </div>
      )}

      {/* Live captions overlay */}
      {s.captionsOn && s.captionLines.length > 0 && (
        <div style={{ position: 'absolute', left: '50%', bottom: narrow ? 134 : 96, transform: 'translateX(-50%)', zIndex: 34, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', maxWidth: narrow ? 'calc(100% - 20px)' : 'min(70%, 720px)', pointerEvents: 'none' }}>
          {s.captionLines.map(l => (
            <div key={l.id} style={{ background: 'rgba(14,12,10,.8)', backdropFilter: 'blur(4px)', borderRadius: 10, padding: '7px 14px', fontSize: 14.5, lineHeight: 1.4, color: l.interim ? '#c9beb0' : '#f4eee5', textAlign: 'center', animation: 'fadeUp .2s ease' }}>
              <span style={{ color: '#f0a97f', fontWeight: 700, marginRight: 8 }}>{l.name}</span>{l.text}
            </div>
          ))}
        </div>
      )}

      {/* Sharing pill */}
      {s.sharing && (
        <div style={{ position: 'absolute', top: narrow ? 44 : 56, left: '50%', transform: 'translateX(-50%)', zIndex: 30, maxWidth: 'calc(100vw - 20px)', background: '#241f1a', border: '1px solid rgba(111,191,143,.4)', borderRadius: 99, padding: '9px 10px 9px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6fbf8f', fontWeight: 600, minWidth: 0 }}>
            <Ic name={s.shareAudioOnly ? 'speaker' : 'share'} size={15} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.shareAudioOnly ? "You're sharing computer audio"
                : s.shareHasAudio ? "You're sharing your screen and its sound"
                : "You're sharing your screen"}
            </span>
          </span>
          <button onClick={() => app.toggleShare(activeShareMode(s.shareHasAudio, s.shareAudioOnly))} style={{ background: '#c94a38', border: 'none', color: '#fff', borderRadius: 99, padding: '8px 16px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>Stop</button>
        </div>
      )}

      {/* Computer-audio-only share: there is no picture to show, so say so loudly
          instead of parking a black tile on the stage. */}
      {audioShareName && !audioShareIsYou && (
        <div style={{ position: 'absolute', top: narrow ? 44 : 56, left: '50%', transform: 'translateX(-50%)', zIndex: 29, maxWidth: 'calc(100vw - 20px)', background: '#241f1a', border: '1px solid rgba(111,191,143,.4)', borderRadius: 99, padding: '9px 18px', display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <span style={{ display: 'flex', color: '#6fbf8f' }}><Ic name="speaker" size={15} /></span>
          <span style={{ fontSize: 13, color: '#6fbf8f', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{audioShareName} is sharing computer audio</span>
          <span style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 14 }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ width: 3, height: 14, background: '#6fbf8f', borderRadius: 2, transformOrigin: 'bottom', animation: `meterA 1.1s ${i * 0.18}s infinite ease-in-out` }} />
            ))}
          </span>
        </div>
      )}
      {/* Toasts */}
      <div style={{ position: 'absolute', left: narrow ? 10 : 18, right: narrow ? 10 : undefined, bottom: narrow ? 132 : 92, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 36 }}>
        {s.toasts.map(t => (
          <div key={t.id} style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 12, padding: '11px 15px', fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,.4)', animation: 'fadeUp .25s ease', display: 'flex', alignItems: 'center', gap: 12, maxWidth: narrow ? '100%' : 320 }}>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      {/* Shortcuts overlay */}
      {s.shortcutsOpen && (
        <div onClick={() => app.patch({ shortcutsOpen: false })} style={{ position: 'absolute', inset: 0, background: 'rgba(10,8,6,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 20, padding: 28, width: 380, maxWidth: 'calc(100vw - 32px)' }}>
            <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 19, margin: '0 0 16px' }}>Keyboard shortcuts</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5, color: '#c9beb0' }}>
              {[
                ['Mute / unmute', 'M'], ['Camera on / off', 'V'],
                ['Chat', 'C'], ['People', 'P'], ['Close panel', 'Esc'],
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
