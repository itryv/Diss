/**
 * Icon set for the desktop shell surfaces. Kept separate from `src/icons.tsx`
 * because the desktop design draws at lighter stroke weights (1.8–2.4) and a
 * few glyphs (window-restore, pip, chevrons, caption-bar controls) exist only here.
 */
type P = { size?: number; color?: string; sw?: number; style?: React.CSSProperties };

const S = (p: P, d: React.ReactNode, vb = '0 0 24 24') => (
  <svg
    width={p.size ?? 17}
    height={p.size ?? 17}
    viewBox={vb}
    fill="none"
    stroke={p.color ?? 'currentColor'}
    strokeWidth={p.sw ?? 1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flex: 'none', ...p.style }}
  >
    {d}
  </svg>
);

export const DHome = (p: P = {}) => S(p, <><path d="M3 10.5L12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /></>);
export const DCalendar = (p: P = {}) => S(p, <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
export const DRecordings = (p: P = {}) => (
  <svg width={p.size ?? 17} height={p.size ?? 17} viewBox="0 0 24 24" fill="none" stroke={p.color ?? 'currentColor'} strokeWidth={p.sw ?? 1.8} style={{ flex: 'none', ...p.style }}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
  </svg>
);
export const DGear = (p: P = {}) => S(p, <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>);
export const DPlus = (p: P = {}) => S({ sw: 2.2, ...p }, <path d="M12 5v14M5 12h14" />);
export const DCopy = (p: P = {}) => S(p, <><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15" /></>);
export const DLink = (p: P = {}) => S({ sw: 1.9, ...p }, <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>);
export const DMic = (p: P = {}) => S(p, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const DMicOff = (p: P = {}) => S(p, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" /></>);
export const DCam = (p: P = {}) => S(p, <><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="M15.5 11l6-3.5v9l-6-3.5z" /></>);
export const DShare = (p: P = {}) => S(p, <><rect x="2.5" y="4" width="19" height="13" rx="2.5" /><path d="M8 21h8M12 13V7.5M9.5 10L12 7.5 14.5 10" /></>);
export const DChat = (p: P = {}) => S(p, <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />);
export const DPip = (p: P = {}) => (
  <svg width={p.size ?? 19} height={p.size ?? 19} viewBox="0 0 24 24" fill="none" stroke={p.color ?? 'currentColor'} strokeWidth={p.sw ?? 1.8} strokeLinecap="round" style={{ flex: 'none', ...p.style }}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <rect x="12" y="12" width="7" height="5.5" rx="1.5" fill={p.color ?? 'currentColor'} stroke="none" />
  </svg>
);
export const DExpand = (p: P = {}) => S({ sw: 1.9, ...p }, <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />);
export const DHangup = (p: P = {}) => S({ sw: 1.9, ...p }, <path d="M4 9.5c4.5-3.5 11.5-3.5 16 0l-2 3-3.5-1V9.2c-2.6-.7-4.4-.7-7 0V11.5l-3.5 1z" />);
export const DWarning = (p: P = {}) => S({ sw: 1.9, ...p }, <><path d="M12 3.5l9.5 16.5H2.5z" /><path d="M12 10v4M12 17h.01" /></>);
export const DChevronDown = (p: P = {}) => S({ sw: 2.4, ...p }, <path d="M6 9l6 6 6-6" />);
export const DChevronUp = (p: P = {}) => S({ sw: 2.4, ...p }, <path d="M6 15l6-6 6 6" />);
export const DClose = (p: P = {}) => S({ sw: 2, ...p }, <path d="M5 5l14 14M19 5L5 19" />);
export const DBars = (p: P = {}) => S({ sw: 2.2, ...p }, <path d="M4 7h16M4 12h16M4 17h16" />);
export const DWifi = (p: P = {}) => S({ sw: 1.8, ...p }, <><path d="M2 8.5a15 15 0 0 1 20 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M9 16.5a5 5 0 0 1 6 0" /><circle cx="12" cy="20" r="1" /></>);
export const DPause = (p: P = {}) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill={p.color ?? '#f4eee5'} style={{ flex: 'none', ...p.style }}>
    <rect x="6" y="4" width="4" height="16" rx="1.4" />
    <rect x="14" y="4" width="4" height="16" rx="1.4" />
  </svg>
);
export const DBattery = (p: P = {}) => (
  <svg width={22} height={14} viewBox="0 0 28 14" fill="none" stroke={p.color ?? '#d6cec2'} strokeWidth="1.6" style={{ flex: 'none' }}>
    <rect x="1" y="2" width="22" height="10" rx="3" />
    <rect x="3" y="4" width="14" height="6" rx="1.5" fill={p.color ?? '#d6cec2'} stroke="none" />
    <path d="M25 5.5v3" strokeLinecap="round" />
  </svg>
);

/* Windows caption-bar glyphs — drawn on a 12×12 grid at hairline weight. */
export const WinMinimize = () => <svg width="11" height="11" viewBox="0 0 12 12" stroke="#d6cec2" strokeWidth="1"><path d="M1 6h10" /></svg>;
export const WinMaximize = () => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#d6cec2" strokeWidth="1"><rect x="1.5" y="1.5" width="9" height="9" /></svg>;
export const WinClose = () => <svg width="11" height="11" viewBox="0 0 12 12" stroke="#d6cec2" strokeWidth="1"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg>;
