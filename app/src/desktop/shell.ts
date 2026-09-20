import { createContext, useContext } from 'react';

export type Platform = 'mac' | 'win';
export type Surface = 'main' | 'tray' | 'meeting' | 'mini' | 'share' | 'notify' | 'settings' | 'system';

export interface DesktopState {
  screen: Surface;
  platform: Platform;
  navOpen: boolean;
  trayOpen: boolean;
  miniHover: boolean;
  shareTab: 'screens' | 'windows';
  shareSel: number;
  shareAudio: boolean;
  warn: boolean;
  closeToast: boolean;
  recording: boolean;
  combo: string | null;
  perm: 'ask' | 'denied';
  tog: { login: boolean; tray: boolean; top: boolean; close: boolean };
}

export const initialDesktop: DesktopState = {
  screen: 'main', platform: 'mac', navOpen: false, trayOpen: true,
  miniHover: true, shareTab: 'screens', shareSel: 0, shareAudio: false, warn: true,
  closeToast: false, recording: false, combo: null, perm: 'ask',
  tog: { login: false, tray: true, top: true, close: true },
};

export interface DesktopCtx {
  s: DesktopState;
  set: (p: Partial<DesktopState> | ((s: DesktopState) => Partial<DesktopState>)) => void;
  go: (screen: Surface) => void;
  mac: boolean;
}

export const Ctx = createContext<DesktopCtx>(null!);
export const useDesktop = () => useContext(Ctx);

/* Shared tokens, lifted from the design so surfaces stay in sync. */
export const ACCENT = '#f08b5f';
export const TRACK_OFF = '#3a332b';
export const MONO = "'JetBrains Mono',monospace";
export const DISPLAY = "'Bricolage Grotesque',sans-serif";

export const modKey = (mac: boolean) => (mac ? '⌘' : 'Ctrl+');
export const barName = (mac: boolean) => (mac ? 'menu bar' : 'system tray');

export const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '.09em',
  textTransform: 'uppercase', color: '#9a9084',
};

export const captionTitle: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, textAlign: 'center',
  fontSize: 13, fontWeight: 600, color: '#a3988a', pointerEvents: 'none',
};

export const note: React.CSSProperties = { color: '#9a9084', fontSize: 12.5, lineHeight: 1.5 };
