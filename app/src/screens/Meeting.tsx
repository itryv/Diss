import { Fragment, memo, useEffect, useRef, useState } from 'react';
import { ConnectionQuality } from 'livekit-client';
import type { Room, Track } from 'livekit-client';
import { devFallbackPeers, useApp } from '../store';
import type { ChatMessage, Peer, ShareMode, VideoQuality } from '../store';
import { GRID_GAP, useGridMeasure, useTiles } from '../tiles';
import type { Tile } from '../tiles';
import { Ic, Lbl } from '../icons';
import type { IconName } from '../icons';
import { MENTION_ALL, fmtElapsed, initialsOf, moveInOrder, splitMentions } from '../util';

/**
 * Touch targets are >= 44px everywhere.
 *
 * The narrow width is 46px on purpose and is load-bearing: the phone control bar
 * must be ONE row at 360px CSS px. Budget, with 10px of padding a side:
 *   5 icon buttons x 46 = 230, 5 gaps x 6 = 30, Leave ~70  ->  330 <= 340.
 * Anything wider wraps, and a wrapped bar strands buttons off the left edge.
 */
const ctrlBtnFor = (narrow: boolean): React.CSSProperties => ({
  height: narrow ? 48 : 50,
  minWidth: narrow ? 46 : 58,
  borderRadius: 14,
  border: '1px solid #2e2822',
  color: '#f4eee5',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  flexShrink: 0,
});

/** The control bar's own height, excluding the bottom safe-area inset. */
const BAR_H_NARROW = 70; // 10 pad + 48 button + 12 pad
const BAR_H_WIDE = 82; //  14 pad + 50 button + 18 pad
/** The top bar's own height, excluding the top safe-area inset. */
const TOPBAR_H_NARROW = 46;
const TOPBAR_H_WIDE = 56;

/**
 * A popup hanging off a control-bar button.
 *
 * On desktop it stays anchored to its button. On a phone it does NOT: the bar is
 * only as wide as the viewport, so a 250px menu anchored `right: 0` to a button
 * near the left edge overflows the viewport and gets clipped (every label lost
 * its first half). Narrow therefore pins the popup to the viewport itself —
 * inset by the safe area on both sides — so no anchor position can push it out.
 */
const popupStyle = (narrow: boolean, anchored: React.CSSProperties): React.CSSProperties =>
  narrow
    ? {
        position: 'fixed',
        left: 'calc(10px + var(--sal))',
        right: 'calc(10px + var(--sar))',
        bottom: `calc(${BAR_H_NARROW + 6}px + var(--sab))`,
        width: 'auto',
        maxWidth: 'none',
        maxHeight: `calc(100dvh - ${BAR_H_NARROW + 28}px - var(--sat) - var(--sab))`,
        overflowY: 'auto',
        transform: 'none',
      }
    : anchored;

/**
 * A popup that lives INSIDE the side panel (recipient picker, @mention list).
 *
 * `popupStyle` is for popups hanging off the control bar — it pins them to the
 * viewport just above the bar, which is the wrong place for something anchored
 * to the chat composer. These are bounded by the panel's own box instead (10px
 * in from each edge of a panel that is itself at most the viewport wide), so
 * they cannot overflow at 360px either.
 */
const panelPopup: React.CSSProperties = {
  position: 'absolute', left: 10, right: 10, bottom: '100%', marginBottom: 6,
  background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6,
  boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 50, maxHeight: '44vh', overflowY: 'auto',
};

/**
 * Private messages get their own colour family — nothing else in the app is
 * violet — plus a dashed edge and an explicit "Private to/from" line. Three
 * independent signals, so a DM can never be read as something everyone saw.
 */
const PRIV_FG = '#c3aef5';
const PRIV_EDGE = 'rgba(158,134,232,.65)';
const PRIV_BG = 'rgba(126,102,209,.16)';
const PRIV_BG_MINE = 'rgba(126,102,209,.34)';

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
interface TileProps {
  tile: Tile; w: number; h: number; cols?: number;
  /** This tile is the one being dragged. */
  dragging?: boolean;
  /** Show the drop indicator on this edge while a drag hovers it. */
  dropSide?: '' | 'before' | 'after';
  /** Any drag is in progress — tiles stop swallowing pointer events. */
  dragMode?: boolean;
}

function sameTile(a: TileProps, b: TileProps) {
  if (a.w !== b.w || a.h !== b.h || a.cols !== b.cols
    || a.dragging !== b.dragging || a.dropSide !== b.dropSide || a.dragMode !== b.dragMode) return false;
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

const GridTile = memo(function GridTile({ tile, w, h, cols = 0, dragging, dropSide, dragMode }: TileProps) {
  // `cols > 0` only happens on the very first frame, before the container has
  // been measured — fall back to an even share of the row.
  const sized: React.CSSProperties = w > 0
    ? { width: w, height: h, flex: '0 0 auto' }
    : { width: `calc((100% - ${GRID_GAP * Math.max(0, cols - 1)}px) / ${Math.max(1, cols)})`, aspectRatio: '16 / 9', flex: '0 0 auto' };
  return (
    <div
      className="tile"
      data-tile-key={tile.identity}
      style={{
        position: 'relative', ...sized, background: '#17130f', borderRadius: 16, overflow: 'hidden',
        minHeight: 0, boxShadow: dragging ? '0 0 0 2px rgba(240,139,95,.7)' : tile.ring,
        transition: 'box-shadow .3s, opacity .15s', contain: 'layout paint',
        opacity: dragging ? 0.35 : 1,
        // Pointer-drag needs the browser to stop treating a finger on a tile as
        // a scroll/zoom gesture; the grid itself never scrolls, so nothing is lost.
        touchAction: 'none',
        cursor: dragMode ? 'grabbing' : undefined,
      }}
    >
      {dropSide && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 6, bottom: 6, [dropSide === 'before' ? 'left' : 'right']: 2,
            width: 4, borderRadius: 3, background: '#f08b5f', boxShadow: '0 0 12px rgba(240,139,95,.9)', zIndex: 12,
          }}
        />
      )}
      <TileMedia tile={tile} />
      <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 6, maxWidth: '75%' }}>
        <span style={{ background: 'rgba(14,12,10,.65)', backdropFilter: 'blur(4px)', borderRadius: 8, padding: '4px 10px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.label}</span>
        {tile.badge && <span style={{ background: 'rgba(240,139,95,.2)', color: '#f0a97f', borderRadius: 6, padding: '3px 7px', fontSize: 10.5, fontWeight: 700 }}>{tile.badge}</span>}
      </div>
      {tile.muted && <MutedBadge />}
      {tile.hand && <HandBadge q={tile.handQ} />}
      <div className="hv-reveal" style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Affordance only — the drag starts anywhere on the tile. It is not a
            button on purpose: a button here would swallow the pointerdown. */}
        <span title="Drag to rearrange" style={{ background: 'rgba(14,12,10,.7)', color: '#a3988a', borderRadius: 8, padding: '6px 5px', display: 'flex', cursor: 'grab' }}>
          <Ic name="grip" size={13} />
        </span>
        <button onClick={tile.pinToggle} title="Pin" style={{ background: 'rgba(14,12,10,.7)', border: 'none', color: '#f4eee5', borderRadius: 8, padding: '6px 9px', fontSize: 12, cursor: 'pointer' }}>
          {tile.pinned ? <Lbl name="pin" text="Unpin" size={13} /> : <Ic name="pin" size={13} />}
        </button>
      </div>
    </div>
  );
}, sameTile);

/** Live drag state — what's moving, where the pointer is, where it would land. */
interface DragState { key: string; x: number; y: number; over: string; side: 'before' | 'after'; }
/** Everything the drag needs that must NOT trigger a render on every move. */
interface DragStart { key: string; x0: number; y0: number; pointerId: number; active: boolean; }

const DRAG_SLOP = 6;

function GridView() {
  const app = useApp();
  const { gridTiles, gridCols, gridTileW, gridTileH, gridPage, gridPages, order } = useTiles();
  const measure = useGridMeasure();
  const rowRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<DragStart | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  /** Which tile is under (x, y)? Falls back to the nearest centre off-grid. */
  const hitTest = (x: number, y: number): { key: string; side: 'before' | 'after' } | null => {
    const row = rowRef.current;
    if (!row) return null;
    const els = Array.from(row.querySelectorAll<HTMLElement>('[data-tile-key]'));
    let best: { key: string; side: 'before' | 'after' } | null = null;
    let bestDist = Infinity;
    for (const el of els) {
      const key = el.dataset.tileKey!;
      const r = el.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const dist = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (inside) return { key, side: x > r.left + r.width / 2 ? 'after' : 'before' };
      if (dist < bestDist) { bestDist = dist; best = { key, side: x > r.left + r.width / 2 ? 'after' : 'before' }; }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || gridTiles.length < 2) return;
    const target = e.target as HTMLElement;
    // The pin button (and anything else clickable) keeps its click.
    if (target.closest('button')) return;
    const tileEl = target.closest<HTMLElement>('[data-tile-key]');
    if (!tileEl) return;
    startRef.current = { key: tileEl.dataset.tileKey!, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, active: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = startRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    if (!st.active) {
      // Slop before we commit: a tap, or a click on the tile, must not become a drag.
      if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < DRAG_SLOP) return;
      st.active = true;
      // Capture keeps a finger that slides off the grid (or off the window)
      // delivering moves to us, so a drag can always be finished or cancelled.
      try { rowRef.current?.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
    const hit = hitTest(e.clientX, e.clientY);
    setDrag({ key: st.key, x: e.clientX, y: e.clientY, over: hit?.key ?? '', side: hit?.side ?? 'before' });
  };

  const endDrag = (commit: boolean) => {
    const st = startRef.current;
    startRef.current = null;
    if (st?.active && commit && drag && drag.over && drag.over !== drag.key) {
      app.setTileOrder(moveInOrder(order, drag.key, drag.over, drag.side));
    }
    setDrag(null);
  };

  const dragTile = drag ? gridTiles.find(t => t.identity === drag.key) : undefined;
  const pageBtn: React.CSSProperties = { position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 15, width: 36, height: 56, borderRadius: 12, background: 'rgba(30,26,22,.9)', border: '1px solid #362f28', color: '#c9beb0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const solved = gridTileW > 0;
  return (
    // The page indicator needs its own room — padding on the measured element is
    // outside the ResizeObserver's content box, so the solver accounts for it free.
    <div ref={measure} style={{ height: '100%', position: 'relative', overflow: 'hidden', paddingBottom: gridPages > 1 ? 26 : 0 }}>
      {/* flex-wrap rather than a grid: with exact tile sizes from the solver each
          row holds `gridCols` tiles, and a short last row centres itself. */}
      <div
        ref={rowRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        style={{ height: '100%', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', gap: GRID_GAP, userSelect: drag ? 'none' : undefined }}
      >
      {gridTiles.map(p => (
        <GridTile
          key={p.key}
          tile={p}
          w={gridTileW}
          h={gridTileH}
          cols={solved ? 0 : gridCols}
          dragging={drag?.key === p.identity}
          dropSide={drag && drag.over === p.identity && drag.key !== p.identity ? drag.side : ''}
          dragMode={!!drag}
        />
      ))}
      </div>
      {/* Ghost under the finger/cursor. Deliberately not the live video: moving
          a <video> element mid-drag would tear its track down and restart it. */}
      {drag && dragTile && (
        <div
          aria-hidden
          style={{
            position: 'fixed', left: drag.x, top: drag.y, transform: 'translate(-50%, -50%) rotate(-1.5deg)',
            width: Math.min(220, Math.max(120, gridTileW || 180)), pointerEvents: 'none', zIndex: 70,
            background: 'rgba(36,31,26,.96)', border: '1px solid rgba(240,139,95,.6)', borderRadius: 14,
            padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 18px 50px rgba(0,0,0,.6)',
          }}
        >
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: dragTile.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, fontFamily: "'Bricolage Grotesque',sans-serif", flexShrink: 0 }}>{dragTile.initials}</span>
          <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dragTile.short}</span>
          <span style={{ color: '#f0a97f', flexShrink: 0, display: 'flex' }}><Ic name="grip" size={14} /></span>
        </div>
      )}
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

/** Chat text with @mentions painted as chips. Mentions of ME are filled in, not tinted. */
function MessageText({ text, targets, me, onOrange }: { text: string; targets: { identity: string; name: string }[]; me: string; onOrange: boolean }) {
  return (
    <>
      {splitMentions(text, targets).map((seg, i) => {
        if (!seg.mention) return <Fragment key={i}>{seg.text}</Fragment>;
        const pingsMe = seg.identity === MENTION_ALL || (!!me && seg.identity === me);
        const style: React.CSSProperties = onOrange
          ? { background: 'rgba(36,18,9,.16)', color: '#241209', border: '1px solid rgba(36,18,9,.25)' }
          : pingsMe
            ? { background: '#f08b5f', color: '#241209' }
            : { background: 'rgba(240,139,95,.18)', color: '#f0a97f' };
        return (
          <span key={i} style={{ ...style, borderRadius: 6, padding: '1px 5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{seg.text}</span>
        );
      })}
    </>
  );
}

/** One chat message. Public, private and "mentions you" are three distinct looks. */
function MessageRow({ m, targets, me }: { m: ChatMessage; targets: { identity: string; name: string }[]; me: string }) {
  const priv = !!m.toIdentity;
  const ping = !!m.mentionsMe;
  const tag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: m.mine ? 'flex-end' : 'flex-start', opacity: m.history ? 0.75 : 1 }}>
      <div style={{ fontSize: 11.5, color: '#8a7f70', fontWeight: 600 }}>
        {m.who}
        {m.ts !== undefined && <span style={{ color: '#6f665b', fontWeight: 400, marginLeft: 6 }}>{new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
      </div>
      {priv && (
        <div style={{ ...tag, color: PRIV_FG }}>
          <Ic name="lock" size={11} />
          {m.mine ? `Private to ${m.toName ?? 'them'}` : `Private from ${m.who}`}
        </div>
      )}
      {ping && !m.mine && (
        <div style={{ ...tag, color: '#f0a97f' }}><Ic name="at" size={11} /> Mentioned you</div>
      )}
      <div style={{
        ...(priv
          ? { background: m.mine ? PRIV_BG_MINE : PRIV_BG, color: '#f4eee5', border: `1px dashed ${PRIV_EDGE}` }
          : { background: m.mine ? '#f08b5f' : '#241f1a', color: m.mine ? '#241209' : '#f4eee5', border: '1px solid transparent' }),
        borderRadius: 14, padding: '9px 13px', fontSize: 13.5, lineHeight: 1.45, maxWidth: '85%',
        boxShadow: ping ? '0 0 0 1.5px rgba(240,139,95,.75)' : undefined,
      }}>
        <MessageText text={m.text} targets={targets} me={me} onOrange={m.mine && !priv} />
      </div>
    </div>
  );
}

/** The panel's on/off switch — same shape everywhere it appears. */
function SwitchRow({ label, hint, on, onToggle, disabled }: { label: string; hint?: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, background: 'none', border: 'none', textAlign: 'left', padding: '6px 4px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, color: '#c9beb0', fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 11, color: '#6f665b', marginTop: 2 }}>{hint}</span>}
      </span>
      <span style={{ width: 38, height: 22, borderRadius: 99, background: on ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#f4eee5', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

interface MentionOption { identity: string; name: string; hint: string; }

function SidePanel() {
  const app = useApp();
  const s = app.s;
  const { tiles } = useTiles();
  const chatEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // @mention autocomplete: index of the '@' being completed, and the query after it.
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [mentionQ, setMentionQ] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);
  const [toOpen, setToOpen] = useState(false);

  const roster: Peer[] = s.devMode ? devFallbackPeers(s) : s.peers;
  const others = roster.filter(p => !p.isLocal);
  const targets = roster.map(p => ({ identity: p.identity, name: p.name }));
  const toPeer = s.chatTo ? others.find(p => p.identity === s.chatTo) : undefined;
  const canChat = s.canChat;

  const options: MentionOption[] = mentionAt === null ? [] : [
    { identity: MENTION_ALL, name: 'all', hint: 'Notify everyone here' },
    ...roster.map(p => ({ identity: p.identity, name: p.name, hint: p.isLocal ? 'you' : p.isHost ? 'host' : p.isCoHost ? 'co-host' : '' })),
  ].filter(o => !mentionQ || o.name.toLowerCase().includes(mentionQ)).slice(0, 6);

  /** Re-read the caret after every edit so "@" mid-sentence works too. */
  const syncMention = (value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    const before = at > 0 ? upto[at - 1] : '';
    const q = upto.slice(at + 1);
    if (at < 0 || (before && !/\s/.test(before)) || q.includes('@') || q.length > 24 || (q.match(/ /g)?.length ?? 0) > 1) {
      setMentionAt(null);
      return;
    }
    setMentionAt(at);
    setMentionQ(q.toLowerCase());
    setMentionIdx(0);
  };

  const pickMention = (o: MentionOption) => {
    if (mentionAt === null) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? s.chatInput.length;
    const label = o.identity === MENTION_ALL ? 'all' : o.name;
    const next = `${s.chatInput.slice(0, mentionAt)}@${label} ${s.chatInput.slice(caret)}`.slice(0, 2000);
    const pos = mentionAt + label.length + 2;
    app.patch({ chatInput: next });
    setMentionAt(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  };

  const composerKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionAt !== null && options.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(options[mentionIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionAt(null); return; }
    }
    if (e.key === 'Enter') { setMentionAt(null); app.sendChat(); }
  };

  const menuItem: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44,
    textAlign: 'left', border: 'none', padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
  };
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [s.messages.length]);
  // Narrow: a full-screen sheet over the video instead of a 340px sidebar that
  // would push the page wider than the viewport.
  const sheet: React.CSSProperties = s.isNarrow
    ? { position: 'fixed', inset: 0, width: '100%', maxWidth: '100%', borderRadius: 0, border: 'none', zIndex: 45 }
    : { width: 340, flexShrink: 0, borderRadius: 18, border: '1px solid #2a241e' };
  return (
    <div style={{ background: '#1a1613', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'fadeUp .25s ease', ...sheet }}>
      <div style={{ display: 'flex', padding: s.isNarrow ? 'calc(12px + var(--sat)) calc(10px + var(--sar)) 2px calc(10px + var(--sal))' : '10px 10px 0', gap: 4, alignItems: 'center' }}>
        <button onClick={() => app.patch({ tab: 'chat', unread: 0 })} style={{ flex: 1, minHeight: 44, background: s.tab === 'chat' ? '#2a241e' : 'none', color: s.tab === 'chat' ? '#f4eee5' : '#8a7f70', border: 'none', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>Chat</button>
        <button onClick={() => app.patch({ tab: 'people' })} style={{ flex: 1, minHeight: 44, background: s.tab === 'people' ? '#2a241e' : 'none', color: s.tab === 'people' ? '#f4eee5' : '#8a7f70', border: 'none', borderRadius: 10, padding: 10, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>People · {tiles.length}</button>
        <button className="hv-fg" onClick={() => app.patch({ panel: false })} title="Close panel" style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic name="close" size={s.isNarrow ? 20 : 15} /></button>
      </div>
      {s.tab === 'chat' ? (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Breakout chat is live-only: history is stored per MEETING, so
                persisting it here would splice side-room talk into the main
                transcript. Say so rather than letting people assume it's kept. */}
            {s.inBreakout ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(240,139,95,.08)', border: '1px solid rgba(240,139,95,.28)', borderRadius: 10, padding: '9px 11px', color: '#f0a97f', fontSize: 11.5, lineHeight: 1.5 }}>
                <span style={{ flexShrink: 0, display: 'flex', paddingTop: 1 }}><Ic name="breakout" size={13} /></span>
                <span>
                  <strong>Breakout: {s.inBreakout.name}</strong><br />
                  Only people in this room see these messages, and they aren't saved with the meeting.
                </span>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#6f665b', fontSize: 11.5, padding: '4px 0' }}>Messages are saved with this meeting</div>
            )}
            {s.messages.map((m, i) => {
              const lastHistory = m.history && !s.messages[i + 1]?.history;
              return (
                <Fragment key={i}>
                  <MessageRow m={m} targets={targets} me={s.identity} />
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
          <div style={{ padding: s.isNarrow ? '10px calc(12px + var(--sar)) calc(12px + var(--sab)) calc(12px + var(--sal))' : '10px 12px 12px', borderTop: '1px solid #2a241e', display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
            {!canChat && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(224,180,95,.1)', border: '1px solid rgba(224,180,95,.32)', color: '#e0b45f', borderRadius: 10, padding: '9px 11px', fontSize: 12, lineHeight: 1.45 }}>
                <Ic name="lock" size={14} /> The host has turned off chat for participants
              </div>
            )}
            {/* Who this message goes to. Everyone by default — a DM is always a
                deliberate choice, and the composer says so until you clear it. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => { setToOpen(o => !o); setMentionAt(null); }}
                aria-expanded={toOpen}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, minHeight: 34, flex: 1, minWidth: 0,
                  background: toPeer ? PRIV_BG : '#1c1815',
                  border: `1px ${toPeer ? 'dashed' : 'solid'} ${toPeer ? PRIV_EDGE : '#3a332b'}`,
                  color: toPeer ? PRIV_FG : '#8a7f70',
                  borderRadius: 10, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {toPeer && <Ic name="lock" size={12} />}
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  To: {toPeer ? `${toPeer.name} (private)` : 'Everyone'}
                </span>
                <Ic name={toOpen ? 'chevronDown' : 'chevronUp'} size={12} />
              </button>
              {toPeer && (
                <button className="hv-fg" onClick={() => app.setChatRecipient(null)} title="Message everyone instead" style={{ background: 'none', border: '1px solid #3a332b', color: '#8a7f70', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <Ic name="close" size={13} />
                </button>
              )}
            </div>

            {toOpen && (
              <div style={panelPopup}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '6px 10px 4px' }}>Send to</div>
                <button
                  className="hv-bg-2e"
                  onClick={() => { app.setChatRecipient(null); setToOpen(false); }}
                  style={{ ...menuItem, background: s.chatTo ? 'none' : '#2e2822', color: '#f4eee5' }}
                >
                  <Ic name="users" size={16} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}>Everyone</span>
                  {!s.chatTo && <Ic name="check" size={15} />}
                </button>
                {others.map(p => (
                  <button
                    key={p.identity}
                    className="hv-bg-2e"
                    onClick={() => { app.setChatRecipient(p.identity); setToOpen(false); }}
                    style={{ ...menuItem, background: s.chatTo === p.identity ? '#2e2822' : 'none', color: '#f4eee5' }}
                  >
                    <Ic name="lock" size={15} style={{ color: PRIV_FG }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: PRIV_FG }}>Private message</span>
                    </span>
                    {s.chatTo === p.identity && <Ic name="check" size={15} />}
                  </button>
                ))}
              </div>
            )}

            {mentionAt !== null && options.length > 0 && (
              <div style={panelPopup}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '6px 10px 4px' }}>Mention someone</div>
                {options.map((o, i) => (
                  <button
                    key={o.identity}
                    className="hv-bg-2e"
                    // mousedown, not click: the input must not lose focus first.
                    onMouseDown={e => { e.preventDefault(); pickMention(o); }}
                    onTouchStart={e => { e.preventDefault(); pickMention(o); }}
                    onMouseEnter={() => setMentionIdx(i)}
                    style={{ ...menuItem, background: i === mentionIdx ? '#2e2822' : 'none', color: '#f4eee5' }}
                  >
                    <Ic name={o.identity === MENTION_ALL ? 'users' : 'at'} size={15} style={{ color: '#f0a97f' }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{o.name}</span>
                      {o.hint && <span style={{ display: 'block', fontSize: 11, color: '#8a7f70' }}>{o.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputRef}
                value={s.chatInput}
                maxLength={2000}
                disabled={!canChat}
                onChange={e => {
                  const value = e.target.value.slice(0, 2000);
                  app.patch({ chatInput: value });
                  syncMention(value, e.target.selectionStart ?? value.length);
                }}
                onKeyUp={e => syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                onClick={e => syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                onBlur={() => window.setTimeout(() => setMentionAt(null), 120)}
                onKeyDown={composerKey}
                placeholder={!canChat ? 'Chat is off' : toPeer ? `Private message to ${toPeer.name}…` : 'Message everyone — @ to mention'}
                style={{
                  flex: 1, minWidth: 0, background: '#1c1815',
                  border: `1px ${toPeer ? 'dashed' : 'solid'} ${toPeer ? PRIV_EDGE : '#3a332b'}`,
                  borderRadius: 11, padding: '11px 13px', color: '#f4eee5', fontSize: 13.5,
                  fontFamily: 'inherit', outline: 'none', opacity: canChat ? 1 : 0.5,
                }}
              />
              <button
                onClick={() => { setMentionAt(null); app.sendChat(); }}
                disabled={!canChat}
                title={toPeer ? `Send privately to ${toPeer.name}` : 'Send to everyone'}
                style={{ background: toPeer ? '#8f79d8' : '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: '0 16px', fontWeight: 700, cursor: canChat ? 'pointer' : 'not-allowed', opacity: canChat ? 1 : 0.5, flexShrink: 0 }}
              >
                <Ic name="send" size={16} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, paddingBottom: 'calc(14px + var(--sab))' }}>
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
              {tiles.map(p => {
                const peer = roster.find(r => r.identity === p.identity);
                const mayShare = peer ? peer.canShareScreen : true;
                return (
                <div key={p.key} className="hv-bg-21" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderRadius: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, fontFamily: "'Bricolage Grotesque',sans-serif", flexShrink: 0 }}>{p.initials}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>
                    {p.badge && <div style={{ fontSize: 10.5, color: '#f0a97f', fontWeight: 700 }}>{p.badge}</div>}
                  </div>
                  {p.hand && <span style={{ color: '#f0b45f', flexShrink: 0 }}><Ic name="hand" size={14} /></span>}
                  <span style={{ color: p.muted ? '#e0836f' : '#6fbf8f', flexShrink: 0 }}><Ic name={p.muted ? 'micOff' : 'mic'} size={14} /></span>
                  {!p.you && (
                    <button
                      className="hv-fg"
                      onClick={() => app.setChatRecipient(p.identity)}
                      title={`Message ${p.short} privately`}
                      style={{ background: 'none', border: 'none', color: s.chatTo === p.identity ? PRIV_FG : '#6f665b', cursor: 'pointer', padding: 3, flexShrink: 0 }}
                    >
                      <Ic name="chat" size={14} />
                    </button>
                  )}
                  {(s.isHost || s.isCoHost) && !p.you && !s.devMode && (
                    <button
                      className="hv-fg"
                      onClick={() => app.moderatePeer(p.identity, mayShare ? 'deny-share' : 'allow-share')}
                      title={mayShare ? `Stop ${p.short} sharing their screen` : `Let ${p.short} share their screen`}
                      style={{ background: 'none', border: 'none', color: mayShare ? '#6f665b' : '#e0836f', cursor: 'pointer', padding: 3, flexShrink: 0 }}
                    >
                      <Ic name={mayShare ? 'share' : 'shareOff'} size={15} />
                    </button>
                  )}
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
                );
              })}
            </div>
          </div>
          {(s.isHost || s.isCoHost) && !s.devMode && (
            <div style={{ padding: s.isNarrow ? '12px calc(12px + var(--sar)) calc(12px + var(--sab)) calc(12px + var(--sal))' : 12, borderTop: '1px solid #2a241e', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Host controls — room-wide settings, enforced in the LiveKit token
                  (contract v4 §2), applied live to everyone already in the room. */}
              {s.hostPanelOpen && (
                <div style={{ background: '#1c1815', border: '1px solid #2f2820', borderRadius: 12, padding: '4px 10px 8px' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '8px 4px 2px' }}>Host controls</div>
                  <SwitchRow
                    label="Participants can share their screen"
                    on={s.meeting?.allowShare !== false}
                    disabled={!s.isHost}
                    onToggle={() => app.setMeetingFlag({ allowShare: s.meeting?.allowShare === false })}
                  />
                  <SwitchRow
                    label="Participants can chat"
                    on={s.meeting?.allowChat !== false}
                    disabled={!s.isHost}
                    onToggle={() => app.setMeetingFlag({ allowChat: s.meeting?.allowChat === false })}
                  />
                  <SwitchRow
                    label="Participants can unmute themselves"
                    on={s.meeting?.allowUnmute !== false}
                    disabled={!s.isHost}
                    onToggle={() => app.setMeetingFlag({ allowUnmute: s.meeting?.allowUnmute === false })}
                  />
                  <SwitchRow
                    label="Waiting room for new guests"
                    on={!!s.meeting?.waitingRoom}
                    disabled={!s.isHost}
                    onToggle={() => app.setMeetingFlag({ waitingRoom: !s.meeting?.waitingRoom })}
                  />
                  <div style={{ fontSize: 11, color: '#6f665b', lineHeight: 1.5, padding: '6px 4px 0', borderTop: '1px solid #2a241e', marginTop: 4 }}>
                    {s.isHost
                      ? 'Hosts and co-hosts are never restricted. Use the icons on a row to allow or deny one person’s screen share.'
                      : 'Only the host can change these. You can still allow or deny one person’s screen share from their row.'}
                  </div>
                </div>
              )}
              <button
                className="hv-bg-2a"
                onClick={() => app.patch(st => ({ hostPanelOpen: !st.hostPanelOpen }))}
                aria-expanded={s.hostPanelOpen}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: s.hostPanelOpen ? '#2a241e' : '#241f1a', border: '1px solid #362f28', color: '#f4eee5', borderRadius: 10, padding: '10px 12px', minHeight: 44, fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
              >
                <Lbl name="gear" text="Host controls" size={14} />
                <Ic name={s.hostPanelOpen ? 'chevronDown' : 'chevronUp'} size={13} />
              </button>
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Screen / screen+audio / computer-audio-only, with the live mode ticked.
 *  Shared by the desktop share dropdown and the narrow "More" sheet. */
function ShareModeList({ onPick, onStop, sharing, mode, blocked }: { onPick: (m: ShareMode) => void; onStop: () => void; sharing: boolean; mode: ShareMode; blocked?: boolean }) {
  return (
    <>
      {blocked && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#e0b45f', fontSize: 12, lineHeight: 1.45, padding: '8px 11px' }}>
          <span style={{ flexShrink: 0, paddingTop: 1 }}><Ic name="lock" size={14} /></span>
          The host has turned off screen sharing
        </div>
      )}
      {SHARE_MODES.map(m => {
        const on = sharing && mode === m.mode;
        return (
          <button
            key={m.mode}
            className="hv-bg-2e"
            onClick={() => onPick(m.mode)}
            disabled={blocked}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, textAlign: 'left', background: on ? '#2e2822' : 'none', border: 'none', color: on ? '#6fbf8f' : '#f4eee5', padding: '9px 11px', borderRadius: 9, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.4 : 1 }}
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
    </>
  );
}

function ShareMenu(props: { onPick: (m: ShareMode) => void; onStop: () => void; sharing: boolean; mode: ShareMode; narrow: boolean }) {
  return (
    <div style={{ ...popupStyle(props.narrow, { position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', width: 262, maxWidth: '92vw' }), background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
      <ShareModeList {...props} />
    </div>
  );
}

// ── Breakout rooms (contract v4 §3) ──────────────────────────────────────────

const cardBtn: React.CSSProperties = {
  minHeight: 40, borderRadius: 10, padding: '9px 13px', fontWeight: 600, fontSize: 12.5,
  cursor: 'pointer', border: '1px solid #362f28', background: '#241f1a', color: '#f4eee5',
};
const primaryBtn: React.CSSProperties = { ...cardBtn, background: '#f08b5f', border: 'none', color: '#241209', fontWeight: 700 };
const fieldStyle: React.CSSProperties = {
  background: '#1c1815', border: '1px solid #3a332b', borderRadius: 10, padding: '9px 11px',
  color: '#f4eee5', fontSize: 13, fontFamily: 'inherit', outline: 'none', minWidth: 0, width: '100%',
};
const sectionHead: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b',
};

/**
 * Plan, open, visit and close breakout rooms.
 *
 * Opened from the More menu (or the breakout pill) — never from the control
 * bar, whose narrow layout is a strict one-row budget.
 */
function BreakoutPanel() {
  const app = useApp();
  const s = app.s;
  const roster: Peer[] = s.devMode ? devFallbackPeers(s) : s.peers;
  // The planner renders in the dev preview too (the "Open rooms" button is
  // disabled there) so the layout can be checked without a real call.
  const canManage = s.isHost || s.isCoHost;
  const open = s.breakoutsOpen;

  const nameOf = (identity: string) =>
    roster.find(p => p.identity === identity)?.name
    ?? s.breakouts.flatMap(b => b.participants).find(p => p.identity === identity)?.displayName
    ?? identity;

  const assignable = roster.filter(p => !p.isLocal);
  const assignedIds = new Set(s.breakoutDraft.flatMap(r => r.identities));
  const unassigned = assignable.filter(p => !assignedIds.has(p.identity));
  const roomOf = (identity: string) => s.breakoutDraft.findIndex(r => r.identities.includes(identity));

  const close = () => app.patch({ breakoutUi: false });

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,8,6,.72)', display: 'flex',
        alignItems: s.isNarrow ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 62,
        padding: `calc(12px + var(--sat)) calc(12px + var(--sar)) calc(12px + var(--sab)) calc(12px + var(--sal))`,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1613', border: '1px solid #3a332b', borderRadius: 20, padding: s.isNarrow ? 16 : 22,
          width: 480, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 14, animation: 'fadeUp .2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#f0a97f', display: 'flex' }}><Ic name="breakout" size={18} /></span>
          <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 18, margin: 0, flex: 1, minWidth: 0 }}>Breakout rooms</h3>
          <button className="hv-fg" onClick={close} title="Close" style={{ background: 'none', border: 'none', color: '#6f665b', cursor: 'pointer', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ic name="close" size={16} /></button>
        </div>

        {s.devMode && (
          <div style={{ color: '#e0b45f', fontSize: 12, lineHeight: 1.5, background: 'rgba(224,180,95,.1)', border: '1px solid rgba(224,180,95,.32)', borderRadius: 10, padding: '9px 11px' }}>
            Breakout rooms need a real meeting connection — this is the preview.
          </div>
        )}

        {/* ── The rooms are open: the live list ── */}
        {open ? (
          <>
            <div style={{ color: '#a3988a', fontSize: 12.5, lineHeight: 1.5 }}>
              {s.inBreakout
                ? <>You're in <strong style={{ color: '#f4eee5' }}>{s.inBreakout.name}</strong>. Chat in a breakout is live only — it isn't saved with the meeting.</>
                : "You're in the main meeting."}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.breakouts.map(b => {
                const here = s.inBreakout?.idx === b.idx;
                const mine = b.participants.some(p => p.identity === s.identity);
                return (
                  <div key={b.id} style={{ background: here ? 'rgba(240,139,95,.1)' : '#241f1a', border: `1px solid ${here ? 'rgba(240,139,95,.45)' : '#2f2820'}`, borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {b.name}
                        {here && <span style={{ background: 'rgba(240,139,95,.2)', color: '#f0a97f', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 800 }}>YOU'RE HERE</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#8a7f70', marginTop: 3, lineHeight: 1.5 }}>
                        {b.participants.length === 0
                          ? 'Nobody assigned'
                          : `${b.participants.length} assigned · ${b.participants.map(p => p.displayName).join(', ')}`}
                      </div>
                    </div>
                    {(canManage || mine) && !here && (
                      <button
                        className="hv-bg-2e"
                        disabled={s.breakoutBusy}
                        onClick={() => app.joinBreakout(canManage ? b.idx : undefined)}
                        style={{ ...cardBtn, flexShrink: 0, opacity: s.breakoutBusy ? 0.5 : 1 }}
                      >
                        {s.breakoutBusy ? 'Moving…' : 'Join'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {s.inBreakout && (
              <button className="hv-bg-2e" disabled={s.breakoutBusy} onClick={() => app.returnToMain()} style={{ ...cardBtn, opacity: s.breakoutBusy ? 0.5 : 1 }}>
                <Lbl name="arrowBack" text="Return to the main room" size={14} />
              </button>
            )}

            {canManage && (
              <>
                <div style={{ borderTop: '1px solid #2a241e', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={sectionHead}>Announce</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={s.breakoutAnnounce}
                      maxLength={200}
                      onChange={e => app.patch({ breakoutAnnounce: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') app.announceBreakout(); }}
                      placeholder="Five minutes left…"
                      style={fieldStyle}
                    />
                    <button className="hv-primary" onClick={app.announceBreakout} disabled={!s.breakoutAnnounce.trim()} style={{ ...primaryBtn, flexShrink: 0, opacity: s.breakoutAnnounce.trim() ? 1 : 0.5 }}>Send</button>
                  </div>
                  <div style={{ fontSize: 11, color: '#6f665b', lineHeight: 1.5 }}>
                    Reaches everyone in the room you're in right now{s.inBreakout ? ` (“${s.inBreakout.name}”)` : ' (the main room)'}. Visit a room to announce there.
                  </div>
                </div>
                <button className="hv-danger-soft" disabled={s.breakoutBusy} onClick={() => app.closeBreakouts()} style={{ ...cardBtn, background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.4)', color: '#e0836f', fontWeight: 700, opacity: s.breakoutBusy ? 0.5 : 1 }}>
                  Close all rooms — bring everyone back
                </button>
              </>
            )}
          </>
        ) : canManage ? (
          /* ── Planning ── */
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: '#c9beb0', fontWeight: 600 }}>Rooms</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="hv-bg-2e" onClick={() => app.setBreakoutRoomCount(s.breakoutDraft.length - 1)} title="One fewer room" style={{ ...cardBtn, minWidth: 40, padding: '9px 0', textAlign: 'center' }}>−</button>
                <span style={{ minWidth: 26, textAlign: 'center', fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{s.breakoutDraft.length}</span>
                <button className="hv-bg-2e" onClick={() => app.setBreakoutRoomCount(s.breakoutDraft.length + 1)} title="One more room" style={{ ...cardBtn, minWidth: 40, padding: '9px 0', textAlign: 'center' }}>+</button>
              </div>
              <button className="hv-bg-2e" onClick={app.autoAssignBreakouts} style={{ ...cardBtn, marginLeft: 'auto' }}>Auto-assign evenly</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {s.breakoutDraft.map((room, i) => (
                <div key={i} style={{ background: '#241f1a', border: '1px solid #2f2820', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    value={room.name}
                    maxLength={60}
                    onChange={e => app.renameBreakoutRoom(i, e.target.value)}
                    placeholder={`Room ${i + 1}`}
                    style={{ ...fieldStyle, fontWeight: 700 }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {room.identities.length === 0 && <span style={{ fontSize: 11.5, color: '#6f665b' }}>Nobody yet — assign people below.</span>}
                    {room.identities.map(id => (
                      <button
                        key={id}
                        className="hv-bg-2e"
                        onClick={() => app.assignToBreakout(id, null)}
                        title="Remove from this room"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#2a241e', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 99, padding: '5px 8px 5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 30, maxWidth: '100%' }}
                      >
                        <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(id)}</span>
                        <Ic name="close" size={11} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={sectionHead}>Not assigned · {unassigned.length}</div>
              {assignable.length === 0 && <div style={{ fontSize: 12, color: '#6f665b' }}>Nobody else is here yet.</div>}
              {assignable.map(p => {
                const at = roomOf(p.identity);
                return (
                  <div key={p.identity} className="hv-bg-21" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderRadius: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    <select
                      value={at}
                      onChange={e => app.assignToBreakout(p.identity, Number(e.target.value) < 0 ? null : Number(e.target.value))}
                      style={{ ...fieldStyle, width: 'auto', maxWidth: 170, padding: '8px 9px', fontSize: 12.5, cursor: 'pointer', minHeight: 40 }}
                    >
                      <option value={-1}>Not assigned</option>
                      {s.breakoutDraft.map((r, i) => <option key={i} value={i}>{r.name || `Room ${i + 1}`}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="hv-bg-2e" onClick={close} style={{ ...cardBtn, flex: 1 }}>Cancel</button>
              <button
                className="hv-primary"
                onClick={() => app.startBreakouts()}
                disabled={s.breakoutBusy || s.devMode}
                style={{ ...primaryBtn, flex: 2, opacity: s.breakoutBusy || s.devMode ? 0.5 : 1 }}
              >
                {s.breakoutBusy ? 'Opening…' : 'Open rooms'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#6f665b', lineHeight: 1.55 }}>
              Everyone assigned moves automatically. Anyone who isn't assigned stays in the main meeting. Chat inside a breakout is live only and isn't saved with the meeting.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: '#a3988a', lineHeight: 1.6 }}>
            No breakout rooms are open. The host can open them from the More menu.
          </div>
        )}
      </div>
    </div>
  );
}

function ControlBar() {
  const app = useApp();
  const s = app.s;
  const narrow = s.isNarrow;
  const ctrlBtn = ctrlBtnFor(narrow);
  const { tiles, handsAhead, customOrder } = useTiles();
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
    // Breakouts live here, not on the bar: the narrow bar is a one-row budget.
    ...(s.isHost || s.isCoHost || s.breakoutsOpen ? [{
      label: <Lbl name="breakout" text={s.breakoutsOpen ? 'Breakout rooms · open' : 'Breakout rooms'} />,
      color: s.breakoutsOpen ? '#f0a97f' : '#f4eee5',
      go: app.openBreakoutUi,
    }] : []),
    ...(customOrder ? [{
      label: <Lbl name="grid" text="Reset layout" />,
      color: '#f4eee5',
      go: () => app.setTileOrder(null),
    }] : []),
    ...(s.isHost || s.isCoHost ? [{
      label: <Lbl name="gear" text="Host controls" />,
      color: '#f4eee5',
      go: () => app.patch({ moreOpen: false, panel: true, tab: 'people', hostPanelOpen: true }),
    }] : []),
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

  /** Raise-hand + emoji row. Its own popup on desktop, a section of "More" on a phone. */
  const reactionsBlock = (after?: () => void) => (
    <>
      <button
        onClick={() => { app.toggleHand(); after?.(); }}
        style={{ background: s.hand ? 'rgba(240,180,95,.2)' : '#2a241e', border: `1px solid ${s.hand ? 'rgba(240,180,95,.5)' : '#3a332b'}`, color: '#f4eee5', borderRadius: 10, padding: '9px 14px', minHeight: 44, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <Lbl name="hand" text={s.hand ? 'Lower hand' : `Raise hand${handsAhead > 0 ? ` · ${handsAhead} up` : ''}`} size={15} />
      </button>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
        {EMOJIS.map(e => (
          <button key={e} className="hv-bg-2e" onClick={() => { app.sendReaction(e); after?.(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: '#f4eee5' }}><Ic name={e} size={22} /></button>
        ))}
      </div>
    </>
  );

  const sectionLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#6f665b', padding: '6px 13px 4px' };
  const divider = <div style={{ borderTop: '1px solid #3a332b', margin: '6px 0 2px' }} />;

  return (
    // Never wrap. A wrapped bar was the phone bug: two rows, buttons off the
    // left edge, "…" and Leave stranded. Narrow shows only the controls that
    // genuinely fit one row; share / reactions / raise hand live in "More".
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'nowrap', gap: narrow ? 6 : 10, padding: narrow ? 'calc(10px) calc(10px + var(--sar)) calc(12px + var(--sab)) calc(10px + var(--sal))' : '14px 20px 18px', zIndex: 20, background: 'linear-gradient(transparent,rgba(14,12,10,.9))', opacity: s.bars ? 1 : 0, transition: 'opacity .4s', pointerEvents: s.bars ? 'auto' : 'none' }}>
      <button
        onClick={app.toggleMic}
        title={s.micMuted && !s.canUnmute ? "The host has turned off unmuting — ask them to unmute you" : 'Mute (M)'}
        aria-disabled={s.micMuted && !s.canUnmute}
        style={{ ...ctrlBtn, background: s.micMuted ? 'rgba(201,74,56,.85)' : '#1e1a16', borderColor: s.micMuted ? '#c94a38' : '#2e2822', opacity: s.micMuted && !s.canUnmute ? 0.5 : 1, cursor: s.micMuted && !s.canUnmute ? 'not-allowed' : 'pointer' }}
      >
        <Ic name={s.micMuted ? 'micOff' : 'mic'} size={20} />
        <span style={{ color: '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
      </button>
      <button onClick={app.toggleCam} title="Camera (V)" style={{ ...ctrlBtn, background: s.camOff ? 'rgba(201,74,56,.85)' : '#1e1a16', borderColor: s.camOff ? '#c94a38' : '#2e2822' }}>
        <Ic name={s.camOff ? 'videoOff' : 'video'} size={20} />
        <span style={{ color: '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
      </button>
      {!narrow && <div style={{ position: 'relative' }}>
        <button
          onClick={() => {
            // Denied share must fail loudly, not silently: say why instead of
            // opening a menu whose every option would be rejected.
            if (!s.canShare) { app.toast('The host has turned off screen sharing'); return; }
            setShareOpen(o => !o);
            app.patch({ moreOpen: false, leaveOpen: false, reactionsOpen: false });
          }}
          title={!s.canShare ? 'The host has turned off screen sharing' : s.sharing ? 'Sharing — change or stop' : 'Share your screen'}
          aria-expanded={shareOpen}
          aria-disabled={!s.canShare}
          style={{ ...ctrlBtn, background: s.sharing ? 'rgba(111,191,143,.2)' : shareOpen ? '#2e2822' : '#1e1a16', borderColor: s.sharing ? 'rgba(111,191,143,.5)' : '#2e2822', color: s.sharing ? '#6fbf8f' : '#f4eee5', opacity: s.canShare ? 1 : 0.45, cursor: s.canShare ? 'pointer' : 'not-allowed' }}
        >
          <Ic name={s.shareAudioOnly ? 'speaker' : 'share'} size={20} />
          <span style={{ color: s.sharing ? '#6fbf8f' : '#8a7f70', alignSelf: 'flex-end', paddingBottom: 6 }}><Ic name="chevronDown" size={10} /></span>
        </button>
        {shareOpen && (
          <ShareMenu
            narrow={narrow}
            sharing={s.sharing}
            mode={shareMode}
            onPick={pickShare}
            onStop={() => { setShareOpen(false); app.toggleShare(shareMode); }}
          />
        )}
      </div>}
      {!narrow && <div style={{ position: 'relative' }}>
        <button onClick={() => app.patch(st => ({ reactionsOpen: !st.reactionsOpen, moreOpen: false, leaveOpen: false }))} title="Reactions" style={{ ...ctrlBtn, background: s.reactionsOpen || s.hand ? '#2e2822' : '#1e1a16' }}>
          <Ic name="hand" size={18} />
        </button>
        {s.reactionsOpen && (
          <div style={{ ...popupStyle(narrow, { position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', maxWidth: '92vw' }), background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            {reactionsBlock()}
          </div>
        )}
      </div>}
      <div style={{ position: 'relative' }}>
        <button onClick={() => app.togglePanel('chat')} title="Chat (C)" style={{ ...ctrlBtn, background: s.panel && s.tab === 'chat' ? '#2e2822' : '#1e1a16' }}><Ic name="chat" size={18} /></button>
        {s.unread > 0 && (
          // A message that pings you (mention or DM) gets a louder badge than
          // ordinary chatter — same place, unmistakably different.
          <span
            title={s.unreadMention ? 'You were mentioned' : undefined}
            style={{ position: 'absolute', top: -5, right: -5, background: s.unreadMention ? '#f0b45f' : '#f08b5f', color: '#241209', fontSize: 11, fontWeight: 800, borderRadius: 99, minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', animation: s.unreadMention ? 'badgePulse 1.6s infinite' : undefined }}
          >
            {s.unreadMention ? `@${s.unread}` : s.unread}
          </span>
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
          <div style={{ ...popupStyle(narrow, { position: 'absolute', bottom: 60, right: 0, width: 250, maxWidth: '92vw', maxHeight: '70vh', overflowY: 'auto' }), background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
            {/* Narrow: the controls that were dropped from the one-row bar live here. */}
            {narrow && (
              <>
                <div style={sectionLabel}>Share</div>
                <ShareModeList
                  sharing={s.sharing}
                  mode={shareMode}
                  blocked={!s.canShare}
                  onPick={m => { app.patch({ moreOpen: false }); pickShare(m); }}
                  onStop={() => { app.patch({ moreOpen: false }); app.toggleShare(shareMode); }}
                />
                {divider}
                <div style={sectionLabel}>React</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 7px 6px' }}>
                  {reactionsBlock(() => app.patch({ moreOpen: false }))}
                </div>
                {divider}
              </>
            )}
            {moreItems.map((item, i) => (
              <button key={i} className="hv-bg-2e" onClick={item.go} style={{ display: 'block', width: '100%', minHeight: 44, textAlign: 'left', background: 'none', border: 'none', color: item.color, padding: '10px 13px', fontSize: 13.5, fontWeight: 500, borderRadius: 9, cursor: 'pointer' }}>{item.label}</button>
            ))}
            {divider}
            <div style={sectionLabel}>Video quality</div>
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
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button className="hv-danger" onClick={() => app.patch(st => ({ leaveOpen: !st.leaveOpen, moreOpen: false, reactionsOpen: false }))} style={{ height: narrow ? 48 : 50, borderRadius: 14, background: '#c94a38', border: 'none', color: '#fff', fontSize: narrow ? 14 : 14.5, fontWeight: 700, cursor: 'pointer', padding: narrow ? '0 14px' : '0 24px', whiteSpace: 'nowrap' }}>Leave</button>
        {s.leaveOpen && (
          <div style={{ ...popupStyle(narrow, { position: 'absolute', bottom: 60, right: 0, width: 260 }), background: '#241f1a', border: '1px solid #3a332b', borderRadius: 16, padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 40 }}>
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
    <div style={{
      // Narrow: viewport-pinned under the (inset-aware) top bar, so it can never
      // hang off an edge no matter where its trigger button ended up.
      ...(narrow
        ? { position: 'fixed', top: `calc(${TOPBAR_H_NARROW + 6}px + var(--sat))`, left: 'calc(10px + var(--sal))', right: 'calc(10px + var(--sar))', width: 'auto', maxWidth: 'none' }
        : { position: 'absolute', top: `calc(${TOPBAR_H_WIDE - 8}px + var(--sat))`, right: 60, width: 250, maxWidth: 'calc(100vw - 20px)' }),
      background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 16, zIndex: 40, boxShadow: '0 12px 40px rgba(0,0,0,.5)',
    }}>
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
  /**
   * A status pill sits directly under the top bar whenever someone is sharing.
   * It used to be an overlay on top of the first tile (and truncated mid-word on
   * a phone); the video area now gives up exactly its height so it can't overlap.
   */
  const sharePillH = s.sharing || (!!audioShareName && !audioShareIsYou) ? (narrow ? 46 : 50) : 0;
  /** Am I assigned to an open breakout room I'm not in yet? */
  const myBreakout = !s.inBreakout && s.breakoutsOpen
    ? s.breakouts.find(b => b.participants.some(p => p.identity === s.identity))
    : undefined;
  const breakoutPillH = s.inBreakout || myBreakout ? (narrow ? 46 : 50) : 0;
  const topPillH = sharePillH + breakoutPillH;
  /** Pill under the top bar: viewport-pinned on narrow so it can ellipsize instead of clipping. */
  const topPill = (zIndex: number, offset = 0): React.CSSProperties => narrow
    ? { position: 'absolute', top: `calc(${TOPBAR_H_NARROW + offset}px + var(--sat))`, left: 'calc(10px + var(--sal))', right: 'calc(10px + var(--sar))', justifyContent: 'center', zIndex }
    : { position: 'absolute', top: `calc(${TOPBAR_H_WIDE + offset}px + var(--sat))`, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 20px)', zIndex };

  return (
    <section className="meeting-root" onMouseMove={app.wake} style={{ display: 'flex', flexDirection: 'column', background: '#0e0c0a', overflow: 'hidden', position: 'relative' }}>
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
      {/* The page paints under the iOS status bar (viewport-fit=cover), so the
          top bar's own padding has to carry the top inset — otherwise the title,
          the people count and the REC pill sit behind the clock and battery. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: narrow ? 'calc(8px + var(--sat)) calc(10px + var(--sar)) 8px calc(10px + var(--sal))' : 'calc(12px + var(--sat)) calc(20px + var(--sar)) 12px calc(20px + var(--sal))', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, background: 'linear-gradient(rgba(14,12,10,.85),transparent)', opacity: s.bars ? 1 : 0, transition: 'opacity .4s', pointerEvents: s.bars ? 'auto' : 'none' }}>
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
      {/* The grid gets exactly what's left: viewport minus top bar, control bar,
          both safe-area insets and any share pill. tiles.ts solves against the
          measured content box, so honest padding here == tiles that always fit. */}
      <div style={{
        flex: 1, display: 'flex', minWidth: 0, minHeight: 0, gap: 12,
        padding: narrow
          ? `calc(${TOPBAR_H_NARROW + topPillH}px + var(--sat)) calc(8px + var(--sar)) calc(${BAR_H_NARROW + 6}px + var(--sab)) calc(8px + var(--sal))`
          : `calc(${TOPBAR_H_WIDE + topPillH}px + var(--sat)) calc(12px + var(--sar)) calc(${BAR_H_WIDE + 4}px + var(--sab)) calc(12px + var(--sal))`,
      }}>
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
        <div style={{ position: 'absolute', top: `calc(${narrow ? 9 : 14}px + var(--sat))`, left: '50%', transform: 'translateX(-50%)', zIndex: 26, display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(36,31,26,.92)', border: '1px solid rgba(224,96,79,.5)', borderRadius: 99, padding: '6px 14px', boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e0604f', animation: 'recBlink 1.2s infinite' }} />
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.09em', color: '#e0836f' }}>REC</span>
        </div>
      )}

      {/* Live captions overlay */}
      {s.captionsOn && s.captionLines.length > 0 && (
        <div style={{ position: 'absolute', left: '50%', bottom: `calc(${(narrow ? BAR_H_NARROW : BAR_H_WIDE) + 10}px + var(--sab))`, transform: 'translateX(-50%)', zIndex: 34, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', maxWidth: narrow ? 'calc(100% - 20px)' : 'min(70%, 720px)', pointerEvents: 'none' }}>
          {s.captionLines.map(l => (
            <div key={l.id} style={{ background: 'rgba(14,12,10,.8)', backdropFilter: 'blur(4px)', borderRadius: 10, padding: '7px 14px', fontSize: 14.5, lineHeight: 1.4, color: l.interim ? '#c9beb0' : '#f4eee5', textAlign: 'center', animation: 'fadeUp .2s ease' }}>
              <span style={{ color: '#f0a97f', fontWeight: 700, marginRight: 8 }}>{l.name}</span>{l.text}
            </div>
          ))}
        </div>
      )}

      {/* Sharing pill */}
      {s.sharing && (
        <div style={{ ...topPill(30), background: '#241f1a', border: '1px solid rgba(111,191,143,.4)', borderRadius: 99, padding: narrow ? '8px 8px 8px 14px' : '9px 10px 9px 18px', display: 'flex', alignItems: 'center', gap: narrow ? 8 : 14, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6fbf8f', fontWeight: 600, minWidth: 0, flex: '1 1 auto' }}>
            <span style={{ display: 'flex', flexShrink: 0 }}><Ic name={s.shareAudioOnly ? 'speaker' : 'share'} size={15} /></span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.shareAudioOnly ? "You're sharing computer audio"
                : s.shareHasAudio ? "You're sharing your screen and its sound"
                : "You're sharing your screen"}
            </span>
          </span>
          <button onClick={() => app.toggleShare(activeShareMode(s.shareHasAudio, s.shareAudioOnly))} style={{ background: '#c94a38', border: 'none', color: '#fff', borderRadius: 99, padding: '8px 16px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>Stop</button>
        </div>
      )}

      {/* Which room am I in? A breakout must never be mistakable for the main
          meeting, and the way back has to be one tap away. */}
      {(s.inBreakout || myBreakout) && (
        <div style={{ ...topPill(31, sharePillH), background: '#241f1a', border: '1px solid rgba(240,139,95,.45)', borderRadius: 99, padding: narrow ? '7px 7px 7px 13px' : '8px 9px 8px 16px', display: 'flex', alignItems: 'center', gap: narrow ? 8 : 12, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f0a97f', fontWeight: 600, minWidth: 0, flex: '1 1 auto' }}>
            <span style={{ display: 'flex', flexShrink: 0 }}><Ic name="breakout" size={15} /></span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.inBreakout ? `Breakout: ${s.inBreakout.name}` : `Your breakout room: ${myBreakout!.name}`}
            </span>
          </span>
          {s.inBreakout ? (
            <button
              className="hv-bg-2e"
              disabled={s.breakoutBusy}
              onClick={() => app.returnToMain()}
              style={{ background: '#2a241e', border: '1px solid #3a332b', color: '#f4eee5', borderRadius: 99, padding: '7px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', opacity: s.breakoutBusy ? 0.5 : 1 }}
            >
              {s.breakoutBusy ? 'Moving…' : narrow ? 'Main room' : 'Return to main room'}
            </button>
          ) : (
            <button
              className="hv-primary"
              disabled={s.breakoutBusy}
              onClick={() => app.joinBreakout()}
              style={{ background: '#f08b5f', border: 'none', color: '#241209', borderRadius: 99, padding: '7px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', opacity: s.breakoutBusy ? 0.5 : 1 }}
            >
              {s.breakoutBusy ? 'Moving…' : 'Join'}
            </button>
          )}
        </div>
      )}

      {s.breakoutUi && <BreakoutPanel />}

      {/* Computer-audio-only share: there is no picture to show, so say so loudly
          instead of parking a black tile on the stage. */}
      {audioShareName && !audioShareIsYou && (
        <div style={{ ...topPill(29), background: '#241f1a', border: '1px solid rgba(111,191,143,.4)', borderRadius: 99, padding: narrow ? '8px 14px' : '9px 18px', display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <span style={{ display: 'flex', color: '#6fbf8f', flexShrink: 0 }}><Ic name="speaker" size={15} /></span>
          <span style={{ fontSize: 13, color: '#6fbf8f', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{audioShareName} is sharing computer audio</span>
          <span style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 14, flexShrink: 0 }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ width: 3, height: 14, background: '#6fbf8f', borderRadius: 2, transformOrigin: 'bottom', animation: `meterA 1.1s ${i * 0.18}s infinite ease-in-out` }} />
            ))}
          </span>
        </div>
      )}
      {/* Toasts */}
      <div style={{ position: 'absolute', left: narrow ? 'calc(10px + var(--sal))' : 18, right: narrow ? 'calc(10px + var(--sar))' : undefined, bottom: `calc(${(narrow ? BAR_H_NARROW : BAR_H_WIDE) + 8}px + var(--sab))`, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 36 }}>
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
