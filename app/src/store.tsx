import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import type { RemoteParticipant } from 'livekit-client';
import { api, ApiError, extractCode, meetingLink } from './api';
import type { Meeting, User } from './api';

export type Screen =
  | 'landing' | 'auth' | 'dash' | 'schedule' | 'schedDone' | 'detail'
  | 'recordings' | 'settings' | 'lobby' | 'waiting' | 'meeting' | 'post';

export type PermState = 'prompt' | 'granted' | 'denied' | 'nodevice' | 'busy';

export interface ChatMessage { who: string; text: string; mine: boolean; }
export interface Burst { id: number; name: string; x: string; }
export interface Toast { id: number; text: string; sticky?: boolean; }

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
  videoTrack: Track | null;
  audioTrack: Track | null;
  screenTrack: Track | null;
}

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
  // meeting room
  peers: Peer[]; identity: string; isHost: boolean;
  devMode: boolean; // ProtoNav preview of the meeting screen without a real connection
  view: 'grid' | 'speaker'; micMuted: boolean; camOff: boolean; sharing: boolean; hand: boolean;
  panel: boolean; tab: 'chat' | 'people';
  reactionsOpen: boolean; moreOpen: boolean; leaveOpen: boolean; connPop: boolean;
  reconnecting: boolean; connQuality: ConnectionQuality;
  shortcutsOpen: boolean;
  pinned: string | null; selfCollapsed: boolean; bars: boolean; youreIn: boolean;
  elapsedS: number; unread: number; chatInput: string;
  messages: ChatMessage[]; bursts: Burst[]; toasts: Toast[];
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
  peers: [], identity: '', isHost: false, devMode: false,
  view: 'grid', micMuted: false, camOff: false, sharing: false, hand: false,
  panel: false, tab: 'chat', reactionsOpen: false, moreOpen: false, leaveOpen: false, connPop: false,
  reconnecting: false, connQuality: ConnectionQuality.Unknown,
  shortcutsOpen: false,
  pinned: null, selfCollapsed: false, bars: true, youreIn: false,
  elapsedS: 0, unread: 0, chatInput: '',
  messages: [], bursts: [], toasts: [],
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
    hand: s.hand, isHost: s.devRole === 'host', videoTrack: null, audioTrack: null, screenTrack: null,
  };
  const others: Peer[] = DEV_NAMES.slice(0, Math.max(1, Math.min(9, s.devParticipantCount - 1))).map((name, i) => ({
    identity: `dev-${i}`, name, isLocal: false,
    micOn: i % 3 !== 2, camOn: false, sharing: false, speaking: false,
    hand: i === 4, isHost: s.devRole !== 'host' && i === 0,
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
  toggleShare: () => void;
  toggleHand: () => void;
  sendReaction: (emoji: string) => void;
  togglePanel: (tab: 'chat' | 'people') => void;
  sendChat: () => void;
  moderatePeer: (identity: string, action: 'mute' | 'remove') => Promise<void>;
  muteAll: () => Promise<void>;
  toggleRec: () => void;
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
          sharing: !!scrPub && !scrPub.isMuted,
          speaking: speakers.has(p.identity),
          hand: handRef.current.get(p.identity) ?? false,
          isHost: isLocal ? ref.current.isHost : p.identity === hostIdentity,
          videoTrack: camPub?.track ?? null,
          audioTrack: !isLocal ? micPub?.track ?? null : null,
          screenTrack: scrPub?.track ?? null,
        };
      });
    };

    const sync = () => {
      if (!roomRef.current) return;
      const peers = buildPeers();
      const you = peers.find(p => p.isLocal);
      patch({
        peers,
        micMuted: you ? !you.micOn : true,
        camOff: you ? !you.camOn : true,
        sharing: you ? you.sharing : false,
        hand: you ? you.hand : false,
      });
    };

    const publishJson = (topic: string, payload: Record<string, unknown>) => {
      const room = roomRef.current;
      if (!room) return;
      room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(payload)), { topic, reliable: true })
        .catch(() => {});
    };

    const spawnBurst = (name: string) => {
      const id = Math.random();
      patch(st => ({ bursts: [...st.bursts, { id, name, x: `${35 + Math.random() * 30}%` }] }));
      window.setTimeout(() => patch(st => ({ bursts: st.bursts.filter(b => b.id !== id) })), 3600);
    };

    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      let msg: { name?: string; text?: string; emoji?: string; up?: boolean };
      try {
        msg = JSON.parse(new TextDecoder().decode(payload));
      } catch { return; }
      const who = msg.name || participant?.name || participant?.identity || 'Someone';
      if (topic === 'chat' && typeof msg.text === 'string') {
        const chatOpen = ref.current.panel && ref.current.tab === 'chat';
        patch(st => ({
          messages: [...st.messages, { who, text: msg.text!, mine: false }],
          unread: chatOpen ? 0 : st.unread + 1,
        }));
        if (!chatOpen) toast(`${who}: ${msg.text.slice(0, 60)}`);
      } else if (topic === 'reaction' && typeof msg.emoji === 'string') {
        spawnBurst(msg.emoji);
      } else if (topic === 'hand' && participant) {
        const up = !!msg.up;
        handRef.current.set(participant.identity, up);
        if (up) toast(`${who} raised their hand`);
        sync();
      }
    };

    const wireRoom = (room: Room) => {
      room
        .on(RoomEvent.ParticipantConnected, p => { toast(`${p.name || p.identity} joined`); sync(); })
        .on(RoomEvent.ParticipantDisconnected, p => { handRef.current.delete(p.identity); sync(); })
        .on(RoomEvent.TrackPublished, sync)
        .on(RoomEvent.TrackUnpublished, sync)
        .on(RoomEvent.TrackSubscribed, sync)
        .on(RoomEvent.TrackUnsubscribed, sync)
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
          if (!leavingRef.current && ref.current.screen === 'meeting') {
            patch({
              screen: 'post', postKind: 'ended', peers: [], panel: false, leaveOpen: false,
              reconnecting: false, sharing: false, hand: false, reactionsOpen: false, moreOpen: false,
              rating: 0, issues: [], ratedDone: false,
            });
          }
        });
    };

    const disconnectRoom = () => {
      leavingRef.current = true;
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
        const { meeting } = await api.createMeeting({ title: st.schedTitle.trim() || 'Untitled meeting', startsAt: d.toISOString() });
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
    const joinMeeting = async () => {
      const st = ref.current;
      const meeting = st.meeting;
      if (!meeting) { toast('Pick a meeting to join first'); return; }
      const displayName = st.lobbyName.trim() || st.user?.name || '';
      if (!displayName) { patch({ joinError: 'Enter your name so people know who joined.' }); return; }
      if (st.joining) return;
      patch({ joining: true, joinError: null });
      try {
        const { token, url, identity, isHost } = await api.meetingToken(meeting.code, displayName);
        stopPreview();
        const room = new Room();
        wireRoom(room);
        roomRef.current = room;
        handRef.current = new Map();
        leavingRef.current = false;
        await room.connect(url, token);
        patch({
          screen: 'meeting', devMode: false, identity, isHost, joining: false,
          youreIn: true, elapsedS: 0, panel: false, view: 'grid', pinned: null,
          messages: [], unread: 0, bursts: [], hand: false, sharing: false,
          micMuted: !st.lobbyMic, camOff: !st.lobbyCam, reconnecting: false,
          connQuality: ConnectionQuality.Unknown, protoOpen: false,
        });
        window.setTimeout(() => patch({ youreIn: false }), 1400);
        try {
          if (st.lobbyMic) await room.localParticipant.setMicrophoneEnabled(true);
          if (st.lobbyCam) await room.localParticipant.setCameraEnabled(true);
        } catch {
          toast("Couldn't start your mic or camera — you can still watch and listen");
        }
        sync();
      } catch (e) {
        disconnectRoom();
        patch({ joining: false, joinError: errMsg(e) });
      }
    };

    const leaveMeeting: Store['leaveMeeting'] = (kind) => {
      disconnectRoom();
      patch({
        screen: 'post', postKind: kind, leaveOpen: false, panel: false,
        rating: 0, issues: [], ratedDone: false, peers: [], devMode: false,
        sharing: false, hand: false, reactionsOpen: false, moreOpen: false, reconnecting: false,
      });
    };

    const endForAll = async () => {
      const st = ref.current;
      const code = st.meeting?.code;
      if (code && st.isHost) {
        const remotes = st.peers.filter(p => !p.isLocal);
        await Promise.allSettled(remotes.map(p => api.moderate(code, 'remove', p.identity)));
      }
      leaveMeeting('ended');
    };

    const toggleMic = () => {
      const room = roomRef.current;
      if (!room) { patch(st => ({ micMuted: !st.micMuted })); return; }
      const enable = ref.current.micMuted;
      room.localParticipant.setMicrophoneEnabled(enable)
        .then(sync)
        .catch(() => toast("Couldn't switch your mic — check browser permissions"));
    };

    const toggleCam = () => {
      const room = roomRef.current;
      if (!room) { patch(st => ({ camOff: !st.camOff })); return; }
      const enable = ref.current.camOff;
      room.localParticipant.setCameraEnabled(enable)
        .then(sync)
        .catch(() => toast("Couldn't switch your camera — check browser permissions"));
    };

    const toggleShare = () => {
      const room = roomRef.current;
      if (!room) { patch(st => ({ sharing: !st.sharing })); return; }
      const enable = !ref.current.sharing;
      room.localParticipant.setScreenShareEnabled(enable)
        .then(() => { sync(); if (enable && ref.current.sharing) toast('You started sharing — everyone sees your screen'); })
        .catch(() => { /* user cancelled the picker */ });
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

    const sendChat = () => {
      const st = ref.current;
      const text = st.chatInput.trim();
      if (!text) return;
      patch(c => ({ messages: [...c.messages, { who: 'You', text, mine: true }], chatInput: '' }));
      publishJson('chat', { name: st.lobbyName || st.user?.name || 'You', text, ts: Date.now() });
    };

    const moderatePeer = async (identity: string, action: 'mute' | 'remove') => {
      const st = ref.current;
      if (!st.meeting || !st.isHost) return;
      const peer = st.peers.find(p => p.identity === identity);
      const first = (peer?.name || identity).split(' ')[0];
      try {
        await api.moderate(st.meeting.code, action, identity);
        toast(action === 'mute' ? `Muted ${first}` : `Removed ${first} from the meeting`);
      } catch (e) { toast(errMsg(e)); }
    };

    const muteAll = async () => {
      const st = ref.current;
      if (!st.meeting || !st.isHost) return;
      const remotes = st.peers.filter(p => !p.isLocal && p.micOn);
      await Promise.allSettled(remotes.map(p => api.moderate(st.meeting!.code, 'mute', p.identity)));
      toast('Everyone is muted — they can unmute themselves');
    };

    return {
      get s() { return ref.current; },
      patch, go, toast, streamRef,
      submitAuth, signOut,
      loadMeetings, createInstantMeeting, scheduleMeeting, deleteMeeting, openCode, openMeeting,
      joinMeeting, leaveMeeting, endForAll,
      toggleMic, toggleCam, toggleShare, toggleHand, sendReaction, sendChat,
      moderatePeer, muteAll,
      togglePanel: (tab) => patch(st => ({
        panel: st.panel && st.tab === tab ? false : true,
        tab,
        unread: tab === 'chat' ? 0 : st.unread,
      })),
      toggleRec: () => {
        patch({ moreOpen: false });
        toast('Recording is coming soon — not in this version yet');
      },
      allowAccess: async () => {
        try {
          const st = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          streamRef.current = st;
          patch({ permState: 'granted', realCam: true });
        } catch (e) {
          const name = (e as DOMException | undefined)?.name;
          if (name === 'NotAllowedError' || name === 'SecurityError') patch({ permState: 'denied' });
          else if (name === 'NotFoundError') patch({ permState: 'nodevice' });
          else if (name === 'NotReadableError' || name === 'AbortError') patch({ permState: 'busy' });
          else patch({ permState: 'granted', realCam: false });
        }
      },
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

  // clock + elapsed
  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      patch({
        clock: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        dateStr: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
      });
      if (ref.current.screen === 'meeting') patch(st => ({ elapsedS: st.elapsedS + 1 }));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

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
      else if (k === 'escape') patch({ panel: false, reactionsOpen: false, moreOpen: false, leaveOpen: false, shortcutsOpen: false, connPop: false });
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
