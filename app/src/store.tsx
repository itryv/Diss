import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';

export type Screen =
  | 'landing' | 'auth' | 'dash' | 'schedule' | 'schedDone' | 'detail'
  | 'recordings' | 'settings' | 'lobby' | 'waiting' | 'meeting' | 'post';

export type PermState = 'prompt' | 'granted' | 'denied' | 'nodevice' | 'busy';

export interface ChatMessage { who: string; text: string; mine: boolean; }
export interface Burst { id: number; name: string; x: string; }
export interface Toast { id: number; text: string; admit?: boolean; sticky?: boolean; }

export interface AppState {
  screen: Screen;
  // prototype knobs (design's data-props)
  role: 'host' | 'guest';
  participantCount: number;
  waitingRoom: boolean;
  // auth
  authMode: 'signup' | 'signin'; authStep: 'form' | 'sent';
  email: string; emailInvalid: boolean;
  // join code
  code: string; codeInvalid: boolean;
  // app shell
  newMenuOpen: boolean; joinModal: boolean; settingsTab: 'profile' | 'av' | 'notif' | 'account';
  optionsOpen: boolean; schedTitle: string; copied: boolean;
  clock: string; dateStr: string;
  schedOpts: boolean[]; avOpts: boolean[]; notifOpts: boolean[];
  // lobby
  permState: PermState; realCam: boolean; lobbyName: string;
  lobbyMic: boolean; lobbyCam: boolean; speakerTesting: boolean;
  // meeting
  view: 'grid' | 'speaker'; micMuted: boolean; camOff: boolean; sharing: boolean; hand: boolean;
  panel: boolean; tab: 'chat' | 'people';
  reactionsOpen: boolean; moreOpen: boolean; leaveOpen: boolean; connPop: boolean;
  recording: boolean; recBanner: string | null; reconnecting: boolean; locked: boolean; shortcutsOpen: boolean;
  pinned: number | null; selfCollapsed: boolean; activeIdx: number; bars: boolean; youreIn: boolean;
  elapsedS: number; unread: number; chatInput: string; mutedNudge: boolean; nudgeShown: boolean;
  waitingGuest: boolean; admitted: boolean; mutedAll: boolean;
  messages: ChatMessage[]; bursts: Burst[]; toasts: Toast[];
  // post
  rating: number; issues: string[]; ratedDone: boolean; postKind: 'left' | 'ended';
  // proto switcher
  protoOpen: boolean;
}

const initial: AppState = {
  screen: 'landing',
  role: 'host', participantCount: 10, waitingRoom: true,
  authMode: 'signup', authStep: 'form', email: '', emailInvalid: false,
  code: '', codeInvalid: false,
  newMenuOpen: false, joinModal: false, settingsTab: 'profile', optionsOpen: false,
  schedTitle: '', copied: false, clock: '', dateStr: '',
  schedOpts: [true, false, false, true], avOpts: [true, false, true], notifOpts: [true, true],
  permState: 'prompt', realCam: false, lobbyName: 'Maya Chen', lobbyMic: true, lobbyCam: true, speakerTesting: false,
  view: 'grid', micMuted: false, camOff: false, sharing: false, hand: false,
  panel: false, tab: 'chat', reactionsOpen: false, moreOpen: false, leaveOpen: false, connPop: false,
  recording: false, recBanner: null, reconnecting: false, locked: false, shortcutsOpen: false,
  pinned: null, selfCollapsed: false, activeIdx: 1, bars: true, youreIn: false,
  elapsedS: 0, unread: 0, chatInput: '', mutedNudge: false, nudgeShown: false,
  waitingGuest: false, admitted: false, mutedAll: false,
  messages: [
    { who: 'Amara Okafor', text: 'agenda is in the doc from last week', mine: false },
    { who: 'Priya Nair', text: 'can everyone see my notes on the side?', mine: false },
    { who: 'You', text: 'yep, looks good!', mine: true },
  ],
  bursts: [], toasts: [],
  rating: 0, issues: [], ratedDone: false, postKind: 'left',
  protoOpen: false,
};

export interface RosterEntry { n: string; img: number; cam: boolean; mute: boolean; you?: boolean; alt?: boolean; hand?: boolean; }

const BASE_ROSTER: RosterEntry[] = [
  { n: 'Maya Chen', img: 47, cam: true, mute: false, you: true },
  { n: 'Amara Okafor', img: 49, cam: true, mute: false, alt: true },
  { n: 'Jonas Berg', img: 12, cam: true, mute: true },
  { n: 'Priya Nair', img: 26, cam: true, mute: false },
  { n: 'Diego Ramos', img: 60, cam: false, mute: false },
  { n: 'Nkechi Eze', img: 24, cam: true, mute: false, hand: true },
  { n: 'Tom Alvarez', img: 59, cam: true, mute: true },
  { n: 'Sofia Lindqvist', img: 45, cam: true, mute: false },
  { n: 'Ravi Patel', img: 68, cam: false, mute: true },
  { n: 'Hana Kim', img: 44, cam: true, mute: false },
];

export const PALETTE = ['#8a5a44', '#5a7a6a', '#7a5a7a', '#5a6a8a', '#8a7a4a', '#6a5a8a', '#4a7a7a', '#8a5a5a', '#5a8a5a', '#7a6a5a', '#5a8a7a'];

export function roster(s: AppState): RosterEntry[] {
  const r = BASE_ROSTER.slice(0, Math.max(2, Math.min(10, s.participantCount)));
  if (s.admitted) r.push({ n: 'Leila Boum', img: 32, cam: true, mute: false });
  return r;
}

type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

export interface Store {
  s: AppState;
  patch: (p: Patch) => void;
  go: (screen: Screen, extra?: Partial<AppState>) => void;
  toast: (text: string, opts?: { admit?: boolean; sticky?: boolean }) => void;
  toggleMic: () => void;
  toggleCam: () => void;
  togglePanel: (tab: 'chat' | 'people') => void;
  enterMeeting: () => void;
  proceedJoin: () => void;
  leaveMeeting: (kind: 'left' | 'ended') => void;
  sendChat: () => void;
  toggleRec: () => void;
  demoReconnect: () => void;
  allowAccess: () => Promise<void>;
  copyLink: () => void;
  wake: () => void;
  streamRef: React.MutableRefObject<MediaStream | null>;
}

const Ctx = createContext<Store>(null!);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [s, patch] = useReducer(
    (st: AppState, p: Patch) => ({ ...st, ...(typeof p === 'function' ? p(st) : p) }),
    initial,
  );
  const ref = useRef(s);
  ref.current = s;
  const streamRef = useRef<MediaStream | null>(null);
  const timers = useRef<{ hide?: number }>({});

  const store = useMemo<Store>(() => {
    const go: Store['go'] = (screen, extra) => patch({ screen, protoOpen: false, newMenuOpen: false, ...extra });

    const toast: Store['toast'] = (text, opts) => {
      const id = Math.random();
      patch(st => ({ toasts: [...st.toasts, { id, text, ...opts }] }));
      window.setTimeout(() => patch(st => ({ toasts: st.toasts.filter(t => t.id !== id) })), opts?.sticky ? 12000 : 4000);
    };

    const enterMeeting = () => {
      const st = ref.current;
      patch({ screen: 'meeting', youreIn: true, elapsedS: 0, panel: false, micMuted: !st.lobbyMic, camOff: !st.lobbyCam });
      window.setTimeout(() => patch({ youreIn: false }), 1400);
      window.setTimeout(() => {
        if (ref.current.screen !== 'meeting') return;
        const chatOpen = ref.current.panel && ref.current.tab === 'chat';
        patch(c => ({
          messages: [...c.messages, { who: 'Hana Kim', text: 'running 2 min late, start without me!', mine: false }],
          unread: chatOpen ? 0 : c.unread + 1,
        }));
        if (!chatOpen) toast('Hana Kim: running 2 min late…');
      }, 9000);
      if (st.role === 'host' && st.waitingRoom) {
        window.setTimeout(() => {
          const c = ref.current;
          if (c.screen !== 'meeting' || c.admitted || c.waitingGuest) return;
          patch({ waitingGuest: true });
          toast('Leila Boum is in the waiting room', { admit: true, sticky: true });
        }, 14000);
      }
    };

    const proceedJoin = () => {
      const st = ref.current;
      if (st.role !== 'host' && st.waitingRoom) {
        go('waiting');
        window.setTimeout(() => { if (ref.current.screen === 'waiting') enterMeeting(); }, 6000);
      } else enterMeeting();
    };

    return {
      get s() { return ref.current; },
      patch, go, toast, enterMeeting, proceedJoin,
      streamRef,
      toggleMic: () => patch(st => ({ micMuted: !st.micMuted, mutedNudge: false })),
      toggleCam: () => patch(st => ({ camOff: !st.camOff })),
      togglePanel: (tab) => patch(st => ({
        panel: st.panel && st.tab === tab ? false : true,
        tab,
        unread: tab === 'chat' ? 0 : st.unread,
      })),
      leaveMeeting: (kind) => patch({
        screen: 'post', postKind: kind, leaveOpen: false, panel: false,
        rating: 0, issues: [], ratedDone: false,
        sharing: false, recording: false, hand: false, reactionsOpen: false, moreOpen: false,
      }),
      sendChat: () => {
        const t = ref.current.chatInput.trim();
        if (!t) return;
        patch(st => ({ messages: [...st.messages, { who: 'You', text: t, mine: true }], chatInput: '' }));
      },
      toggleRec: () => {
        const r = !ref.current.recording;
        patch({
          recording: r, moreOpen: false,
          recBanner: r ? 'Recording started — everyone can see the REC badge' : "Recording stopped. It'll show up in your library shortly.",
        });
        window.setTimeout(() => patch({ recBanner: null }), 4500);
      },
      demoReconnect: () => {
        patch({ moreOpen: false, reconnecting: true });
        window.setTimeout(() => { patch({ reconnecting: false }); toast("You're back — connection restored"); }, 6000);
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
          else patch({ permState: 'granted', realCam: false });
        }
      },
      copyLink: () => {
        navigator.clipboard?.writeText('https://diss.app/wkt-eamq-fjz');
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
    };
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

  // simulated active-speaker rotation
  useEffect(() => {
    const t = window.setInterval(() => {
      const st = ref.current;
      if (st.screen !== 'meeting' || st.reconnecting) return;
      const talkers = roster(st).map((p, i) => ({ p, i })).filter(x => !x.p.mute || x.p.you).map(x => x.i);
      const next = talkers[Math.floor(Math.random() * talkers.length)];
      patch({ activeIdx: next });
      if (next === 0 && st.micMuted && !st.nudgeShown) patch({ mutedNudge: true, nudgeShown: true });
    }, 3200);
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
    };
  }, [store]);

  // New object identity each render so consumers re-render with fresh state
  const value = useMemo(() => ({ ...store, s }), [store, s]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
