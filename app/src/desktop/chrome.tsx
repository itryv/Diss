import { DISPLAY, useDesktop } from './shell';
import { WinClose, WinMaximize, WinMinimize } from './dicons';

/** Traffic lights (macOS). `onClose` is wired only where the design wires it. */
export function TrafficLights({ onClose }: { onClose?: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span onClick={onClose} style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', cursor: onClose ? 'pointer' : undefined }} />
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
    </div>
  );
}

/** Windows caption controls: minimize / maximize / close (close reddens on hover). */
export function CaptionControls({ onClose }: { onClose?: () => void }) {
  const cell: React.CSSProperties = { width: 46, display: 'grid', placeItems: 'center', cursor: 'pointer' };
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <div className="dk-cap" style={cell}><WinMinimize /></div>
      <div className="dk-cap" style={cell}><WinMaximize /></div>
      <div className="dk-cap-close" onClick={onClose} style={cell}><WinClose /></div>
    </div>
  );
}

export function WordMark({ size = 20 }: { size?: number }) {
  return (
    <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: size, letterSpacing: -0.4 }}>
      diss<span style={{ color: '#f08b5f', fontSize: size * 1.2, lineHeight: 0.6 }}>.</span>
    </span>
  );
}

export function Avatar({ initials, color, size = 34, ring = '#1e1a16', overlap = false }: { initials: string; color: string; size?: number; ring?: string; overlap?: boolean }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', background: color,
      border: `2px solid ${ring}`, marginLeft: overlap ? -(size * 0.29) : 0,
      display: 'grid', placeItems: 'center',
      fontSize: size * 0.34, fontWeight: 700, color: '#f4eee5', flex: 'none',
    }}>{initials}</span>
  );
}

/** Settings-row switch. The design uses a 44×26 track here (larger than the web app's 38×22). */
export function Switch({ on, size = 'lg' }: { on: boolean; size?: 'lg' | 'sm' }) {
  const lg = size === 'lg';
  const w = lg ? 44 : 38, h = lg ? 26 : 22, k = lg ? 20 : 16, travel = lg ? 18 : 16;
  return (
    <span style={{ width: w, height: h, flex: 'none', borderRadius: 99, background: on ? '#f08b5f' : '#3a332b', position: 'relative', transition: 'background .18s ease' }}>
      <span style={{ position: 'absolute', top: 3, left: 3, width: k, height: k, borderRadius: '50%', background: '#f4eee5', transform: `translateX(${on ? travel : 0}px)`, transition: 'transform .18s ease' }} />
    </span>
  );
}

/** Window frame with the platform's own title bar. */
export function WindowFrame({ title, dot, onClose, background = '#151210', barBg, borderBg, children, style }: {
  title: string;
  dot?: boolean;
  onClose?: () => void;
  background?: string;
  barBg?: string;
  borderBg?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { mac } = useDesktop();
  const bar = barBg ?? '#1a1613';
  const border = borderBg ?? '#241f1a';
  const titleContent = (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6fbf8f' }} />}
      {title}
    </span>
  );
  return (
    <div style={{ width: 1120, maxWidth: '100%', borderRadius: 12, overflow: 'hidden', background, border: '1px solid #2e2822', boxShadow: '0 40px 120px rgba(0,0,0,.65)', animation: 'fadeUp .3s ease', ...style }}>
      {mac ? (
        <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 14px', background: bar, borderBottom: `1px solid ${border}`, position: 'relative' }}>
          <TrafficLights onClose={onClose} />
          <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#a3988a', pointerEvents: 'none' }}>{titleContent}</div>
        </div>
      ) : (
        <div style={{ height: 34, display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', background: bar, borderBottom: `1px solid ${border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 12, fontSize: 12.5, fontWeight: 600, color: '#a3988a' }}>
            {dot ? <><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6fbf8f' }} />{title}</> : <WordMark size={14} />}
          </div>
          <CaptionControls onClose={onClose} />
        </div>
      )}
      {children}
    </div>
  );
}
