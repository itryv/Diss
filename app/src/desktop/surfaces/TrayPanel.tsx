import { Avatar } from '../chrome';
import { DCam, DCopy, DLink, DMicOff, DPlus } from '../dicons';
import { DISPLAY, MONO, modKey, sectionLabel, useDesktop } from '../shell';

function IconState({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: '#1a1613', display: 'grid', placeItems: 'center', marginBottom: 7, position: 'relative' }}>{children}</span>
      <span style={{ display: 'block', fontSize: 11, color: '#8a7f70' }}>{label}</span>
    </div>
  );
}

function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="hv-bg-2a" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: '#1e1a16', border: '1px solid #2e2822', borderRadius: 11, padding: '11px 6px', color: '#f4eee5', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
      {icon}{label}
    </button>
  );
}

function TodayRow({ time, title }: { time: string; title: string }) {
  return (
    <div className="dk-tray-row" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 8px', borderRadius: 9, cursor: 'pointer' }}>
      <span style={{ fontFamily: MONO, fontSize: 11.5, color: '#8a7f70', width: 52 }}>{time}</span>
      <span style={{ fontSize: 13, fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f0a97f' }}>Join</span>
    </div>
  );
}

function MenuRow({ label, shortcut, onClick }: { label: string; shortcut?: string; onClick?: () => void }) {
  return (
    <div className="dk-tray-row" onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: 8, borderRadius: 8, fontSize: 13, color: '#d6cec2', cursor: 'pointer' }}>
      {label}
      {shortcut && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: '#6f665b' }}>{shortcut}</span>}
    </div>
  );
}

export function TrayPanel() {
  const { s, mac, go } = useDesktop();
  return (
    <div style={{ width: '100%', maxWidth: 1120, position: 'relative', minHeight: 620 }}>
      <div style={{ position: 'absolute', top: 0, color: '#6f665b', fontSize: 12.5, maxWidth: 420, lineHeight: 1.55 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, color: '#f4eee5', marginBottom: 8 }}>
          {mac ? 'Menu-bar panel' : 'System-tray flyout'}
        </div>
        Action-first density: the join decision sits at the top at button scale, the calendar list is support. Click the dot in the {mac ? 'menu bar' : 'system tray'} to toggle the panel.
        <div style={{ ...sectionLabel, marginTop: 26 }}>Icon states</div>
        <div style={{ display: 'flex', gap: 22, marginTop: 14 }}>
          <IconState label="Idle"><span style={{ width: 12, height: 12, borderRadius: '50%', background: '#a3988a' }} /></IconState>
          <IconState label="Soon">
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#a3988a' }} />
            <span style={{ position: 'absolute', top: 7, right: 7, width: 6, height: 6, borderRadius: '50%', background: '#f08b5f' }} />
          </IconState>
          <IconState label="In meeting"><span style={{ width: 12, height: 12, borderRadius: '50%', background: '#f08b5f', boxShadow: '0 0 12px rgba(240,139,95,.7)' }} /></IconState>
          <IconState label="Muted">
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#c94a38' }} />
            <span style={{ position: 'absolute', width: 22, height: 1.6, background: '#f4eee5', transform: 'rotate(-45deg)' }} />
          </IconState>
        </div>
      </div>

      {/* The panel hangs from the menu bar on macOS and rises from the taskbar on Windows. */}
      {s.trayOpen && (
        <div style={{
          position: 'absolute', top: mac ? 0 : 'auto', bottom: mac ? 'auto' : 0, right: 0, width: 320,
          background: '#241f1a', border: '1px solid #3a332b', borderRadius: mac ? 16 : 12,
          boxShadow: '0 24px 70px rgba(0,0,0,.65)', padding: 12, animation: 'fadeUp .22s ease',
        }}>
          <div style={{ border: '1px solid #362f28', borderRadius: 14, background: 'linear-gradient(180deg,#2a241e,#221d18)', padding: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#f0a97f', marginBottom: 6 }}>Up next · in 12 min</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16.5, marginBottom: 10 }}>Weekly team sync</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
              <span style={{ display: 'flex' }}>
                <Avatar initials="LB" color="#5a7a6a" size={24} ring="#241f1a" />
                <Avatar initials="PR" color="#7a5a7a" size={24} ring="#241f1a" overlap />
                <Avatar initials="TN" color="#5a6a8a" size={24} ring="#241f1a" overlap />
              </span>
              <span style={{ fontSize: 12.5, color: '#a3988a' }}>2:55 PM · 6 invited</span>
            </div>
            <button className="hv-primary" onClick={() => go('meeting')} style={{ width: '100%', background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 11, padding: 11, fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>Join</button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <QuickAction icon={<DPlus size={16} color="#f08b5f" />} label="New" />
            <QuickAction icon={<DLink size={16} color="#f08b5f" />} label="Join code" />
            <QuickAction icon={<DCopy size={16} color="#f08b5f" />} label="Copy link" />
          </div>

          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#6f665b', padding: '16px 6px 8px' }}>Today</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TodayRow time="4:00 PM" title="Design review" />
            <TodayRow time="5:30 PM" title="1:1 with Priya" />
          </div>

          <div style={{ height: 1, background: '#3a332b', margin: '12px 4px 8px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <MenuRow label="Open Diss" />
            <MenuRow label="Settings" shortcut={`${modKey(mac)},`} onClick={() => go('settings')} />
            <MenuRow label="Quit Diss" shortcut={`${modKey(mac)}Q`} />
          </div>
        </div>
      )}

      {/* In-call variant of the same card, plus the empty state. */}
      <div style={{ position: 'absolute', top: 300, left: 0, width: 320 }}>
        <div style={{ ...sectionLabel, marginBottom: 12 }}>While in a meeting, the card becomes</div>
        <div style={{ background: '#241f1a', border: '1px solid #3a332b', borderRadius: 14, padding: 12, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6fbf8f' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>Weekly team sync</span>
            <span style={{ fontFamily: MONO, fontSize: 12, color: '#a3988a' }}>12:04</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="hv-danger" style={{ flex: 1, display: 'grid', placeItems: 'center', background: '#c94a38', border: 'none', borderRadius: 9, padding: 9, cursor: 'pointer', color: '#fff' }}><DMicOff size={16} /></button>
            <button className="dk-btn-2e" style={{ flex: 1, display: 'grid', placeItems: 'center', background: '#2e2822', border: 'none', borderRadius: 9, padding: 9, cursor: 'pointer', color: '#f4eee5' }}><DCam size={16} /></button>
            <button className="hv-danger-soft" style={{ flex: 2, background: 'rgba(224,96,79,.12)', border: '1px solid rgba(224,96,79,.3)', borderRadius: 9, padding: 9, cursor: 'pointer', color: '#e0836f', fontSize: 12.5, fontWeight: 700 }}>Leave</button>
          </div>
        </div>
        <div style={{ marginTop: 24, background: '#1a1613', border: '1px dashed #362f28', borderRadius: 12, padding: 14, color: '#8a7f70', fontSize: 12.5, lineHeight: 1.5 }}>
          <span style={{ color: '#a3988a', fontWeight: 600 }}>Empty state:</span> “Nothing scheduled today — enjoy the quiet.”
        </div>
      </div>
    </div>
  );
}
