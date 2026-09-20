/**
 * Virtual background presets.
 *
 * The images are drawn at runtime on a canvas rather than shipped as files:
 * a handful of gradients cost a few hundred bytes of code instead of a few
 * hundred kilobytes of JPEG, they stay crisp at any resolution, and there is
 * nothing extra for the service worker or the Electron bundle to carry.
 *
 * `BackgroundProcessor` loads `imagePath` through `new Image()` +
 * `createImageBitmap`, so a blob: URL is accepted exactly like a real path.
 */

export type BackgroundId = 'none' | 'blur' | 'aurora' | 'dusk' | 'slate' | 'custom';

export interface BackgroundPreset {
  id: Exclude<BackgroundId, 'none' | 'blur' | 'custom'>;
  label: string;
  /** Gradient stops, top-left to bottom-right. */
  stops: [string, string, string];
}

/** Deliberately abstract: a recognisable "room" reads as fake on a bad matte. */
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'aurora', label: 'Aurora', stops: ['#0f2a3d', '#1c5c6b', '#2f8f7a'] },
  { id: 'dusk', label: 'Dusk', stops: ['#2b1b3d', '#5c2f4e', '#b05a4a'] },
  { id: 'slate', label: 'Slate', stops: ['#14110f', '#2e2822', '#4a4038'] },
];

/** 1280x720 keeps the matte sharp on a 720p send without a large bitmap. */
const W = 1280;
const H = 720;

const cache = new Map<string, string>();

function draw(preset: BackgroundPreset): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, preset.stops[0]);
  grad.addColorStop(0.55, preset.stops[1]);
  grad.addColorStop(1, preset.stops[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // A few soft blobs so the backdrop has some depth instead of reading as a
  // flat wash, which is what makes a cut-out edge obvious.
  const blobs: [number, number, number, string][] = [
    [W * 0.25, H * 0.3, H * 0.55, 'rgba(255,255,255,0.07)'],
    [W * 0.78, H * 0.68, H * 0.5, 'rgba(255,255,255,0.05)'],
    [W * 0.6, H * 0.12, H * 0.35, 'rgba(0,0,0,0.12)'],
  ];
  for (const [x, y, r, colour] of blobs) {
    const radial = ctx.createRadialGradient(x, y, 0, x, y, r);
    radial.addColorStop(0, colour);
    radial.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, W, H);
  }
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** The image URL for a preset, drawn once and reused. */
export function presetImage(id: BackgroundPreset['id']): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const preset = BACKGROUND_PRESETS.find(p => p.id === id);
  if (!preset) throw new Error(`unknown background preset: ${id}`);
  const url = draw(preset);
  cache.set(id, url);
  return url;
}

/** A small preview for the picker, at thumbnail cost rather than full size. */
export function presetSwatch(id: BackgroundPreset['id']): string {
  const preset = BACKGROUND_PRESETS.find(p => p.id === id);
  if (!preset) return 'transparent';
  return `linear-gradient(135deg, ${preset.stops[0]}, ${preset.stops[1]} 55%, ${preset.stops[2]})`;
}
