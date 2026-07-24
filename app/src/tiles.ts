import { useCallback, useRef, useSyncExternalStore } from 'react';
import { PALETTE, devFallbackPeers, useApp } from './store';
import type { Peer } from './store';
import { applyTileOrder } from './util';
import type { Track } from 'livekit-client';

export interface Tile {
  key: string;
  identity: string;
  you: boolean;
  camOn: boolean;
  videoTrack: Track | null;
  screenTrack: Track | null;
  isScreen: boolean;
  color: string; initials: string;
  label: string; short: string;
  muted: boolean; hand: boolean; handQ: string;
  badge: string;
  ring: string;
  pinned: boolean;
  pinToggle: () => void;
  canModerate: boolean;
  hostMute: () => void;
  hostRemove: () => void;
  /** Host-only: this peer is a member (user-*) who can be promoted/demoted. */
  canPromote: boolean;
  isCoHost: boolean;
  promoteToggle: () => void;
}

const initialsOf = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

const GRID_PER_PAGE = 9;
const GRID_PER_PAGE_NARROW = 4;

/** Tiles stay landscape 16:9 — the solver never changes this, it only picks the split. */
export const TILE_ASPECT = 16 / 9;
export const GRID_GAP = 10;

export interface GridSplit { rows: number; cols: number; tileW: number; tileH: number; }

/**
 * Pick the rows x cols split that maximises the area of a 16:9 tile inside a
 * `w` x `h` box holding `n` tiles with `gap` between them.
 *
 * Pure maths, no DOM: for every candidate column count the row count follows,
 * each cell is clamped to 16:9, and the biggest resulting tile wins. Ties go to
 * the split with fewer columns (wider tiles, calmer layout).
 */
/**
 * Size one tile inside its grid cell.
 *
 * Tiles do NOT letterbox to a strict 16:9: a 16:9 tile in a cell of any other
 * shape leaves dead bands, which is the "wasted space" this layout exists to
 * remove. The video inside is object-fit:cover, so a tile that fills its cell
 * crops a sliver off the feed instead of stranding empty pixels — the same
 * trade Meet and Zoom make. The clamp keeps tiles landscape and stops extreme
 * shapes (a letterbox slot, or a near-square) when the cell is lopsided.
 */
const MIN_TILE_AR = 4 / 3;
const MAX_TILE_AR = 2.4;
function fitTile(cellW: number, cellH: number, aspect: number): { tileW: number; tileH: number } {
  const cellAr = cellW / cellH;
  // Cell already close to the natural aspect: take it as-is.
  if (cellAr >= MIN_TILE_AR && cellAr <= MAX_TILE_AR) return { tileW: cellW, tileH: cellH };
  if (cellAr > MAX_TILE_AR) {
    // Very wide cell — cap the width so tiles don't become letterbox slits.
    const tileH = cellH;
    return { tileW: Math.min(cellW, tileH * MAX_TILE_AR), tileH };
  }
  // Very tall cell — cap the height so tiles stay landscape.
  const tileW = cellW;
  const byMin = tileW / MIN_TILE_AR;
  const natural = tileW / aspect;
  return { tileW, tileH: Math.min(cellH, Math.max(byMin, natural)) };
}

export function solveGrid(n: number, w: number, h: number, gap = GRID_GAP, aspect = TILE_ASPECT): GridSplit {
  const count = Math.max(1, n);
  if (!(w > 0) || !(h > 0)) {
    // Not measured yet — fall back to the old heuristic so the first paint is sane.
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
    return { rows: Math.ceil(count / cols), cols, tileW: 0, tileH: 0 };
  }
  let best: GridSplit = { rows: count, cols: 1, tileW: 0, tileH: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    if (cellW <= 1 || cellH <= 1) continue;
    const { tileW, tileH } = fitTile(cellW, cellH, aspect);
    // strict > keeps the first (fewest-columns) split on a tie
    if (tileW * tileH > best.tileW * best.tileH + 0.5) best = { rows, cols, tileW, tileH };
  }
  if (best.tileW <= 0) {
    const cols = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count))));
    return { rows: Math.ceil(count / cols), cols, tileW: 0, tileH: 0 };
  }
  // Round *down* to a tenth of a pixel: the row is laid out with flex-wrap, and
  // sub-pixel rounding up would push the last tile of a row onto its own line.
  // Height is rounded independently — deriving it from the width would force
  // the tile back to a strict `aspect` and undo fitTile's fill.
  return {
    rows: best.rows,
    cols: best.cols,
    tileW: Math.floor(best.tileW * 10) / 10,
    tileH: Math.floor(best.tileH * 10) / 10,
  };
}

// ── Measured grid container ──────────────────────────────────────────────────
// One module-level store so `useTiles()` (called from several components) can
// read the size without every caller wiring up its own observer. The observer
// only ever reads `entry.contentRect`, so nothing forces a synchronous layout.

let gridBox = { w: 0, h: 0 };
const boxListeners = new Set<() => void>();
const subscribeBox = (fn: () => void) => { boxListeners.add(fn); return () => { boxListeners.delete(fn); }; };
const readBox = () => gridBox;

function publishBox(w: number, h: number) {
  if (Math.abs(w - gridBox.w) < 0.5 && Math.abs(h - gridBox.h) < 0.5) return;
  gridBox = { w, h };
  boxListeners.forEach(fn => fn());
}

/**
 * Ref callback for the element the grid lives in. Attaching it publishes the
 * element's content box to every `useTiles()` consumer, so the solver re-runs on
 * window resize, panel open/close and orientation change without polling.
 */
export function useGridMeasure() {
  const obs = useRef<ResizeObserver | null>(null);
  return useCallback((el: HTMLElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) { publishBox(0, 0); return; }
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) publishBox(box.width, box.height);
    });
    ro.observe(el);
    obs.current = ro;
    publishBox(el.clientWidth, el.clientHeight);
  }, []);
}

export function useTiles() {
  const app = useApp();
  const s = app.s;
  const joinOrder: Peer[] = s.devMode ? devFallbackPeers(s) : s.peers;
  // A drag only ever reorders MY grid — the roster itself, and everything
  // derived from join order (avatar colours), is untouched.
  const peers: Peer[] = applyTileOrder(joinOrder, s.tileOrder);
  const colorIdx = new Map(joinOrder.map((p, i) => [p.identity, i]));
  const canMod = s.isHost || s.isCoHost;
  let handCount = 0;

  const tiles: Tile[] = peers.map((p, i) => {
    const speaking = p.speaking && !s.reconnecting;
    if (p.hand) handCount++;
    return {
      key: p.identity,
      identity: p.identity,
      you: p.isLocal,
      camOn: p.camOn && (!p.isLocal || !!p.videoTrack || s.devMode),
      videoTrack: p.videoTrack,
      screenTrack: p.screenTrack,
      isScreen: false,
      // Keyed off join order, not grid position: rearranging tiles must not
      // repaint everyone's avatar a different colour.
      color: PALETTE[(colorIdx.get(p.identity) ?? i) % PALETTE.length],
      initials: initialsOf(p.name || '?'),
      label: p.isLocal ? `${p.name} (you)` : p.name,
      short: p.isLocal ? 'You' : p.name.split(' ')[0],
      muted: !p.micOn,
      hand: p.hand,
      handQ: p.hand ? `#${handCount}` : '',
      badge: p.isHost ? 'HOST' : p.isCoHost ? 'CO-HOST' : '',
      ring: speaking
        ? '0 0 0 2.5px #f08b5f, 0 0 26px rgba(240,139,95,.5)'
        : s.pinned === p.identity ? '0 0 0 2px #a3988a' : 'none',
      pinned: s.pinned === p.identity,
      pinToggle: () => app.patch(st => ({ pinned: st.pinned === p.identity ? null : p.identity, view: 'speaker' })),
      // co-hosts can moderate everyone except the host and themselves; the host can moderate anyone remote
      canModerate: canMod && !p.isLocal && !s.devMode && (s.isHost || !p.isHost),
      hostMute: () => { app.moderatePeer(p.identity, 'mute'); },
      hostRemove: () => { app.moderatePeer(p.identity, 'remove'); },
      canPromote: s.isHost && !p.isLocal && !s.devMode && !p.isHost && p.identity.startsWith('user-'),
      isCoHost: p.isCoHost,
      promoteToggle: () => { app.moderatePeer(p.identity, p.isCoHost ? 'demote' : 'promote'); },
    };
  });

  // Screen share takes over the main stage when anyone is sharing a picture.
  // A computer-audio-only share has no video at all — it must never take the
  // stage and show a black tile; it gets its own indicator instead.
  const audioOnlySharer = peers.find(p => p.sharing && !p.screenTrack && (p.isLocal ? s.shareAudioOnly : true));
  const sharer = peers.find(p => p.sharing && (p.screenTrack || (p.isLocal && !s.shareAudioOnly)));
  const screenTile: Tile | null = sharer ? {
    ...tiles[peers.indexOf(sharer)],
    key: `${sharer.identity}-screen`,
    isScreen: true,
    camOn: !!sharer.screenTrack,
    videoTrack: sharer.screenTrack,
    label: sharer.isLocal ? 'Your screen' : `${sharer.name}'s screen`,
    short: 'Screen',
    muted: false, hand: false, handQ: '', badge: '', pinned: false,
    ring: 'none',
    pinToggle: () => {},
  } : null;

  const activeIdx = Math.max(tiles.findIndex(t => t.ring.startsWith('0 0 0 2.5px')), 0);
  const pinnedIdx = s.pinned ? tiles.findIndex(t => t.key === s.pinned) : -1;
  const mainIdx = pinnedIdx >= 0 ? pinnedIdx : activeIdx;
  const mainTile: Tile | undefined = screenTile ?? tiles[mainIdx] ?? tiles[0];
  const strip = tiles.filter((_, i) => screenTile ? true : i !== mainIdx).slice(0, 6);
  const stripRest = tiles.length - (screenTile ? 0 : 1) - strip.length;

  // Grid pagination: 9 tiles per page (4 on narrow screens so faces stay legible),
  // join order kept stable so tiles don't jump around.
  const perPage = s.isNarrow ? GRID_PER_PAGE_NARROW : GRID_PER_PAGE;
  const gridPages = Math.max(1, Math.ceil(tiles.length / perPage));
  const gridPage = Math.min(s.gridPage, gridPages - 1);
  const gridTiles = gridPages > 1 ? tiles.slice(gridPage * perPage, (gridPage + 1) * perPage) : tiles;

  // Auto-fit: the split comes from the measured container, not a hardcoded count.
  const box = useSyncExternalStore(subscribeBox, readBox, readBox);
  const split = solveGrid(gridTiles.length, box.w, box.h);

  return {
    tiles, mainTile, strip,
    stripOverflow: stripRest > 0 ? `+${stripRest}` : '',
    gridTiles, gridCols: split.cols, gridRows: split.rows,
    gridTileW: split.tileW, gridTileH: split.tileH,
    gridPage, gridPages,
    /** Order of every tile, as the grid currently shows them (drag commits against this). */
    order: tiles.map(t => t.identity),
    customOrder: !!s.tileOrder,
    handsAhead: handCount,
    hasScreenShare: !!screenTile,
    audioShareName: audioOnlySharer ? (audioOnlySharer.isLocal ? 'You' : audioOnlySharer.name) : '',
    audioShareIsYou: !!audioOnlySharer?.isLocal,
  };
}
