const PATHS: Record<string, string> = {
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
  home: '<path d="m3 10 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  video: '<path d="m16 10 4.55-2.28A1 1 0 0 1 22 8.6v6.8a1 1 0 0 1-1.45.9L16 14"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2"/><line x1="2" y1="2" x2="22" y2="22"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  play: '<path d="M6 4v16l14-8z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8L21.5 17l-1.8.7L19 19.5l-.7-1.8L16.5 17z"/>',
  link: '<path d="M9 15 15 9"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/>',
  micOff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M17 16.95A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.1 1"/><path d="M12 19v3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
  hand: '<path d="M18 11V6a1.8 1.8 0 0 0-3.6 0M14.4 10V4.2a1.8 1.8 0 0 0-3.6 0v1.6M10.8 10.5V6a1.8 1.8 0 0 0-3.6 0v8"/><path d="M18 8.5a1.8 1.8 0 0 1 3.6 0V14a8 8 0 0 1-8 8h-1.5c-2.5 0-3.9-.8-5.3-2.2l-3.3-3.3a1.8 1.8 0 0 1 2.5-2.5L7.2 15"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  share: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m9.5 10 2.5-2.5L14.5 10M12 7.5V13"/>',
  shareOff: '<path d="M3 6a2 2 0 0 1 2-2h11"/><path d="M21 6v9a2 2 0 0 1-2 2H8"/><path d="M8 21h8M12 17v4"/><line x1="2" y1="2" x2="22" y2="22"/>',
  at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  star: '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  square: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  record: '<circle cx="12" cy="12" r="6"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8M11 13h2"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  wifiOff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M12 20h.01M16.7 13.3A9 9 0 0 0 22 8.8"/><path d="M5 12.5a10 10 0 0 1 3-1.8"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  thumbsUp: '<path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M7 10l4-7a2 2 0 0 1 3 1.7V9h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7z"/>',
  heart: '<path d="M12 20s-7-4.6-9.5-9A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9.5 5c-2.5 4.4-9.5 9-9.5 9z"/>',
  laugh: '<circle cx="12" cy="12" r="9"/><path d="M8 13a4 4 0 0 0 8 0zM9 9h.01M15 9h.01"/>',
  party: '<path d="M4 20 9 8l7 7z"/><path d="M14 5a3 3 0 0 1 3 3M18 3a5 5 0 0 1 3 3M13 11l2-2M17 14l2-1"/>',
  clap: '<path d="M11 11 8.5 6.5a1.5 1.5 0 0 1 2.6-1.5L14 9"/><path d="M20 13a7 7 0 0 1-7 7 7 7 0 0 1-6-3.5L4.5 12a1.5 1.5 0 0 1 2.6-1.5L9 14"/><path d="M4 4l1 1M8 2v2M14 4l-1 1"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  captions: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h2M11 11h6"/>',
  blur: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pip: '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1"/>',
  // Drag handle for rearranging tiles — the universal six-dot grip.
  grip: '<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>',
  // Breakout rooms: one group splitting into separate rooms.
  breakout: '<rect x="2.5" y="3.5" width="8" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="8" height="7" rx="1.5"/><rect x="2.5" y="13.5" width="8" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="8" height="7" rx="1.5"/>',
  arrowBack: '<path d="M21 12H7"/><path d="m12 6-6 6 6 6"/><path d="M3 5v14"/>',
};

const FILLED: Record<string, true> = { play: true, star: true, more: true, record: true, square: true, grip: true };

export type IconName = keyof typeof PATHS;

export function Ic({ name, size = 20, color = 'currentColor', style }: { name: IconName; size?: number; color?: string; style?: React.CSSProperties }) {
  const fill = FILLED[name as string];
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? color : 'none'}" stroke="${fill ? 'none' : color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">${PATHS[name as string]}</svg>`;
  return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Lbl({ name, text, size = 16 }: { name: IconName; text: string; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Ic name={name} size={size} />
      {text}
    </span>
  );
}
