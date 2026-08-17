/** Small icon set used by the satellite windows (mini + tray panel). */
type P = { size?: number; color?: string; sw?: number };

const S = (p: P, d: React.ReactNode) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none"
    stroke={p.color ?? 'currentColor'} strokeWidth={p.sw ?? 1.9} strokeLinecap="round" strokeLinejoin="round"
    style={{ flex: 'none', display: 'block' }}>{d}</svg>
);

export const DMic = (p: P = {}) => S(p, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const DMicOff = (p: P = {}) => S(p, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" /></>);
export const DCam = (p: P = {}) => S(p, <><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="M15.5 11l6-3.5v9l-6-3.5z" /></>);
export const DCamOffMini = (p: P = {}) => S(p, <><rect x="2.5" y="6" width="13" height="12" rx="3" /><path d="M15.5 11l6-3.5v9l-6-3.5zM4 4l16 16" /></>);
export const DHangup = (p: P = {}) => S(p, <path d="M4 9.5c4.5-3.5 11.5-3.5 16 0l-2 3-3.5-1V9.2c-2.6-.7-4.4-.7-7 0V11.5l-3.5 1z" />);
export const DExpand = (p: P = {}) => S(p, <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />);
export const DPlus = (p: P = {}) => S({ sw: 2.2, ...p }, <path d="M12 5v14M5 12h14" />);
export const DLink = (p: P = {}) => S(p, <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>);
export const DCopy = (p: P = {}) => S({ sw: 1.8, ...p }, <><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15" /></>);
