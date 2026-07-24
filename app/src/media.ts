// Real media helpers: device enumeration, live input level, and an audible test
// tone. Everything here talks to the browser directly — no LiveKit, no React —
// so it can be used from the lobby preview and from inside a call.

export type DeviceLists = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };

const EMPTY: DeviceLists = { mics: [], cams: [], speakers: [] };

/**
 * enumerateDevices, split by kind. Labels are only populated after permission
 * is granted — callers should re-run this after getUserMedia resolves.
 */
export async function listDevices(): Promise<DeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) return EMPTY;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: all.filter(d => d.kind === 'audioinput'),
      cams: all.filter(d => d.kind === 'videoinput'),
      speakers: all.filter(d => d.kind === 'audiooutput'),
    };
  } catch {
    return EMPTY;
  }
}

type AudioCtxCtor = typeof AudioContext;

const audioCtxCtor = (): AudioCtxCtor | null => {
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
};

/**
 * Live input level from a MediaStream, 0..1, via WebAudio AnalyserNode.
 * `stop()` must close the AudioContext.
 */
export function createLevelMeter(stream: MediaStream): { level(): number; stop(): void } {
  const Ctor = audioCtxCtor();
  const noop = { level: () => 0, stop: () => {} };
  if (!Ctor || stream.getAudioTracks().length === 0) return noop;

  let ctx: AudioContext;
  try { ctx = new Ctor(); } catch { return noop; }

  let closed = false;
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
  } catch {
    ctx.close().catch(() => {});
    return noop;
  }
  // Autoplay policies can leave the context suspended until a gesture.
  ctx.resume().catch(() => {});

  const buf = new Float32Array(analyser.fftSize);

  return {
    level() {
      if (closed) return 0;
      const track = stream.getAudioTracks()[0];
      if (!track || track.muted || !track.enabled || track.readyState !== 'live') return 0;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // Speech RMS sits around 0.02–0.2; map that onto a usable 0..1 range.
      return Math.max(0, Math.min(1, rms * 6));
    },
    stop() {
      if (closed) return;
      closed = true;
      try { source.disconnect(); } catch { /* already torn down */ }
      try { analyser.disconnect(); } catch { /* already torn down */ }
      ctx.close().catch(() => {});
    },
  };
}

/** True when this browser can route audio to a chosen output device. */
export function canSelectSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/**
 * True when this browser can capture audio alongside a display surface.
 * Safari and Firefox expose getDisplayMedia but silently drop the audio track,
 * which would leave the user thinking they shared their computer sound.
 */
export function canCaptureDisplayAudio(): boolean {
  if (!navigator.mediaDevices?.getDisplayMedia) return false;
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return false;
  if (/Safari\//.test(ua) && !/Chrom(e|ium)|Edg\/|OPR\//.test(ua)) return false;
  return true;
}

type SinkElement = HTMLMediaElement & { setSinkId(id: string): Promise<void> };

/** Point a media element at a specific output device, where supported. */
export async function applySinkId(el: HTMLMediaElement, sinkId: string | null): Promise<void> {
  if (!sinkId || !canSelectSpeaker()) return;
  try { await (el as SinkElement).setSinkId(sinkId); } catch { /* device gone, or not permitted */ }
}

/** One softly-enveloped sine voice — no clicks at either end. */
function chimeVoice(ctx: AudioContext, out: AudioNode, freq: number, at: number, length: number, gain: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, at);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env);
  env.connect(out);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/**
 * Audible test tone (a short pleasant chime, NOT a raw square wave) routed to
 * `sinkId` when the browser supports setSinkId. Resolves when playback ends.
 */
export async function playTestTone(sinkId?: string): Promise<void> {
  const Ctor = audioCtxCtor();
  if (!Ctor) return;
  let ctx: AudioContext;
  try { ctx = new Ctor(); } catch { return; }

  let el: HTMLAudioElement | null = null;
  try {
    await ctx.resume().catch(() => {});

    const master = ctx.createGain();
    master.gain.value = 0.55;

    if (sinkId && canSelectSpeaker()) {
      // Web Audio has no output-device selector, so bounce through an <audio>
      // element, which does.
      const dest = ctx.createMediaStreamDestination();
      master.connect(dest);
      el = new Audio();
      el.srcObject = dest.stream;
      el.autoplay = true;
      await applySinkId(el, sinkId);
      await el.play().catch(() => {});
    } else {
      master.connect(ctx.destination);
    }

    const t0 = ctx.currentTime + 0.06;
    // A gentle rising two-tone (E5 → B5) with a light octave shimmer.
    chimeVoice(ctx, master, 659.25, t0, 0.42, 0.5);
    chimeVoice(ctx, master, 1318.5, t0, 0.30, 0.12);
    chimeVoice(ctx, master, 987.77, t0 + 0.26, 0.62, 0.5);
    chimeVoice(ctx, master, 1975.5, t0 + 0.26, 0.34, 0.1);

    const totalMs = (0.06 + 0.26 + 0.62 + 0.12) * 1000;
    await new Promise<void>(r => window.setTimeout(r, totalMs));
  } finally {
    if (el) {
      el.pause();
      el.srcObject = null;
    }
    ctx.close().catch(() => {});
  }
}
