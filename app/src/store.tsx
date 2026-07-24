import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  ConnectionQuality,
  LocalAudioTrack,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
} from 'livekit-client';
import type {
  LocalTrack,
  LocalVideoTrack,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  VideoPreset,
} from 'livekit-client';
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors';
import { api, ApiError, extractCode, meetingLink } from './api';
import type { Breakout, Meeting, ModerateAction, TokenResponse, User, WaitingGuest } from './api';
import { applySinkId, canCaptureDisplayAudio, canSelectSpeaker, listDevices, playTestTone } from './media';
import type { DeviceLists } from './media';
import {
  breakoutIdxOf, loadTileOrder, mentionsMe, resolveMentions, saveTileOrder, spreadEvenly,
} from './util';

export type Screen =
  | 'landing' | 'auth' | 'dash' | 'schedule' | 'schedDone' | 'detail'
  | 'recordings' | 'settings' | 'lobby' | 'waiting' | 'meeting' | 'post';

export type PermState = 'prompt' | 'granted' | 'denied' | 'nodevice' | 'busy';

export type VideoQuality = 'auto' | 'high' | 'saver';
export type ShareMode = 'screen' | 'screen-audio' | 'audio';
export type DeviceKind = 'mic' | 'cam' | 'speaker';

export interface ChatMessage {
  who: string; text: string; mine: boolean; ts?: number; history?: boolean;
  /** Contract v4: null/undefined = everyone. Anything else is a private message. */
  toIdentity?: string | null;
  /** Display name of the recipient, so a DM can say who it went to. */
  toName?: string;
  /** Identities mentioned in `text`; `"*"` means @all. */
  mentions?: string[];
  /** Pre-computed "this message mentions me" so the list doesn't recompute per render. */
  mentionsMe?: boolean;
}

export interface Burst { id: number; name: string; x: string; }
export interface Toast { id: number; text: string; sticky?: boolean; }
export interface CaptionLine { id: number; name: string; text: string; interim: boolean; ts: number; }

// ── Web Speech API (not in lib.dom) ──────────────────────────────────────────
interface SpeechRecognitionAlternativeLike { transcript: string; }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike; }
interface SpeechRecognitionEventLike { resultIndex: number; results: { length: number; [i: number]: SpeechRecognitionResultLike }; }
interface SpeechRecognitionLike {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void; stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const speechCtor = (): SpeechRecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const prefBool = (key: string, dflt: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === '1';
  } catch { return dflt; }
};
const setPref = (key: string, on: boolean) => {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private mode */ }
};
const prefStr = (key: string): string | null => {
  try {
    const v = localStorage.getItem(key);
    return v === null || v === '' ? null : v;
  } catch { return null; }
};
const setPrefStr = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode */ }
};

const MIC_KEY = 'diss_mic', CAM_KEY = 'diss_cam', SPK_KEY = 'diss_spk', QUAL_KEY = 'diss_qual';

const storedQuality = (): VideoQuality => {
  const v = prefStr(QUAL_KEY);
  return v === 'high' || v === 'saver' || v === 'auto' ? v : 'auto';
};

/** Capture resolution + publish encoding for each quality tier. */
const qualityPreset = (q: VideoQuality): VideoPreset =>
  q === 'high' ? VideoPresets.h1080 : q === 'saver' ? VideoPresets.h360 : VideoPresets.h720;

let blurSupported = false;
try { blurSupported = supportsBackgroundProcessors(); } catch { blurSupported = false; }

/** Parse a participant's LiveKit metadata for the co-host role (contract v2). */
const roleOf = (metadata?: string): string => {
  if (!metadata) return '';
  try { return (JSON.parse(metadata) as { role?: string }).role ?? ''; } catch { return ''; }
};

/**
 * Numeric LiveKit `TrackSource` values as they arrive on `participant.permissions`
 * (the wire enum from @livekit/protocol, not the string `Track.Source` the client
 * SDK uses). An EMPTY `canPublishSources` means "no restriction".
 */
const SRC_MICROPHONE = 2;
const SRC_SCREEN_SHARE = 3;

interface PermissionLike { canPublishData?: boolean; canPublishSources?: number[] }

/** May this participant publish `source`, given their live permissions? */
const mayPublish = (perm: PermissionLike | undefined, source: number): boolean => {
  const srcs = perm?.canPublishSources;
  return !srcs || srcs.length === 0 || srcs.includes(source);
};

/** View model for one participant in the room (real LiveKit state, or the dev fallback roster). */
export interface Peer {
  identity: string;
  name: string;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  speaking: boolean;
  hand: boolean;
  isHost: boolean;
  isCoHost: boolean;
  /** Contract v4 §2 — may this person publish a screen share right now? */
  canShareScreen: boolean;
  videoTrack: Track | null;
  audioTrack: Track | null;
  screenTrack: Track | null;
}

/** Where I am right now, when that isn't the main meeting room. */
export interface BreakoutHere { idx: number; name: string; }

/** One room being composed in the host's breakout planner (before it exists). */
export interface BreakoutDraftRoom { name: string; identities: string[]; }

export interface AppState {
  screen: Screen;
  // session
  user: User | null;
  bootChecked: boolean;
  // auth form
  authMode: 'signup' | 'signin';
  authName: string; email: string; authPassword: string;
  authError: string | null; authBusy: boolean;
  // meetings (hosted by me)
  meetings: Meeting[]; meetingsLoading: boolean;
  // current meeting (lobby / in-room / just scheduled)
  meeting: Meeting | null;
  // join code entry
  code: string; codeInvalid: boolean;
  // app shell
  newMenuOpen: boolean; joinModal: boolean; settingsTab: 'profile' | 'av' | 'notif' | 'account';
  optionsOpen: boolean; schedTitle: string; schedTime: string; copied: boolean;
  clock: string; dateStr: string;
  schedOpts: boolean[]; avOpts: boolean[]; notifOpts: boolean[];
  // lobby
  permState: PermState; realCam: boolean; lobbyName: string;
  lobbyMic: boolean; lobbyCam: boolean; speakerTesting: boolean;
  joining: boolean; joinError: string | null;
  // waiting room (guest side)
  waitingId: string | null; waitingDenied: boolean;
  // waiting room (host side)
  waitingGuests: WaitingGuest[];
  // meeting room
  peers: Peer[]; identity: string; isHost: boolean; isCoHost: boolean;
  devMode: boolean; // ProtoNav preview of the meeting screen without a real connection
  view: 'grid' | 'speaker'; micMuted: boolean; camOff: boolean; sharing: boolean; hand: boolean;
  panel: boolean; tab: 'chat' | 'people';
  reactionsOpen: boolean; moreOpen: boolean; leaveOpen: boolean; connPop: boolean;
  reconnecting: boolean; connQuality: ConnectionQuality;
  shortcutsOpen: boolean;
  pinned: string | null; selfCollapsed: boolean; bars: boolean; youreIn: boolean;
  elapsedS: number; unread: number; chatInput: string;
  messages: ChatMessage[]; bursts: Burst[]; toasts: Toast[];
  // chat identity + addressing (contract v4)
  chatToken: string | null;
  /** Composer recipient: null = everyone, otherwise a participant identity. */
  chatTo: string | null;
  /** At least one unread message pings me — the badge says so louder. */
  unreadMention: boolean;
  // host controls, as they apply to ME right now (from my LiveKit permissions)
  canShare: boolean; canChat: boolean; canUnmute: boolean;
  /** Host-controls section expanded inside the People panel. */
  hostPanelOpen: boolean;
  // breakout rooms (contract v4 §3)
  /** The open set, as the server sees it. Empty when none are open. */
  breakouts: Breakout[];
  breakoutsOpen: boolean;
  /** Non-null while I'm in a breakout instead of the main room. */
  inBreakout: BreakoutHere | null;
  /** The planner / room-list overlay. */
  breakoutUi: boolean;
  /** A room switch (or a create/close call) is in flight. */
  breakoutBusy: boolean;
  /** Host's planner state, before the rooms exist on the server. */
  breakoutDraft: BreakoutDraftRoom[];
  breakoutAnnounce: string;
  // local tile order (drag to rearrange) — mine only, never published
  tileOrder: string[] | null;
  // recording
  recOn: boolean; recBusy: boolean;
  // captions
  captionsOn: boolean; captionLines: CaptionLine[];
  // media prefs (persisted)
  blurOn: boolean; nsOn: boolean; blurSupported: boolean;
  joinMuted: boolean; joinCamOff: boolean;
  // real devices
  devices: DeviceLists;
  micId: string | null; camId: string | null; speakerId: string | null;
  canPickSpeaker: boolean;
  videoQuality: VideoQuality;
  // screen share detail
  shareHasAudio: boolean; shareAudioOnly: boolean;
  // viewport
  isNarrow: boolean;
  // grid pagination
  gridPage: number;
  // post
  rating: number; issues: string[]; ratedDone: boolean; postKind: 'left' | 'ended';
  // proto switcher
  protoOpen: boolean; devParticipantCount: number; devRole: 'host' | 'guest';
}

const initial: AppState = {
  screen: 'landing',
  user: null, bootChecked: false,
  authMode: 'signup', authName: '', email: '', authPassword: '', authError: null, authBusy: false,
  meetings: [], meetingsLoading: false,
  meeting: null,
  code: '', codeInvalid: false,
  newMenuOpen: false, joinModal: false, settingsTab: 'profile', optionsOpen: false,
  schedTitle: '', schedTime: '15:00', copied: false, clock: '', dateStr: '',
  schedOpts: [true, false, false, true], avOpts: [true, false, true], notifOpts: [true, true],
  permState: 'prompt', realCam: false, lobbyName: '', lobbyMic: true, lobbyCam: true, speakerTesting: false,
  joining: false, joinError: null,
  waitingId: null, waitingDenied: false,
  waitingGuests: [],
  peers: [], identity: '', isHost: false, isCoHost: false, devMode: false,
  view: 'grid', micMuted: false, camOff: false, sharing: false, hand: false,
  panel: false, tab: 'chat', reactionsOpen: false, moreOpen: false, leaveOpen: false, connPop: false,
  reconnecting: false, connQuality: ConnectionQuality.Unknown,
  shortcutsOpen: false,
  pinned: null, selfCollapsed: false, bars: true, youreIn: false,
  elapsedS: 0, unread: 0, chatInput: '',
  messages: [], bursts: [], toasts: [],
  chatToken: null, chatTo: null, unreadMention: false,
  canShare: true, canChat: true, canUnmute: true, hostPanelOpen: false,
  breakouts: [], breakoutsOpen: false, inBreakout: null, breakoutUi: false,
  breakoutBusy: false, breakoutDraft: [], breakoutAnnounce: '',
  tileOrder: null,
  recOn: false, recBusy: false,
  captionsOn: false, captionLines: [],
  blurOn: prefBool('diss_blur', false), nsOn: prefBool('diss_ns', true), blurSupported,
  joinMuted: prefBool('diss_joinmuted', false), joinCamOff: prefBool('diss_joincamoff', false),
  devices: { mics: [], cams: [], speakers: [] },
  micId: prefStr(MIC_KEY), camId: prefStr(CAM_KEY), speakerId: prefStr(SPK_KEY),
  canPickSpeaker: canSelectSpeaker(),
  videoQuality: storedQuality(),
  shareHasAudio: false, shareAudioOnly: false,
  isNarrow: typeof window !== 'undefined' && window.matchMedia('(max-width: 759px)').matches,
  gridPage: 0,
  rating: 0, issues: [], ratedDone: false, postKind: 'left',
  protoOpen: false, devParticipantCount: 5, devRole: 'host',
};

export const PALETTE = ['#8a5a44', '#5a7a6a', '#7a5a7a', '#5a6a8a', '#8a7a4a', '#6a5a8a', '#4a7a7a', '#8a5a5a', '#5a8a5a', '#7a6a5a', '#5a8a7a'];

// ── Dev fallback roster (ProtoNav preview of the meeting screen only) ─────────
const DEV_NAMES = ['Amara Okafor', 'Jonas Berg', 'Priya Nair', 'Diego Ramos', 'Nkechi Eze', 'Tom Alvarez', 'Sofia Lindqvist', 'Ravi Patel', 'Hana Kim'];

export function devFallbackPeers(s: AppState): Peer[] {
  const you: Peer = {
    identity: 'dev-you', name: s.lobbyName || s.user?.name || 'You', isLocal: true,
    micOn: !s.micMuted, camOn: !s.camOff, sharing: s.sharing, speaking: false,
    hand: s.hand, isHost: s.devRole === 'host', isCoHost: false, canShareScreen: true,
    videoTrack: null, audioTrack: null, screenTrack: null,
  };
  const others: Peer[] = DEV_NAMES.slice(0, Math.max(1, Math.min(9, s.devParticipantCount - 1))).map((name, i) => ({
    identity: `dev-${i}`, name, isLocal: false,
    micOn: i % 3 !== 2, camOn: false, sharing: false, speaking: false,
    hand: i === 4, isHost: s.devRole !== 'host' && i === 0,
    isCoHost: s.devRole === 'host' && i === 1,
    canShareScreen: i !== 2,
    videoTrack: null, audioTrack: null, screenTrack: null,
  }));
  return [you, ...others];
}

type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

export interface Store {
  s: AppState;
  patch: (p: Patch) => void;
  go: (screen: Screen, extra?: Partial<AppState>) => void;
  toast: (text: string, opts?: { sticky?: boolean }) => void;
  // auth
  submitAuth: () => Promise<void>;
  signOut: () => Promise<void>;
  // meetings
  loadMeetings: () => Promise<void>;
  createInstantMeeting: (camOn?: boolean) => Promise<void>;
  scheduleMeeting: () => Promise<void>;
  deleteMeeting: (id: number | string) => Promise<void>;
  openCode: (raw: string) => Promise<void>;
  openMeeting: (m: Meeting) => void;
  // room
  joinMeeting: () => Promise<void>;
  leaveMeeting: (kind: 'left' | 'ended') => void;
  endForAll: () => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  /** Called again while sharing (any mode) stops the share. Defaults to plain video sharing. */
  toggleShare: (mode?: ShareMode) => Promise<void>;
  toggleHand: () => void;
  sendReaction: (emoji: string) => void;
  togglePanel: (tab: 'chat' | 'people') => void;
  sendChat: () => void;
  /** Point the composer at one person (private) or at everyone (`null`). */
  setChatRecipient: (identity: string | null) => void;
  moderatePeer: (identity: string, action: ModerateAction) => Promise<void>;
  muteAll: () => Promise<void>;
  toggleRec: () => void;
  // breakout rooms (contract v4 §3)
  /** Open the planner / room list and pull the current server state. */
  openBreakoutUi: () => void;
  refreshBreakouts: () => Promise<void>;
  /** Planner edits (host, before the rooms exist). */
  setBreakoutRoomCount: (n: number) => void;
  renameBreakoutRoom: (idx: number, name: string) => void;
  assignToBreakout: (identity: string, idx: number | null) => void;
  autoAssignBreakouts: () => void;
  /** Create the drafted rooms and tell everyone in the main room to move. */
  startBreakouts: () => Promise<void>;
  /** Join my assigned room, or (host only) visit room `idx`. */
  joinBreakout: (idx?: number) => Promise<void>;
  returnToMain: () => Promise<void>;
  announceBreakout: () => void;
  closeBreakouts: () => Promise<void>;
  // local tile order
  setTileOrder: (order: string[] | null) => void;
  // waiting room
  cancelWaiting: () => void;
  actOnWaiting: (waitingId: string, action: 'admit' | 'deny') => Promise<void>;
  // meeting settings (host)
  setMeetingFlag: (body: {
    waitingRoom?: boolean; locked?: boolean;
    allowShare?: boolean; allowChat?: boolean; allowUnmute?: boolean;
  }) => Promise<void>;
  // media extras
  toggleCaptions: () => void;
  toggleJoinPref: (kind: 'muted' | 'camOff') => void;
  toggleBlur: () => void;
  toggleNs: () => void;
  togglePip: () => void;
  getRoom: () => Room | null;
  // real devices
  refreshDevices: () => Promise<void>;
  selectDevice: (kind: DeviceKind, deviceId: string | null) => Promise<void>;
  setVideoQuality: (q: VideoQuality) => Promise<void>;
  testSpeaker: () => Promise<void>;
  allowAccess: () => Promise<void>;
  copyLink: () => void;
  wake: () => void;
  enterDevMeeting: () => void;
  streamRef: React.MutableRefObject<MediaStream | null>;
}

const Ctx = createContext<Store>(null!);
export const useApp = () => useContext(Ctx);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export function AppProvider({ children }: { children: ReactNode }) {
  const [s, patch] = useReducer(
    (st: AppState, p: Patch) => ({ ...st, ...(typeof p === 'function' ? p(st) : p) }),
    initial,
  );
  const ref = useRef(s);
  ref.current = s;
  const streamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const handRef = useRef<Map<string, boolean>>(new Map());
  const leavingRef = useRef(false);
  const timers = useRef<{ hide?: number }>({});
  // waiting-room guests we've already announced (host side)
  const seenWaitingRef = useRef<Set<string>>(new Set());
  // guest-side waiting poll
  const waitPollRef = useRef<number | undefined>(undefined);
  // local speech recognition for captions
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const captionNotedRef = useRef(false);
  // hidden <audio> elements playing remote screen-share audio, keyed by track sid
  const shareAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // The MAIN room's token, kept so a breakout can always be left again. LiveKit
  // tokens live 6h and the meeting/chat token is per-MEETING, so the same grant
  // re-admits us to the main room without minting anything new.
  const mainTokenRef = useRef<TokenResponse | null>(null);
  // breakout poll: ticks are cheap, so people who aren't involved poll slower
  const breakoutTickRef = useRef(0);

  const store = useMemo<Store>(() => {
    const go: Store['go'] = (screen, extra) => patch({ screen, protoOpen: false, newMenuOpen: false, ...extra });

    const toast: Store['toast'] = (text, opts) => {
      const id = Math.random();
      patch(st => ({ toasts: [...st.toasts, { id, text, ...opts }] }));
      window.setTimeout(() => patch(st => ({ toasts: st.toasts.filter(t => t.id !== id) })), opts?.sticky ? 12000 : 4000);
    };

    const stopPreview = () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };

    // ── real devices ──────────────────────────────────────────────────────────
    /** Re-enumerate inputs/outputs. Labels only appear once permission is granted. */
    const refreshDevices = async () => {
      const devices = await listDevices();
      const st = ref.current;
      // Drop remembered ids whose device is gone, so we fall back to the system default.
      const alive = (id: string | null, list: MediaDeviceInfo[]) =>
        id && list.some(d => d.deviceId === id) ? id : id && list.length === 0 ? id : null;
      patch({
        devices,
        micId: alive(st.micId, devices.mics),
        camId: alive(st.camId, devices.cams),
        speakerId: alive(st.speakerId, devices.speakers),
      });
    };

    /** Start (or restart) the lobby preview with the currently selected devices. */
    const startPreview = async (): Promise<void> => {
      stopPreview();
      const st = ref.current;
      const want = (id: string | null): MediaTrackConstraints | true =>
        id ? { deviceId: { exact: id } } : true;
      const attempts: MediaStreamConstraints[] = [
        { audio: want(st.micId), video: want(st.camId) },
        // Remembered device unplugged → fall back to whatever the system offers.
        { audio: true, video: true },
      ];
      for (const constraints of attempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          streamRef.current = stream;
          patch({ permState: 'granted', realCam: stream.getVideoTracks().length > 0, joinError: null });
          await refreshDevices();
          return;
        } catch (e) {
          const name = (e as DOMException | undefined)?.name;
          if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') continue;
          if (name === 'NotAllowedError' || name === 'SecurityError') { patch({ permState: 'denied' }); return; }
          if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') { patch({ permState: 'busy' }); return; }
          if (name === 'NotFoundError' || name === 'DevicesNotFoundError') break;
          patch({ permState: 'denied' });
          return;
        }
      }
      // No camera (or nothing matched): still try for audio so the mic meter works.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        patch({ permState: 'nodevice', realCam: false });
        await refreshDevices();
      } catch {
        patch({ permState: 'nodevice', realCam: false });
      }
    };

    // ── LiveKit → state sync ──────────────────────────────────────────────────
    const buildPeers = (): Peer[] => {
      const room = roomRef.current;
      const st = ref.current;
      if (!room) return [];
      const speakers = new Set(room.activeSpeakers.map(p => p.identity));
      const hostIdentity = st.meeting ? `user-${st.meeting.hostUserId}` : '';
      const all = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
      return all.map(p => {
        const isLocal = p === room.localParticipant;
        const camPub = p.getTrackPublication(Track.Source.Camera);
        const micPub = p.getTrackPublication(Track.Source.Microphone);
        const scrPub = p.getTrackPublication(Track.Source.ScreenShare);
        return {
          identity: p.identity,
          name: p.name || p.identity,
          isLocal,
          micOn: !!micPub && !micPub.isMuted,
          camOn: !!camPub && !camPub.isMuted && !!camPub.track,
          // A computer-audio-only share publishes no video track, but the person
          // is still sharing something.
          sharing: (!!scrPub && !scrPub.isMuted)
            || !!p.getTrackPublication(Track.Source.ScreenShareAudio),
          speaking: speakers.has(p.identity),
          hand: handRef.current.get(p.identity) ?? false,
          isHost: isLocal ? ref.current.isHost : p.identity === hostIdentity,
          isCoHost: roleOf((p as Participant).metadata) === 'cohost',
          canShareScreen: mayPublish((p as Participant).permissions, SRC_SCREEN_SHARE),
          videoTrack: camPub?.track ?? null,
          audioTrack: !isLocal ? micPub?.track ?? null : null,
          screenTrack: scrPub?.track ?? null,
        };
      });
    };

    const sync = () => {
      const room = roomRef.current;
      if (!room) return;
      const peers = buildPeers();
      const you = peers.find(p => p.isLocal);
      const wasCoHost = ref.current.isCoHost;
      const isCoHost = !!you?.isCoHost;
      const stillSharing = !!you?.sharing;

      // Host controls are enforced in the token, so the truth about what I may
      // do lives on my own participant permissions — not on the meeting row,
      // which a guest never sees. The server updates these live (contract v4 §2)
      // and LiveKit raises ParticipantPermissionsChanged, which lands here.
      const perm = room.localParticipant.permissions as PermissionLike | undefined;
      const canShare = mayPublish(perm, SRC_SCREEN_SHARE);
      const canUnmute = mayPublish(perm, SRC_MICROPHONE);
      const canChat = perm?.canPublishData !== false;
      const prev = ref.current;

      patch(st => ({
        peers, canShare, canUnmute, canChat,
        micMuted: you ? !you.micOn : true,
        camOff: you ? !you.camOn : true,
        sharing: stillSharing,
        // The browser's own "Stop sharing" bar bypasses toggleShare — reset here too.
        shareHasAudio: stillSharing && st.shareHasAudio,
        shareAudioOnly: stillSharing && st.shareAudioOnly,
        hand: you ? you.hand : false,
        isCoHost,
      }));
      if (isCoHost !== wasCoHost && !ref.current.isHost) {
        toast(isCoHost ? "You're a co-host now — you can mute, remove, and admit people" : "You're no longer a co-host");
      }
      // Say it out loud when the host takes something away (or gives it back) —
      // a control that quietly stops working reads as a bug.
      if (canShare !== prev.canShare) {
        toast(canShare ? 'The host turned screen sharing back on' : 'The host has turned off screen sharing');
        if (!canShare && stillSharing) stopSharing().catch(() => {});
      }
      if (canChat !== prev.canChat) {
        toast(canChat ? 'The host turned chat back on' : 'The host has turned off chat for participants');
      }
      if (canUnmute !== prev.canUnmute) {
        toast(canUnmute ? 'You can unmute yourself again' : "The host has turned off unmuting — only the host can unmute you");
      }
      // mic state feeds the caption engine
      window.setTimeout(syncCaptionEngine, 0);
    };

    /**
     * `to` limits delivery to those identities at the SFU: a private message is
     * never sent to anyone else's browser, so no other client can surface it.
     */
    const publishJson = (topic: string, payload: Record<string, unknown>, to?: string[]) => {
      const room = roomRef.current;
      if (!room) return;
      room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(payload)), {
          topic,
          reliable: true,
          ...(to && to.length ? { destinationIdentities: to } : {}),
        })
        .catch(() => {});
    };

    const spawnBurst = (name: string) => {
      const id = Math.random();
      patch(st => ({ bursts: [...st.bursts, { id, name, x: `${35 + Math.random() * 30}%` }] }));
      window.setTimeout(() => patch(st => ({ bursts: st.bursts.filter(b => b.id !== id) })), 3600);
    };

    /** Merge a caption line into the overlay: interim lines replace the speaker's previous interim; finals keep the last ~2. */
    const pushCaption = (name: string, text: string, interim: boolean, ts: number) => {
      patch(st => {
        let lines = st.captionLines.filter(l => !(l.interim && l.name === name));
        if (interim) {
          if (text) lines = [...lines, { id: Math.random(), name, text, interim: true, ts }];
        } else if (text) {
          const finals = lines.filter(l => !l.interim);
          const interims = lines.filter(l => l.interim);
          lines = [...finals.slice(-1), { id: Math.random(), name, text, interim: false, ts }, ...interims];
        }
        return { captionLines: lines };
      });
    };

    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      let msg: {
        name?: string; text?: string; emoji?: string; up?: boolean; on?: boolean;
        interim?: boolean; ts?: number; to?: string; mentions?: string[];
        action?: string;
      };
      try {
        msg = JSON.parse(new TextDecoder().decode(payload));
      } catch { return; }
      const who = msg.name || participant?.name || participant?.identity || 'Someone';
      if (topic === 'chat' && typeof msg.text === 'string') {
        const st0 = ref.current;
        const to = typeof msg.to === 'string' ? msg.to : null;
        // Belt and braces: destinationIdentities already stopped this reaching
        // anyone else, but never render a DM that isn't addressed to me.
        if (to && to !== st0.identity) return;
        const mentions = Array.isArray(msg.mentions) ? msg.mentions.filter(m => typeof m === 'string') : [];
        const pingsMe = mentionsMe(mentions, st0.identity);
        const chatOpen = st0.panel && st0.tab === 'chat';
        patch(st => ({
          messages: [...st.messages, {
            who, text: msg.text!, mine: false,
            ts: typeof msg.ts === 'number' ? msg.ts : Date.now(),
            toIdentity: to, mentions, mentionsMe: pingsMe,
          }],
          unread: chatOpen ? 0 : st.unread + 1,
          unreadMention: chatOpen ? false : st.unreadMention || pingsMe || !!to,
        }));
        if (!chatOpen) {
          const preview = msg.text.slice(0, 60);
          toast(to ? `Private message from ${who}: ${preview}`
            : pingsMe ? `${who} mentioned you: ${preview}`
            : `${who}: ${preview}`);
        }
      } else if (topic === 'reaction' && typeof msg.emoji === 'string') {
        spawnBurst(msg.emoji);
      } else if (topic === 'hand' && participant) {
        const up = !!msg.up;
        handRef.current.set(participant.identity, up);
        if (up) toast(`${who} raised their hand`);
        sync();
      } else if (topic === 'recording' && typeof msg.on === 'boolean') {
        if (msg.on !== ref.current.recOn) {
          patch({ recOn: msg.on });
          toast(msg.on ? 'This meeting is being recorded' : 'Recording stopped');
        }
      } else if (topic === 'caption' && typeof msg.text === 'string') {
        pushCaption(who, msg.text.trim(), !!msg.interim, typeof msg.ts === 'number' ? msg.ts : Date.now());
      } else if (topic === 'breakout') {
        // Contract v4 §3 — the host broadcasts this in the room it applies to.
        const st0 = ref.current;
        if (msg.action === 'open') {
          refreshBreakouts();
          // Already somewhere else, or nothing to authenticate with: stay put.
          if (st0.inBreakout || st0.devMode || !st0.chatToken) return;
          joinBreakout().catch(() => {});
        } else if (msg.action === 'close') {
          patch({ breakouts: [], breakoutsOpen: false });
          if (st0.inBreakout) returnToMain().catch(() => {});
        } else if (msg.action === 'announce' && typeof msg.text === 'string' && msg.text.trim()) {
          toast(`${who}: ${msg.text.trim().slice(0, 200)}`, { sticky: true });
        }
      }
    };

    // ── local captions (Web Speech API) ──────────────────────────────────────
    const stopCaptionEngine = () => {
      const rec = speechRef.current;
      if (!rec) return;
      speechRef.current = null;
      rec.onend = null;
      rec.onresult = null;
      try { rec.stop(); } catch { /* already stopped */ }
    };

    const syncCaptionEngine = () => {
      const st = ref.current;
      const shouldRun = st.captionsOn && !st.micMuted && !!roomRef.current && st.screen === 'meeting' && !st.devMode;
      if (!shouldRun) { stopCaptionEngine(); return; }
      if (speechRef.current) return;
      const Ctor = speechCtor();
      if (!Ctor) return; // unsupported — we still render captions from others
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (e) => {
        const c = ref.current;
        const name = c.lobbyName || c.user?.name || 'You';
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const text = r[0].transcript.trim();
            if (text) {
              const ts = Date.now();
              pushCaption(name, text, false, ts);
              publishJson('caption', { name, text, interim: false, ts });
            }
          } else {
            interimText += r[0].transcript;
          }
        }
        const ts = Date.now();
        pushCaption(name, interimText.trim(), true, ts);
        if (interimText.trim()) publishJson('caption', { name, text: interimText.trim(), interim: true, ts });
      };
      rec.onerror = () => { /* transient — onend restarts if still wanted */ };
      rec.onend = () => {
        if (speechRef.current === rec) speechRef.current = null;
        window.setTimeout(syncCaptionEngine, 400);
      };
      speechRef.current = rec;
      try { rec.start(); } catch { speechRef.current = null; }
    };

    // ── remote screen-share audio ────────────────────────────────────────────
    // Nothing in the tile UI renders a ScreenShareAudio track, so the media layer
    // owns playback: a hidden <audio> per subscribed track, on the chosen speaker.
    const attachShareAudio = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      if (pub.source !== Track.Source.ScreenShareAudio || track.kind !== Track.Kind.Audio) return;
      if (shareAudioRef.current.has(pub.trackSid)) return;
      const el = track.attach() as HTMLAudioElement;
      el.autoplay = true;
      el.style.display = 'none';
      document.body.appendChild(el);
      shareAudioRef.current.set(pub.trackSid, el);
      applySinkId(el, ref.current.speakerId).catch(() => {});
      el.play().catch(() => { /* autoplay policy — the meeting already has a gesture */ });
    };

    const detachShareAudio = (track: RemoteTrack, pub: RemoteTrackPublication) => {
      const el = shareAudioRef.current.get(pub.trackSid);
      if (!el) return;
      shareAudioRef.current.delete(pub.trackSid);
      try { track.detach(el); } catch { /* already detached */ }
      el.remove();
    };

    const clearShareAudio = () => {
      shareAudioRef.current.forEach(el => { el.pause(); el.srcObject = null; el.remove(); });
      shareAudioRef.current.clear();
    };

    const wireRoom = (room: Room) => {
      room
        .on(RoomEvent.ParticipantConnected, p => {
          toast(`${p.name || p.identity} joined`);
          sync();
          // Late joiners have no way to fetch recording state — anyone who knows it's on re-broadcasts.
          if (ref.current.recOn) {
            window.setTimeout(() => { if (ref.current.recOn) publishJson('recording', { on: true, ts: Date.now() }); }, 1000);
          }
        })
        .on(RoomEvent.ParticipantMetadataChanged, () => sync())
        // Host controls are applied live to people already in the room
        // (contract v4 §2) — this is how a denied control learns it's denied.
        .on(RoomEvent.ParticipantPermissionsChanged, () => sync())
        .on(RoomEvent.ParticipantDisconnected, p => { handRef.current.delete(p.identity); sync(); })
        .on(RoomEvent.TrackPublished, sync)
        .on(RoomEvent.TrackUnpublished, sync)
        .on(RoomEvent.TrackSubscribed, (track, pub) => { attachShareAudio(track, pub); sync(); })
        .on(RoomEvent.TrackUnsubscribed, (track, pub) => { detachShareAudio(track, pub); sync(); })
        .on(RoomEvent.TrackMuted, sync)
        .on(RoomEvent.TrackUnmuted, sync)
        .on(RoomEvent.LocalTrackPublished, sync)
        .on(RoomEvent.LocalTrackUnpublished, sync)
        .on(RoomEvent.ActiveSpeakersChanged, sync)
        .on(RoomEvent.ParticipantNameChanged, sync)
        .on(RoomEvent.Reconnecting, () => patch({ reconnecting: true }))
        .on(RoomEvent.Reconnected, () => { patch({ reconnecting: false }); toast("You're back — connection restored"); sync(); })
        .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
          if (participant.isLocal) patch({ connQuality: quality });
        })
        .on(RoomEvent.DataReceived, onData)
        .on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          stopCaptionEngine();
          clearShareAudio();
          // A breakout room that dies under us (host closed it server-side, the
          // room was emptied, we were removed) must never strand anyone in a
          // dead room: go back to the main meeting instead of ending the call.
          if (!leavingRef.current && ref.current.screen === 'meeting' && ref.current.inBreakout) {
            returnToMain().catch(() => {});
            return;
          }
          if (!leavingRef.current && ref.current.screen === 'meeting') {
            patch({
              screen: 'post', postKind: 'ended', peers: [], panel: false, leaveOpen: false,
              reconnecting: false, sharing: false, hand: false, reactionsOpen: false, moreOpen: false,
              rating: 0, issues: [], ratedDone: false,
              recOn: false, recBusy: false, captionLines: [], waitingGuests: [], isCoHost: false, gridPage: 0,
              chatToken: null, chatTo: null, unreadMention: false, hostPanelOpen: false,
              breakouts: [], breakoutsOpen: false, inBreakout: null, breakoutUi: false,
              breakoutBusy: false, breakoutDraft: [], breakoutAnnounce: '', tileOrder: null,
            });
          }
        });
    };

    const stopWaitingPoll = () => {
      window.clearInterval(waitPollRef.current);
      waitPollRef.current = undefined;
    };

    const disconnectRoom = () => {
      leavingRef.current = true;
      stopCaptionEngine();
      stopWaitingPoll();
      clearShareAudio();
      const room = roomRef.current;
      roomRef.current = null;
      handRef.current = new Map();
      room?.disconnect();
    };

    // ── auth ──────────────────────────────────────────────────────────────────
    const submitAuth = async () => {
      const st = ref.current;
      const email = st.email.trim();
      const password = st.authPassword;
      const name = st.authName.trim();
      const signup = st.authMode === 'signup';
      if (!/.+@.+\..+/.test(email)) { patch({ authError: "Hmm, that doesn't look like an email address." }); return; }
      if (signup && !name) { patch({ authError: 'Tell us your name so people know who joined.' }); return; }
      if (password.length < 8) { patch({ authError: 'Password needs at least 8 characters.' }); return; }
      patch({ authBusy: true, authError: null });
      try {
        const { user } = signup ? await api.register(name, email, password) : await api.login(email, password);
        patch({ user, authBusy: false, authPassword: '', lobbyName: ref.current.lobbyName || user.name });
        go('dash');
        loadMeetings();
      } catch (e) {
        const msg = e instanceof ApiError && e.status === 409 ? 'That email already has an account — sign in instead.'
          : e instanceof ApiError && e.status === 401 ? "That email and password don't match."
          : errMsg(e);
        patch({ authBusy: false, authError: msg });
      }
    };

    const signOut = async () => {
      try { await api.logout(); } catch { /* clearing locally regardless */ }
      disconnectRoom();
      patch({ user: null, meetings: [], meeting: null, lobbyName: '' });
      go('landing');
    };

    // ── meetings ──────────────────────────────────────────────────────────────
    const loadMeetings = async () => {
      if (!ref.current.user) return;
      patch({ meetingsLoading: true });
      try {
        const { meetings } = await api.listMeetings();
        patch({ meetings, meetingsLoading: false });
      } catch (e) {
        patch({ meetingsLoading: false });
        if (e instanceof ApiError && e.status === 401) patch({ user: null });
        else toast(errMsg(e));
      }
    };

    const openMeeting: Store['openMeeting'] = (m) => {
      go('lobby', {
        meeting: m, permState: 'prompt', joinError: null, joining: false,
        lobbyName: ref.current.lobbyName || ref.current.user?.name || '',
        lobbyMic: !ref.current.joinMuted, lobbyCam: !ref.current.joinCamOff,
      });
    };

    const createInstantMeeting = async (camOn = true) => {
      try {
        const { meeting } = await api.createMeeting({});
        openMeeting(meeting);
        patch({ lobbyCam: camOn });
      } catch (e) { toast(errMsg(e)); }
    };

    const scheduleMeeting = async () => {
      const st = ref.current;
      const [h, m] = st.schedTime.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      try {
        let { meeting } = await api.createMeeting({ title: st.schedTitle.trim() || 'Untitled meeting', startsAt: d.toISOString() });
        // "Waiting room" option from the schedule form (contract v2 PATCH)
        if (st.schedOpts[0]) {
          try {
            meeting = (await api.patchMeeting(meeting.id, { waitingRoom: true })).meeting;
          } catch { /* meeting still created — the host can turn it on in-call */ }
        }
        go('schedDone', { meeting, copied: false });
        loadMeetings();
      } catch (e) { toast(errMsg(e)); }
    };

    const deleteMeeting = async (id: number | string) => {
      try {
        await api.deleteMeeting(id);
        patch(st => ({ meetings: st.meetings.filter(m => m.id !== id) }));
        toast('Meeting deleted');
      } catch (e) { toast(errMsg(e)); }
    };

    const openCode = async (raw: string) => {
      const code = extractCode(raw);
      if (!code) { patch({ codeInvalid: true }); return; }
      try {
        const { meeting } = await api.getMeeting(code);
        patch({ joinModal: false, code: '', codeInvalid: false });
        openMeeting(meeting);
      } catch {
        patch({ codeInvalid: true });
      }
    };

    // ── room ──────────────────────────────────────────────────────────────────
    /** Apply or remove the background-blur processor on the local camera track. */
    const applyBlur = async (on: boolean) => {
      const room = roomRef.current;
      if (!room || !ref.current.blurSupported) return;
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
      if (!track) return;
      if (on) {
        if (track.getProcessor()) return;
        await track.setProcessor(BackgroundProcessor({ mode: 'background-blur', blurRadius: 10 }));
      } else if (track.getProcessor()) {
        await track.stopProcessor();
      }
    };

    /**
     * Connect to LiveKit with a granted token.
     *
     * This is the ONLY connect path: direct join, admitted-from-the-waiting-room,
     * joining a breakout and coming back from one all land here, so tracks,
     * blur, noise suppression, quality, captions, permission wiring and every
     * room event handler are established the same way every time.
     *
     * `breakout` says which room this token is for — null means the main room.
     */
    const connectWithToken = async (
      { token, url, identity, isHost, chatToken }: TokenResponse,
      breakout: BreakoutHere | null = null,
    ) => {
      const st = ref.current;
      // Moving between rooms mid-meeting: carry my live mic/camera state across
      // rather than re-applying the lobby's "join muted" preferences.
      const switching = st.screen === 'meeting' && !!st.identity;
      const wantMic = switching ? !st.micMuted : st.lobbyMic;
      const wantCam = switching ? !st.camOff : st.lobbyCam;
      stopPreview();
      const preset = qualityPreset(st.videoQuality);
      const room = new Room({
        // Only send/receive what's actually on screen.
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          noiseSuppression: st.nsOn,
          echoCancellation: st.nsOn,
          ...(st.micId ? { deviceId: st.micId } : {}),
        },
        videoCaptureDefaults: {
          resolution: preset.resolution,
          ...(st.camId ? { deviceId: st.camId } : {}),
        },
        publishDefaults: {
          simulcast: true,
          videoEncoding: preset.encoding,
          screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        },
      });
      wireRoom(room);
      roomRef.current = room;
      handRef.current = new Map();
      seenWaitingRef.current = new Set();
      leavingRef.current = false;
      await room.connect(url, token);
      if (!breakout) mainTokenRef.current = { token, url, identity, isHost, chatToken };
      patch({
        screen: 'meeting', devMode: false, identity, isHost, joining: false,
        youreIn: true, elapsedS: switching ? ref.current.elapsedS : 0, panel: false, view: 'grid', pinned: null,
        messages: [], unread: 0, bursts: [], hand: false, sharing: false,
        micMuted: !wantMic, camOff: !wantCam, reconnecting: false,
        connQuality: ConnectionQuality.Unknown, protoOpen: false,
        waitingId: null, waitingDenied: false, waitingGuests: [],
        isCoHost: false, recOn: false, captionLines: [], gridPage: 0,
        shareHasAudio: false, shareAudioOnly: false,
        chatToken: chatToken ?? null, chatTo: null, unreadMention: false, hostPanelOpen: false,
        canShare: true, canChat: true, canUnmute: true,
        inBreakout: breakout, breakoutUi: false, breakoutAnnounce: '',
        ...(breakout ? {} : { breakoutDraft: [] }),
        // The layout you arranged is yours and per-meeting — it survives a trip
        // into a breakout room and back.
        tileOrder: st.meeting ? loadTileOrder(st.meeting.code) : null,
      });
      window.setTimeout(() => patch({ youreIn: false }), 1400);
      if (st.speakerId && canSelectSpeaker()) {
        room.switchActiveDevice('audiooutput', st.speakerId).catch(() => { /* device vanished */ });
      }
      try {
        if (wantMic) await room.localParticipant.setMicrophoneEnabled(true);
        if (wantCam) await room.localParticipant.setCameraEnabled(true);
      } catch {
        toast("Couldn't start your mic or camera — you can still watch and listen");
      }
      if (wantCam && st.blurOn) applyBlur(true).catch(() => {});
      // Seed the chat panel with persisted history. The server filters this to
      // what the chatToken's identity may see — public messages plus their own
      // DMs — so nothing here can leak someone else's private thread.
      //
      // NOT in a breakout: persisted history is stored per MEETING, so pulling
      // it in would drop the main-room transcript into a side room (and, with
      // the matching POST, drop side-room chat into the transcript). Breakout
      // chat is live-only over this room's data channel — see `sendChat`.
      const meetingCode = breakout ? undefined : st.meeting?.code;
      if (meetingCode && chatToken) {
        api.listMessages(meetingCode, chatToken).then(({ messages }) => {
          if (roomRef.current !== room || messages.length === 0) return;
          const nameFor = (id: string) =>
            messages.find(m => m.identity === id)?.displayName
            ?? roomRef.current?.getParticipantByIdentity(id)?.name
            ?? 'them';
          const history: ChatMessage[] = messages.map(m => ({
            who: m.displayName,
            text: m.text,
            mine: m.identity === identity,
            ts: new Date(m.ts).getTime() || Date.now(),
            history: true,
            toIdentity: m.toIdentity ?? null,
            toName: m.toIdentity ? (m.toIdentity === identity ? 'you' : nameFor(m.toIdentity)) : undefined,
            mentions: m.mentions ?? [],
            mentionsMe: mentionsMe(m.mentions, identity) && m.identity !== identity,
          }));
          patch(c => ({ messages: [...history, ...c.messages] }));
        }).catch(() => { /* history is a nice-to-have */ });
      }
      sync();
    };

    const startWaitingPoll = (code: string, waitingId: string) => {
      stopWaitingPoll();
      waitPollRef.current = window.setInterval(async () => {
        const st = ref.current;
        if (st.screen !== 'waiting' || st.waitingId !== waitingId) { stopWaitingPoll(); return; }
        try {
          const res = await api.waitingStatus(code, waitingId);
          if (res.status === 'admitted') {
            stopWaitingPoll();
            try {
              await connectWithToken(res);
            } catch (e) {
              disconnectRoom();
              patch({ screen: 'lobby', joinError: errMsg(e), joining: false, waitingId: null });
            }
          } else if (res.status === 'denied') {
            stopWaitingPoll();
            patch({ waitingDenied: true });
          }
        } catch (e) {
          // 404 = pruned/unknown entry; treat like a denial. Network blips: keep polling.
          if (e instanceof ApiError && e.status === 404) {
            stopWaitingPoll();
            patch({ waitingDenied: true });
          }
        }
      }, 2000);
    };

    const cancelWaiting = () => {
      stopWaitingPoll();
      patch({ waitingId: null, waitingDenied: false, joining: false });
      go(ref.current.user ? 'dash' : 'landing');
    };

    const joinMeeting = async () => {
      let st = ref.current;
      const meeting = st.meeting;
      if (!meeting) { toast('Pick a meeting to join first'); return; }
      let displayName = st.lobbyName.trim() || st.user?.name || '';
      if (!displayName && !st.bootChecked) {
        // The session restore (GET /api/auth/me) can still be in flight: a
        // signed-in member who opens a join link directly lands in the lobby
        // with an empty name box until it resolves. Locally that race is
        // invisible (the request takes milliseconds), but over real network
        // latency a quick click would tell them to type a name they have
        // already given us. Wait for the session instead.
        const until = Date.now() + 3000;
        while (!ref.current.bootChecked && Date.now() < until) {
          await new Promise(r => setTimeout(r, 50));
        }
        st = ref.current;
        displayName = st.lobbyName.trim() || st.user?.name || '';
      }
      if (!displayName) { patch({ joinError: 'Enter your name so people know who joined.' }); return; }
      if (st.joining) return;
      patch({ joining: true, joinError: null });
      try {
        const resp = await api.meetingToken(meeting.code, displayName);
        if ('waitingId' in resp) {
          // 202 — the waiting room is on; poll until the host decides
          patch({ joining: false, waitingId: resp.waitingId, waitingDenied: false, screen: 'waiting' });
          startWaitingPoll(meeting.code, resp.waitingId);
          return;
        }
        await connectWithToken(resp);
      } catch (e) {
        disconnectRoom();
        const msg = e instanceof ApiError && e.status === 423
          ? "This meeting is locked — the host isn't letting anyone else in right now."
          : errMsg(e);
        patch({ joining: false, joinError: msg });
      }
    };

    const leaveMeeting: Store['leaveMeeting'] = (kind) => {
      disconnectRoom();
      mainTokenRef.current = null;
      patch({
        screen: 'post', postKind: kind, leaveOpen: false, panel: false,
        rating: 0, issues: [], ratedDone: false, peers: [], devMode: false,
        sharing: false, hand: false, reactionsOpen: false, moreOpen: false, reconnecting: false,
        recOn: false, recBusy: false, captionLines: [], waitingGuests: [], isCoHost: false, gridPage: 0,
        chatToken: null, chatTo: null, unreadMention: false, hostPanelOpen: false,
        breakouts: [], breakoutsOpen: false, inBreakout: null, breakoutUi: false,
        breakoutBusy: false, breakoutDraft: [], breakoutAnnounce: '', tileOrder: null,
      });
    };

    const endForAll = async () => {
      const st = ref.current;
      const code = st.meeting?.code;
      if (code && st.isHost) {
        // Close the side rooms first: ending the meeting must not leave people
        // talking to each other in a breakout nobody is coming back to.
        if (st.breakoutsOpen) {
          publishJson('breakout', { action: 'close', ts: Date.now() });
          await api.closeBreakouts(code).catch(() => {});
        }
        const remotes = st.peers.filter(p => !p.isLocal);
        await Promise.allSettled(remotes.map(p => api.moderate(code, 'remove', p.identity)));
      }
      leaveMeeting('ended');
    };

    const toggleMic = () => {
      const room = roomRef.current;
      if (!room) { patch(st => ({ micMuted: !st.micMuted })); return; }
      const enable = ref.current.micMuted;
      // Enforced in the token: publishing the mic would simply be rejected.
      if (enable && !ref.current.canUnmute) {
        toast("The host has turned off unmuting — ask them to unmute you");
        return;
      }
      room.localParticipant.setMicrophoneEnabled(enable)
        .then(sync)
        .catch(() => toast("Couldn't switch your mic — check browser permissions"));
    };

    const toggleCam = () => {
      const room = roomRef.current;
      if (!room) { patch(st => ({ camOff: !st.camOff })); return; }
      const enable = ref.current.camOff;
      room.localParticipant.setCameraEnabled(enable)
        .then(() => {
          sync();
          if (enable && ref.current.blurOn) applyBlur(true).catch(() => {});
        })
        .catch(() => toast("Couldn't switch your camera — check browser permissions"));
    };

    /** Tear down whatever kind of share is running (video, video+audio, or audio only). */
    const stopSharing = async () => {
      const room = roomRef.current;
      if (!room) return;
      const lp = room.localParticipant;
      try {
        await lp.setScreenShareEnabled(false);
      } catch { /* nothing published, or already gone */ }
      // Audio-only shares are published by hand, so unpublish them by hand too.
      const audioPub = lp.getTrackPublication(Track.Source.ScreenShareAudio);
      if (audioPub?.track) {
        try { await lp.unpublishTrack(audioPub.track as LocalTrack, true); } catch { /* already gone */ }
      }
      patch({ sharing: false, shareHasAudio: false, shareAudioOnly: false });
      sync();
    };

    const toggleShare = async (requested: ShareMode = 'screen') => {
      const room = roomRef.current;
      if (!room) {
        // Dev preview of the meeting screen — no room to publish to.
        patch(st => ({ sharing: !st.sharing, shareHasAudio: false, shareAudioOnly: false }));
        return;
      }
      if (ref.current.sharing) { await stopSharing(); return; }
      if (!ref.current.canShare) {
        toast('The host has turned off screen sharing for participants');
        return;
      }

      let mode = requested;
      if (mode !== 'screen' && !canCaptureDisplayAudio()) {
        toast(mode === 'audio'
          ? "This browser can't share computer sound — try Chrome or Edge"
          : "This browser can't capture screen audio — sharing the picture only. Try Chrome or Edge for sound.");
        if (mode === 'audio') return;
        mode = 'screen';
      }

      const lp = room.localParticipant;
      try {
        if (mode === 'audio') {
          // getDisplayMedia always needs a surface; we publish only its audio and
          // drop the video immediately, so nobody sees a picture.
          const tracks = await lp.createScreenTracks({
            audio: true,
            video: true,
            systemAudio: 'include',
            selfBrowserSurface: 'include',
          });
          const audio = tracks.find(t => t.kind === Track.Kind.Audio);
          tracks.filter(t => t !== audio).forEach(t => { t.stop(); });
          if (!audio) {
            toast("No computer sound was shared — tick “Share tab audio” in the picker and try again");
            return;
          }
          await lp.publishTrack(audio, { source: Track.Source.ScreenShareAudio });
          patch({ sharing: true, shareHasAudio: true, shareAudioOnly: true });
          sync();
          toast('Sharing your computer sound — no video, just audio');
          return;
        }

        await lp.setScreenShareEnabled(true, {
          audio: mode === 'screen-audio',
          ...(mode === 'screen-audio' ? { systemAudio: 'include' as const } : {}),
          contentHint: 'motion',
        });
        const gotAudio = !!lp.getTrackPublication(Track.Source.ScreenShareAudio);
        patch({ sharing: true, shareHasAudio: gotAudio, shareAudioOnly: false });
        sync();
        if (mode === 'screen-audio' && !gotAudio) {
          toast("You're sharing — but no sound came through. Tick “Share tab audio” in the picker to include it.");
        } else {
          toast(gotAudio
            ? 'You started sharing — everyone sees your screen and hears its sound'
            : 'You started sharing — everyone sees your screen');
        }
      } catch {
        // Almost always the user dismissing the picker.
        patch({ shareHasAudio: false, shareAudioOnly: false });
        sync();
      }
    };

    // ── device selection / quality ────────────────────────────────────────────
    const selectDevice = async (kind: DeviceKind, deviceId: string | null) => {
      const key = kind === 'mic' ? MIC_KEY : kind === 'cam' ? CAM_KEY : SPK_KEY;
      setPrefStr(key, deviceId);
      patch(kind === 'mic' ? { micId: deviceId } : kind === 'cam' ? { camId: deviceId } : { speakerId: deviceId });

      const room = roomRef.current;
      if (kind === 'speaker') {
        if (!canSelectSpeaker()) return;
        // Re-point every element we own; LiveKit handles the ones it attached.
        await Promise.all(Array.from(shareAudioRef.current.values()).map(el => applySinkId(el, deviceId)));
        if (room) {
          try { await room.switchActiveDevice('audiooutput', deviceId ?? 'default'); }
          catch { toast("Couldn't switch your speaker — that device may be unavailable"); }
        }
        return;
      }

      const lkKind: MediaDeviceKind = kind === 'mic' ? 'audioinput' : 'videoinput';
      if (room) {
        try {
          await room.switchActiveDevice(lkKind, deviceId ?? 'default');
          if (kind === 'cam' && ref.current.blurOn) applyBlur(true).catch(() => {});
          sync();
        } catch {
          toast(kind === 'mic'
            ? "Couldn't switch your microphone — that device may be in use"
            : "Couldn't switch your camera — that device may be in use");
        }
        return;
      }
      // Lobby: restart the preview so the change is visible/audible immediately.
      if (ref.current.screen === 'lobby' || streamRef.current) await startPreview();
    };

    const setVideoQuality = async (q: VideoQuality) => {
      setPrefStr(QUAL_KEY, q);
      patch({ videoQuality: q });
      const room = roomRef.current;
      if (!room) return;
      const preset = qualityPreset(q);
      // Future publishes (camera re-enable, reconnect) pick the new tier up too.
      room.options.videoCaptureDefaults = { ...room.options.videoCaptureDefaults, resolution: preset.resolution };
      room.options.publishDefaults = { ...room.options.publishDefaults, simulcast: true, videoEncoding: preset.encoding };
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
      if (!track) return;
      try {
        await track.restartTrack({
          resolution: preset.resolution,
          ...(ref.current.camId ? { deviceId: ref.current.camId } : {}),
        });
        if (ref.current.blurOn) applyBlur(true).catch(() => {});
        sync();
        toast(q === 'high' ? 'Hi-Res video on — 1080p when your connection allows'
          : q === 'saver' ? 'Data saver on — lower resolution, less bandwidth'
          : 'Video quality set to automatic');
      } catch {
        toast("Couldn't change your video quality — your camera may not support it");
      }
    };

    const toggleHand = () => {
      const st = ref.current;
      const up = !st.hand;
      const room = roomRef.current;
      if (room) {
        handRef.current.set(room.localParticipant.identity, up);
        publishJson('hand', { name: st.lobbyName || st.user?.name || 'You', up, ts: Date.now() });
        sync();
      }
      patch({ hand: up, reactionsOpen: false });
      if (up) toast("Your hand is up — the host can see it");
    };

    const sendReaction = (emoji: string) => {
      const st = ref.current;
      patch({ reactionsOpen: false });
      spawnBurst(emoji);
      publishJson('reaction', { name: st.lobbyName || st.user?.name || 'You', emoji, ts: Date.now() });
    };

    /** Everyone the composer can address / mention: the live roster, or the dev roster. */
    const rosterOf = (st: AppState): Peer[] => (st.devMode ? devFallbackPeers(st) : st.peers);

    const setChatRecipient: Store['setChatRecipient'] = (identity) => {
      patch({ chatTo: identity, panel: true, tab: 'chat', unread: 0, unreadMention: false });
    };

    const sendChat = () => {
      const st = ref.current;
      const text = st.chatInput.trim().slice(0, 2000);
      if (!text) return;
      if (!st.canChat) { toast('The host has turned off chat for participants'); return; }
      const name = st.lobbyName || st.user?.name || 'You';
      const roster = rosterOf(st);
      const mentions = resolveMentions(text, roster.map(p => ({ identity: p.identity, name: p.name })));

      // A recipient who has left goes back to everyone rather than silently
      // vanishing into a DM nobody can read.
      const target = st.chatTo ? roster.find(p => p.identity === st.chatTo && !p.isLocal) : undefined;
      if (st.chatTo && !target) toast('That person has left — sent to everyone instead');
      const toIdentity = target ? target.identity : null;
      const ts = Date.now();

      patch(c => ({
        messages: [...c.messages, {
          who: 'You', text, mine: true, ts,
          toIdentity, toName: target?.name, mentions,
        }],
        chatInput: '',
        chatTo: toIdentity,
      }));
      publishJson(
        'chat',
        { name, text, ts, ...(toIdentity ? { to: toIdentity } : {}), ...(mentions.length ? { mentions } : {}) },
        toIdentity ? [toIdentity] : undefined,
      );
      // Persist (fire-and-forget) so late joiners see history. Identity and
      // display name come from the chatToken server-side, never from us.
      //
      // Never from inside a breakout: the store is per MEETING, so persisting
      // side-room chatter would splice it into the main transcript for everyone.
      // In a breakout the data channel above is the whole story — live, isolated
      // to that LiveKit room, and not saved.
      if (st.meeting && !st.devMode && st.chatToken && !st.inBreakout) {
        api.postMessage(st.meeting.code, {
          chatToken: st.chatToken,
          text,
          ...(toIdentity ? { toIdentity } : {}),
          ...(mentions.length ? { mentions } : {}),
        }).catch(() => {});
      }
    };

    const moderatePeer = async (identity: string, action: ModerateAction) => {
      const st = ref.current;
      if (!st.meeting || st.devMode) return;
      const promoting = action === 'promote' || action === 'demote';
      if (promoting ? !st.isHost : !(st.isHost || st.isCoHost)) return;
      const peer = st.peers.find(p => p.identity === identity);
      const first = (peer?.name || identity).split(' ')[0];
      try {
        await api.moderate(st.meeting.code, action, identity);
        toast(
          action === 'mute' ? `Muted ${first}`
          : action === 'remove' ? `Removed ${first} from the meeting`
          : action === 'promote' ? `${first} is a co-host now`
          : action === 'demote' ? `${first} is no longer a co-host`
          : action === 'allow-share' ? `${first} can share their screen`
          : `${first} can no longer share their screen`,
        );
      } catch (e) { toast(errMsg(e)); }
    };

    const muteAll = async () => {
      const st = ref.current;
      if (!st.meeting || !(st.isHost || st.isCoHost)) return;
      const remotes = st.peers.filter(p => !p.isLocal && p.micOn && !p.isHost);
      await Promise.allSettled(remotes.map(p => api.moderate(st.meeting!.code, 'mute', p.identity)));
      toast('Everyone is muted — they can unmute themselves');
    };

    // ── waiting room (host side) ──────────────────────────────────────────────
    const actOnWaiting = async (waitingId: string, action: 'admit' | 'deny') => {
      const st = ref.current;
      if (!st.meeting) return;
      const guest = st.waitingGuests.find(g => g.waitingId === waitingId);
      patch(c => ({ waitingGuests: c.waitingGuests.filter(g => g.waitingId !== waitingId) }));
      try {
        await api.waitingAct(st.meeting.code, waitingId, action);
        toast(action === 'admit' ? `Letting ${guest?.displayName ?? 'the guest'} in` : `${guest?.displayName ?? 'The guest'} was turned away`);
      } catch (e) { toast(errMsg(e)); }
    };

    // ── meeting settings (host only) ──────────────────────────────────────────
    const setMeetingFlag: Store['setMeetingFlag'] = async (body) => {
      const m = ref.current.meeting;
      if (!m) return;
      try {
        const { meeting } = await api.patchMeeting(m.id, body);
        patch({ meeting });
        if (body.locked !== undefined) toast(body.locked ? 'Meeting locked — no one new can join' : 'Meeting unlocked');
        if (body.waitingRoom !== undefined) toast(body.waitingRoom ? 'Waiting room is on — new guests wait for you' : 'Waiting room is off');
        // Host controls: the server re-applies these to everyone already in the
        // room, so the wording is about what participants can do right now.
        if (body.allowShare !== undefined) toast(body.allowShare ? 'Participants can share their screen' : 'Only hosts can share their screen now');
        if (body.allowChat !== undefined) toast(body.allowChat ? 'Participants can chat' : 'Chat is off for participants');
        if (body.allowUnmute !== undefined) toast(body.allowUnmute ? 'Participants can unmute themselves' : 'Participants can no longer unmute themselves');
      } catch (e) {
        toast(e instanceof ApiError && e.status === 403 ? 'Only the host can change these settings' : errMsg(e));
      }
    };

    // ── recording ─────────────────────────────────────────────────────────────
    const toggleRec = () => {
      const st = ref.current;
      patch({ moreOpen: false });
      if (st.devMode) { toast('Recording needs a real meeting connection'); return; }
      if (!st.meeting || !(st.isHost || st.isCoHost) || st.recBusy) return;
      const starting = !st.recOn;
      patch({ recBusy: true });
      api.recording(st.meeting.code, starting ? 'start' : 'stop')
        .then(() => {
          patch({ recOn: starting, recBusy: false });
          publishJson('recording', { on: starting, ts: Date.now() });
          toast(starting ? 'Recording — everyone can see the REC light' : 'Recording stopped and saved');
        })
        .catch((e: unknown) => {
          patch({ recBusy: false });
          if (e instanceof ApiError && e.status === 503) {
            toast("Recording isn't available on this server yet");
          } else if (e instanceof ApiError && e.status === 409) {
            // Server disagrees about the current state — adopt its view
            patch({ recOn: starting });
            publishJson('recording', { on: starting, ts: Date.now() });
          } else {
            toast(errMsg(e));
          }
        });
    };

    // ── breakout rooms (contract v4 §3) ───────────────────────────────────────

    const refreshBreakouts = async () => {
      const st = ref.current;
      if (!st.meeting || st.devMode) return;
      try {
        const { breakouts, open } = await api.listBreakouts(st.meeting.code);
        patch({ breakouts, breakoutsOpen: open });
      } catch { /* transient — the poll tries again */ }
    };

    /** Everyone the planner can put in a room: the live roster, minus me. */
    const assignable = (st: AppState) => rosterOf(st).filter(p => !p.isLocal);

    const blankDraft = (n: number, prev: BreakoutDraftRoom[]): BreakoutDraftRoom[] =>
      Array.from({ length: n }, (_, i) => prev[i] ?? { name: `Room ${i + 1}`, identities: [] });

    const setBreakoutRoomCount: Store['setBreakoutRoomCount'] = (n) => {
      // Shrinking drops the trailing rooms; anyone who was in one lands back in
      // "not assigned" rather than silently vanishing from the plan.
      const count = Math.max(1, Math.min(20, n));
      patch(st => ({ breakoutDraft: blankDraft(count, st.breakoutDraft) }));
    };

    const renameBreakoutRoom: Store['renameBreakoutRoom'] = (idx, name) => {
      patch(st => ({
        breakoutDraft: st.breakoutDraft.map((r, i) => (i === idx ? { ...r, name: name.slice(0, 60) } : r)),
      }));
    };

    const assignToBreakout: Store['assignToBreakout'] = (identity, idx) => {
      patch(st => ({
        breakoutDraft: st.breakoutDraft.map((r, i) => ({
          ...r,
          identities: i === idx
            ? (r.identities.includes(identity) ? r.identities : [...r.identities, identity])
            : r.identities.filter(id => id !== identity),
        })),
      }));
    };

    const autoAssignBreakouts = () => {
      const st = ref.current;
      const rooms = st.breakoutDraft.length ? st.breakoutDraft : blankDraft(2, []);
      const buckets = spreadEvenly(assignable(st).map(p => p.identity), rooms.length);
      patch({ breakoutDraft: rooms.map((r, i) => ({ ...r, identities: buckets[i] ?? [] })) });
    };

    const openBreakoutUi = () => {
      patch(st => ({
        breakoutUi: true, moreOpen: false,
        breakoutDraft: st.breakoutDraft.length ? st.breakoutDraft : blankDraft(2, []),
      }));
      refreshBreakouts();
    };

    const startBreakouts = async () => {
      const st = ref.current;
      if (!st.meeting || st.devMode || st.breakoutBusy) return;
      if (!(st.isHost || st.isCoHost)) return;
      const rooms = st.breakoutDraft
        .map((r, i) => ({ name: r.name.trim() || `Room ${i + 1}`, identities: r.identities }));
      if (!rooms.length) return;
      patch({ breakoutBusy: true });
      try {
        const { breakouts } = await api.createBreakouts(st.meeting.code, rooms);
        patch({ breakouts, breakoutsOpen: true, breakoutUi: false, breakoutBusy: false });
        // Everyone still in the MAIN room hears this and moves themselves
        // (contract v4 §3). Membership is server-authoritative either way.
        publishJson('breakout', { action: 'open', ts: Date.now() });
        toast(`Breakout rooms are open — ${breakouts.length} room${breakouts.length === 1 ? '' : 's'}`);
      } catch (e) {
        patch({ breakoutBusy: false });
        toast(e instanceof ApiError && e.status === 403 ? 'Only the host or a co-host can open breakout rooms' : errMsg(e));
      }
    };

    /**
     * Move into a breakout room. A full room switch that goes back through
     * `connectWithToken`, so nothing about the connection is special-cased.
     */
    const joinBreakout: Store['joinBreakout'] = async (idx) => {
      const st = ref.current;
      if (!st.meeting || st.devMode || st.breakoutBusy) return;
      if (!st.chatToken) { toast("Breakout rooms need a live meeting connection"); return; }
      patch({ breakoutBusy: true, breakoutUi: false, moreOpen: false });
      let grant;
      try {
        grant = await api.breakoutToken(st.meeting.code, st.chatToken, idx);
      } catch (e) {
        patch({ breakoutBusy: false });
        // 404 = not assigned / nothing open. That is a normal outcome, not a
        // failure: you simply stay in the main meeting.
        if (e instanceof ApiError && e.status === 404) {
          refreshBreakouts();
          toast(st.inBreakout || idx !== undefined
            ? 'That breakout room is no longer open'
            : "Breakout rooms are open, but you weren't assigned to one — you're staying in the main meeting");
        } else {
          toast(errMsg(e));
        }
        return;
      }
      const here: BreakoutHere = { idx: breakoutIdxOf(grant.room) ?? idx ?? 0, name: grant.breakoutName };
      try {
        disconnectRoom();
        await connectWithToken(
          { token: grant.token, url: grant.url, identity: st.identity, isHost: st.isHost, chatToken: st.chatToken },
          here,
        );
        patch({ breakoutBusy: false });
        toast(`You're in “${here.name}” — chat here isn't saved with the meeting`);
      } catch {
        // Never strand anyone: fall back to the room we know we can get into.
        patch({ breakoutBusy: false });
        toast("Couldn't join that breakout room — taking you back to the main meeting");
        await returnToMain();
      }
    };

    /** Leave whatever breakout I'm in and rejoin the main meeting room. */
    const returnToMain = async () => {
      const main = mainTokenRef.current;
      if (!ref.current.inBreakout && roomRef.current) return;
      if (!main) {
        // Nothing to go back to (shouldn't happen) — end cleanly rather than
        // sitting in a room that no longer exists.
        leaveMeeting('ended');
        return;
      }
      patch({ breakoutBusy: true, breakoutUi: false });
      try {
        disconnectRoom();
        await connectWithToken(main, null);
        patch({ breakoutBusy: false });
        toast('Back in the main meeting');
      } catch (e) {
        patch({ breakoutBusy: false });
        toast(errMsg(e));
        leaveMeeting('ended');
      }
    };

    const announceBreakout = () => {
      const st = ref.current;
      const text = st.breakoutAnnounce.trim().slice(0, 200);
      if (!text || !(st.isHost || st.isCoHost)) return;
      publishJson('breakout', { action: 'announce', text, name: st.lobbyName || st.user?.name || 'Host', ts: Date.now() });
      patch({ breakoutAnnounce: '' });
      // Data messages only reach the LiveKit room you are in — say where it went.
      toast(st.inBreakout ? `Announced in “${st.inBreakout.name}”` : 'Announced to the main room');
    };

    const closeBreakouts = async () => {
      const st = ref.current;
      if (!st.meeting || st.devMode || st.breakoutBusy) return;
      if (!(st.isHost || st.isCoHost)) return;
      patch({ breakoutBusy: true });
      try {
        // Server first: `open` flips to false there, which is what everyone in a
        // side room is polling for. The data message is only the fast path for
        // whoever is still in this room.
        await api.closeBreakouts(st.meeting.code);
        publishJson('breakout', { action: 'close', ts: Date.now() });
        patch({ breakouts: [], breakoutsOpen: false, breakoutBusy: false, breakoutUi: false, breakoutDraft: [] });
        toast('Breakout rooms closed — everyone comes back to the main meeting');
        if (ref.current.inBreakout) await returnToMain();
      } catch (e) {
        patch({ breakoutBusy: false });
        toast(e instanceof ApiError && e.status === 403 ? 'Only the host or a co-host can close breakout rooms' : errMsg(e));
      }
    };

    // ── local tile order ──────────────────────────────────────────────────────
    const setTileOrder: Store['setTileOrder'] = (order) => {
      const code = ref.current.devMode ? 'dev' : ref.current.meeting?.code;
      if (code) saveTileOrder(code, order);
      patch({ tileOrder: order, moreOpen: false });
    };

    // ── captions / blur / noise suppression / PiP ─────────────────────────────
    const toggleCaptions = () => {
      const on = !ref.current.captionsOn;
      patch({ captionsOn: on, moreOpen: false, captionLines: [] });
      if (on && !speechCtor() && !captionNotedRef.current) {
        captionNotedRef.current = true;
        toast("Captions are on — but your speech won't be transcribed in this browser");
      }
      window.setTimeout(syncCaptionEngine, 0);
    };

    /** "Mute my mic when I join" / "Turn my camera off when I join" (persisted). */
    const toggleJoinPref = (kind: 'muted' | 'camOff') => {
      if (kind === 'muted') {
        const on = !ref.current.joinMuted;
        setPref('diss_joinmuted', on);
        patch({ joinMuted: on });
      } else {
        const on = !ref.current.joinCamOff;
        setPref('diss_joincamoff', on);
        patch({ joinCamOff: on });
      }
    };

    const toggleBlur = () => {
      const on = !ref.current.blurOn;
      patch({ blurOn: on, moreOpen: false });
      setPref('diss_blur', on);
      applyBlur(on).catch(() => toast("Couldn't switch background blur — your camera may not support it"));
    };

    const toggleNs = () => {
      const on = !ref.current.nsOn;
      patch({ nsOn: on, moreOpen: false });
      setPref('diss_ns', on);
      const room = roomRef.current;
      const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      if (track instanceof LocalAudioTrack) {
        track.restartTrack({ noiseSuppression: on, echoCancellation: on })
          .then(() => toast(on ? 'Noise suppression is on' : 'Noise suppression is off'))
          .catch(() => toast("Couldn't restart your mic with the new setting"));
      } else {
        toast(on ? 'Noise suppression on — applies when your mic starts' : 'Noise suppression off — applies when your mic starts');
      }
    };

    const togglePip = () => {
      patch({ moreOpen: false });
      if (!document.pictureInPictureEnabled) return;
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
        return;
      }
      const el = (document.querySelector('video[data-main-stage="1"]') ?? document.querySelector('video')) as HTMLVideoElement | null;
      if (!el) { toast('No video on stage to pop out yet'); return; }
      el.requestPictureInPicture().catch(() => toast("Couldn't open picture-in-picture"));
    };

    return {
      get s() { return ref.current; },
      patch, go, toast, streamRef,
      submitAuth, signOut,
      loadMeetings, createInstantMeeting, scheduleMeeting, deleteMeeting, openCode, openMeeting,
      joinMeeting, leaveMeeting, endForAll,
      toggleMic, toggleCam, toggleShare, toggleHand, sendReaction, sendChat, setChatRecipient,
      moderatePeer, muteAll,
      cancelWaiting, actOnWaiting, setMeetingFlag,
      toggleCaptions, toggleJoinPref, toggleBlur, toggleNs, togglePip,
      getRoom: () => roomRef.current,
      togglePanel: (tab) => patch(st => ({
        panel: st.panel && st.tab === tab ? false : true,
        tab,
        unread: tab === 'chat' ? 0 : st.unread,
        unreadMention: tab === 'chat' ? false : st.unreadMention,
      })),
      toggleRec,
      openBreakoutUi, refreshBreakouts, setBreakoutRoomCount, renameBreakoutRoom,
      assignToBreakout, autoAssignBreakouts, startBreakouts, joinBreakout,
      returnToMain, announceBreakout, closeBreakouts,
      setTileOrder,
      refreshDevices, selectDevice, setVideoQuality,
      testSpeaker: async () => {
        if (ref.current.speakerTesting) return;
        patch({ speakerTesting: true });
        try {
          await playTestTone(ref.current.speakerId ?? undefined);
        } catch {
          toast("Couldn't play a test sound on that speaker");
        } finally {
          patch({ speakerTesting: false });
        }
      },
      allowAccess: startPreview,
      copyLink: () => {
        const code = ref.current.meeting?.code;
        if (!code) { toast('No meeting link yet'); return; }
        navigator.clipboard?.writeText(meetingLink(code));
        patch({ copied: true });
        window.setTimeout(() => patch({ copied: false }), 2000);
        if (ref.current.screen === 'meeting') toast('Invite link copied');
      },
      wake: () => {
        if (!ref.current.bars) patch({ bars: true });
        window.clearTimeout(timers.current.hide);
        timers.current.hide = window.setTimeout(() => {
          const c = ref.current;
          if (!c.panel && !c.moreOpen && !c.leaveOpen && !c.reactionsOpen && !c.connPop && !c.shortcutsOpen) patch({ bars: false });
        }, 4000);
      },
      enterDevMeeting: () => {
        if (roomRef.current) { go('meeting'); return; }
        patch({
          screen: 'meeting', devMode: true, protoOpen: false, isHost: ref.current.devRole === 'host',
          youreIn: true, elapsedS: 0, panel: false, view: 'grid', pinned: null,
          messages: [], unread: 0, bursts: [], hand: false, sharing: false, reconnecting: false,
          chatTo: null, unreadMention: false, hostPanelOpen: false,
          canShare: true, canChat: true, canUnmute: true,
          breakouts: [], breakoutsOpen: false, inBreakout: null, breakoutUi: false,
          breakoutBusy: false, breakoutDraft: [], breakoutAnnounce: '',
          tileOrder: loadTileOrder('dev'),
        });
        window.setTimeout(() => patch({ youreIn: false }), 1400);
      },
    };
  }, []);

  // Session restore + ?join=<code> deep link
  useEffect(() => {
    (async () => {
      try {
        const { user } = await api.me();
        patch({ user, bootChecked: true, lobbyName: ref.current.lobbyName || user.name });
        if (ref.current.screen === 'landing') store.go('dash');
        store.loadMeetings();
      } catch {
        patch({ bootChecked: true });
      }
      const joinCode = new URLSearchParams(window.location.search).get('join');
      if (joinCode) store.openCode(joinCode);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real devices: enumerate once, then follow plug/unplug events. Labels stay
  // blank until permission is granted, so allowAccess() re-runs this itself.
  useEffect(() => {
    store.refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => { store.refreshDevices(); };
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [store]);

  // Viewport width (contract: narrow < 760px)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 759px)');
    const onChange = () => patch({ isNarrow: mq.matches });
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // clock + elapsed
  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      patch({
        clock: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        dateStr: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
      });
      if (ref.current.screen === 'meeting') patch(st => ({ elapsedS: st.elapsedS + 1 }));
      // fade finished caption lines after ~5s (interims linger a little longer in case speech stalls)
      const lines = ref.current.captionLines;
      if (lines.length) {
        const now = Date.now();
        const keep = lines.filter(l => (l.interim ? now - l.ts < 8000 : now - l.ts < 5000));
        if (keep.length !== lines.length) patch({ captionLines: keep });
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // Host/co-host: poll the waiting room while in a meeting that has it enabled
  useEffect(() => {
    const t = window.setInterval(async () => {
      const st = ref.current;
      const canReview = st.screen === 'meeting' && !st.devMode && !!st.meeting?.waitingRoom && (st.isHost || st.isCoHost);
      if (!canReview) {
        if (ref.current.waitingGuests.length) patch({ waitingGuests: [] });
        return;
      }
      try {
        const { guests } = await api.waitingList(st.meeting!.code);
        const fresh = guests.filter(g => !seenWaitingRef.current.has(g.waitingId));
        fresh.forEach(g => {
          seenWaitingRef.current.add(g.waitingId);
          store.toast(`${g.displayName} is waiting to join`, { sticky: true });
        });
        patch({ waitingGuests: guests });
      } catch { /* transient — next tick retries */ }
    }, 3000);
    return () => window.clearInterval(t);
  }, [store]);

  // Breakout rooms: the server's `open` flag is the authority.
  //
  // A data message only reaches the LiveKit room it was published in, so
  // someone sitting in "Design team" never hears the host close the rooms from
  // the main room. Polling `GET /breakouts` is what actually guarantees nobody
  // is left in a dead room — the `close` broadcast is only the fast path.
  useEffect(() => {
    const t = window.setInterval(() => {
      const st = ref.current;
      if (st.screen !== 'meeting' || st.devMode || !st.meeting) return;
      const involved = !!st.inBreakout || st.breakoutsOpen || st.breakoutUi || st.isHost || st.isCoHost;
      breakoutTickRef.current += 1;
      // Everyone polls, but people with nothing to do with breakouts do it at
      // a third of the rate (well inside the 60/min limit either way).
      if (!involved && breakoutTickRef.current % 3 !== 0) return;
      api.listBreakouts(st.meeting.code)
        .then(({ breakouts, open }) => {
          const now = ref.current;
          if (now.screen !== 'meeting') return;
          if (now.breakoutsOpen !== open || now.breakouts.length !== breakouts.length
            || JSON.stringify(now.breakouts) !== JSON.stringify(breakouts)) {
            patch({ breakouts, breakoutsOpen: open });
          }
          if (!open && now.inBreakout && !now.breakoutBusy) {
            store.toast('Breakout rooms are closed');
            store.returnToMain().catch(() => {});
          }
        })
        .catch(() => { /* transient — next tick retries */ });
    }, 5000);
    return () => window.clearInterval(t);
  }, [store]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ref.current.screen !== 'meeting') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const k = e.key.toLowerCase();
      if (k === 'm') store.toggleMic();
      else if (k === 'v') store.toggleCam();
      else if (k === 'c') store.togglePanel('chat');
      else if (k === 'p') store.togglePanel('people');
      else if (k === 'escape') patch({ panel: false, reactionsOpen: false, moreOpen: false, leaveOpen: false, shortcutsOpen: false, connPop: false, breakoutUi: false });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      streamRef.current?.getTracks().forEach(t => t.stop());
      roomRef.current?.disconnect();
    };
  }, [store]);

  // New object identity each render so consumers re-render with fresh state
  const value = useMemo(() => ({ ...store, s }), [store, s]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
