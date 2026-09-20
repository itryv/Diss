/** Typed access to the Electron preload bridge. Absent in a plain browser tab. */

export interface MeetingState {
  active: boolean;
  title: string;
  muted: boolean;
  cameraOff: boolean;
  speaker: string;
  peers: number;
  link: string;
}

export interface DesktopPrefs {
  launchAtLogin: boolean;
  keepRunning: boolean;
  floatMini: boolean;
  closeShrinks: boolean;
  muteCombo: string;
  miniCombo: string;
}

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** null when macOS declined to hand over a bitmap for this surface. */
  thumbnail: string | null;
}

export interface CaptureIntent { audio: boolean; audioOnly: boolean }
export interface MiniFrame { dataUrl: string | null; fit: 'cover' | 'contain'; name?: string }

export type PermissionKind = 'camera' | 'microphone' | 'screen';
/** Mirrors Electron's getMediaAccessStatus vocabulary. */
export type PermissionState = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
export type PermissionStatuses = Record<PermissionKind, PermissionState> & { platform: string };

export type ShortcutName = 'toggle-mute' | 'toggle-camera' | 'settings' | 'new-meeting' | 'join' | 'leave';

export interface DissBridge {
  isDesktop: true;
  platform: string;
  /** Public origin of the Diss site — the only safe base for a shareable link. */
  webOrigin?: string;
  systemAudio: boolean;
  info: () => Promise<{ platform: string; version: string; electron: string; prefs: DesktopPrefs; meeting: MeetingState }>;
  ready: () => Promise<boolean>;
  setPrefs: (patch: Partial<DesktopPrefs>) => Promise<DesktopPrefs>;
  quit: () => Promise<boolean>;
  setMeeting: (patch: Partial<MeetingState>) => Promise<MeetingState>;
  command: (name: ShortcutName) => Promise<boolean>;
  mini: {
    show: () => Promise<boolean>;
    hide: () => Promise<boolean>;
    expand: () => Promise<boolean>;
    resize: (width: number, height: number) => Promise<boolean>;
    setFrame: (frame: MiniFrame) => Promise<boolean>;
    onFrame: (cb: (frame: MiniFrame) => void) => () => void;
  };
  tray: { hide: () => Promise<boolean>; resize: (height: number) => Promise<boolean> };
  showMain: () => Promise<boolean>;
  notify: (opts: { title?: string; body?: string; action?: ShortcutName }) => Promise<boolean>;
  getSources: (type?: 'screen' | 'window') => Promise<CaptureSource[]>;
  capture: {
    setIntent: (intent: CaptureIntent) => Promise<CaptureIntent>;
    intent: () => Promise<CaptureIntent>;
  };
  permissions: {
    status: () => Promise<PermissionStatuses>;
    request: (kind: 'camera' | 'microphone') => Promise<PermissionState>;
    requestScreen: () => Promise<{ status: PermissionState; needsRestart: boolean }>;
    openSettings: (pane?: PermissionKind) => Promise<unknown>;
    openWindow: () => Promise<boolean>;
  };
  relaunch: () => Promise<void>;
  openExternal: (url: string) => Promise<boolean>;
  picker: {
    choose: (choice: { id: string; withAudio: boolean }) => Promise<boolean>;
    cancel: () => Promise<boolean>;
  };
  onMeeting: (cb: (s: MeetingState) => void) => () => void;
  onPrefs: (cb: (p: DesktopPrefs) => void) => () => void;
  onShortcut: (cb: (name: ShortcutName) => void) => () => void;
  onDeepLink: (cb: (p: { code: string }) => void) => () => void;
  onNotificationAction: (cb: (name: ShortcutName) => void) => () => void;
}

declare global {
  interface Window { diss?: DissBridge }
}

export const bridge = (): DissBridge | undefined =>
  (typeof window !== 'undefined' ? window.diss : undefined);

export const isDesktopApp = () => !!bridge();

export const isMacApp = () => bridge()?.platform === 'darwin';

export const canCaptureNativeSystemAudio = () => bridge()?.systemAudio === true;
