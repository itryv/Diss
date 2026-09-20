import { useRef } from 'react';
import { useApp } from '../store';
import { BACKGROUND_PRESETS, presetSwatch } from '../backgrounds';
import type { BackgroundId } from '../backgrounds';
import { Ic } from '../icons';

/** Max size for an uploaded background. Bigger just costs memory for no gain. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

interface Choice {
  id: BackgroundId;
  label: string;
  /** CSS background for the swatch. */
  swatch: string;
  icon?: 'video' | 'blur';
}

/**
 * Background chooser: off, blur, a generated preset, or your own image.
 *
 * Rendered in the lobby, in Settings and in the in-call More menu, so the
 * choice is made in the same way wherever it is offered.
 */
export function BackgroundPicker({ compact = false }: { compact?: boolean }) {
  const app = useApp();
  const s = app.s;
  const fileRef = useRef<HTMLInputElement>(null);

  if (!s.blurSupported) return null;

  const choices: Choice[] = [
    { id: 'none', label: 'None', swatch: '#1c1815', icon: 'video' },
    { id: 'blur', label: 'Blur', swatch: 'linear-gradient(135deg,#3a332b,#5c5348)', icon: 'blur' },
    ...BACKGROUND_PRESETS.map(p => ({ id: p.id as BackgroundId, label: p.label, swatch: presetSwatch(p.id) })),
  ];

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { app.toast('That file is not an image'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { app.toast('That image is too large — pick one under 8MB'); return; }
    // Stays on this machine: an object URL is a local handle, never uploaded.
    app.setBackground('custom', URL.createObjectURL(file));
  };

  const size = compact ? 42 : 52;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {choices.map(c => {
          const on = s.bgEffect === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => app.setBackground(c.id)}
              aria-pressed={on}
              aria-label={`Background: ${c.label}`}
              title={c.label}
              style={{
                width: size, height: size, borderRadius: 12, background: c.swatch,
                border: `2px solid ${on ? '#f08b5f' : '#3a332b'}`, cursor: 'pointer', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f4eee5',
              }}
            >
              {c.icon && <Ic name={c.icon === 'video' ? 'videoOff' : 'blur'} size={17} />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-pressed={s.bgEffect === 'custom'}
          aria-label="Background: upload your own image"
          title="Upload an image"
          style={{
            width: size, height: size, borderRadius: 12,
            background: s.bgCustomUrl ? `center/cover url(${s.bgCustomUrl})` : '#1c1815',
            border: `2px solid ${s.bgEffect === 'custom' ? '#f08b5f' : '#3a332b'}`,
            cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#9a9084',
          }}
        >
          {!s.bgCustomUrl && <Ic name="camera" size={17} />}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
        style={{ display: 'none' }}
      />
    </div>
  );
}
