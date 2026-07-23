import { PALETTE, devFallbackPeers, useApp } from './store';
import type { Peer } from './store';
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

export function useTiles() {
  const app = useApp();
  const s = app.s;
  const peers: Peer[] = s.devMode ? devFallbackPeers(s) : s.peers;
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
      color: PALETTE[i % PALETTE.length],
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

  // Screen share takes over the main stage when anyone is sharing.
  const sharer = peers.find(p => p.sharing && (p.screenTrack || p.isLocal));
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

  // Grid pagination: 9 tiles per page, join order kept stable so tiles don't jump around.
  const gridPages = Math.max(1, Math.ceil(tiles.length / GRID_PER_PAGE));
  const gridPage = Math.min(s.gridPage, gridPages - 1);
  const gridTiles = gridPages > 1 ? tiles.slice(gridPage * GRID_PER_PAGE, (gridPage + 1) * GRID_PER_PAGE) : tiles;
  const n = gridTiles.length;
  const gridCols = n <= 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : 3;

  return {
    tiles, mainTile, strip,
    stripOverflow: stripRest > 0 ? `+${stripRest}` : '',
    gridTiles, gridCols, gridPage, gridPages,
    handsAhead: handCount,
    hasScreenShare: !!screenTile,
  };
}
