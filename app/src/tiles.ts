import { PALETTE, roster, useApp } from './store';

export interface Tile {
  key: string;
  you: boolean;
  camOn: boolean;
  img: string; imgBig: string; imgSm: string;
  color: string; initials: string;
  label: string; short: string;
  muted: boolean; hand: boolean; handQ: string;
  badge: string;
  ring: string;
  pinned: boolean;
  pinToggle: () => void;
  hostMute: () => void;
}

export function useTiles() {
  const app = useApp();
  const s = app.s;
  const isHost = s.role === 'host';
  const list = roster(s);
  let handCount = 0;

  const tiles: Tile[] = list.map((p, i) => {
    const you = !!p.you;
    const muted = you ? s.micMuted : s.mutedAll && !you ? true : p.mute;
    const camOn = you ? !s.camOff : p.cam;
    const speaking = i === s.activeIdx && !s.reconnecting && (!muted || you);
    const hand = you ? s.hand : !!p.hand;
    if (hand) handCount++;
    const isHostP = (isHost && you) || (!isHost && p.alt);
    return {
      key: p.n,
      you,
      camOn,
      img: `https://i.pravatar.cc/420?img=${p.img}`,
      imgBig: `https://i.pravatar.cc/900?img=${p.img}`,
      imgSm: `https://i.pravatar.cc/80?img=${p.img}`,
      color: PALETTE[i % PALETTE.length],
      initials: p.n.split(' ').map(w => w[0]).join('').slice(0, 2),
      label: you ? `${p.n} (you)` : p.n,
      short: you ? 'You' : p.n.split(' ')[0],
      muted,
      hand,
      handQ: hand ? `#${handCount}` : '',
      badge: isHostP ? 'HOST' : '',
      ring: speaking
        ? '0 0 0 2.5px #f08b5f, 0 0 26px rgba(240,139,95,.5)'
        : s.pinned === i ? '0 0 0 2px #a3988a' : 'none',
      pinned: s.pinned === i,
      pinToggle: () => app.patch(st => ({ pinned: st.pinned === i ? null : i, view: 'speaker' })),
      hostMute: () => app.toast(`Asked ${p.n.split(' ')[0]} to mute`),
    };
  });

  const mainIdx = Math.min(s.pinned ?? s.activeIdx, tiles.length - 1);
  const mainTile = tiles[mainIdx] ?? tiles[0];
  const strip = tiles.filter((_, i) => i !== mainIdx).slice(0, 6);
  const stripRest = tiles.length - 1 - strip.length;
  const n = tiles.length;
  const gridCols = n <= 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 9 ? 3 : 4;
  const handsAhead = handCount;

  return { tiles, mainTile, strip, stripOverflow: stripRest > 0 ? `+${stripRest}` : '', gridCols, handsAhead };
}
