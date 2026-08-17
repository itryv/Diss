import { Avatar, WindowFrame, WordMark } from '../chrome';
import { DCalendar, DCopy, DGear, DHome, DPlus, DRecordings } from '../dicons';
import { DISPLAY, MONO, modKey, note, useDesktop } from '../shell';

function NavItem({ icon, label, active, shortcut, onClick }: { icon: React.ReactNode; label: string; active?: boolean; shortcut?: string; onClick?: () => void }) {
  return (
    <div className={active ? undefined : 'dk-nav'} onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
      background: active ? '#2a241e' : undefined, color: active ? '#f4eee5' : '#a3988a',
      fontSize: 14, fontWeight: active ? 600 : 500, cursor: 'pointer',
    }}>
      {icon}{label}
      {shortcut && <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10.5, color: '#6f665b' }}>{shortcut}</span>}
    </div>
  );
}

function LaterRow({ time, title, dur }: { time: string; title: string; dur: string }) {
  return (
    <div className="dk-row" style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#1e1a16', border: '1px solid #2a241e', borderRadius: 12, padding: '14px 16px' }}>
      <span style={{ fontFamily: MONO, fontSize: 13, color: '#a3988a', width: 66 }}>{time}</span>
      <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{title}</span>
      <span style={{ fontSize: 13, color: '#6f665b' }}>{dur}</span>
    </div>
  );
}

export function MainWindow() {
  const { mac, go } = useDesktop();
  return (
    <>
      <WindowFrame title="Diss">
        <div style={{ display: 'flex', height: 620 }}>
          <aside style={{ width: 216, flex: 'none', background: '#1a1613', borderRight: '1px solid #241f1a', padding: '18px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* On Windows the wordmark already lives in the caption bar. */}
            {mac && <div style={{ padding: '2px 10px 18px' }}><WordMark /></div>}
            <NavItem icon={<DHome />} label="Home" active />
            <NavItem icon={<DCalendar />} label="Meetings" />
            <NavItem icon={<DRecordings />} label="Recordings" />
            <NavItem icon={<DGear />} label="Settings" shortcut={`${modKey(mac)},`} onClick={() => go('settings')} />
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: '#1e1a16', border: '1px solid #2a241e' }}>
              <Avatar initials="AO" color="#8a5a44" size={30} ring="transparent" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Amara Okafor</span>
            </div>
          </aside>

          <main style={{ flex: 1, padding: '30px 34px', overflow: 'hidden' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 28, letterSpacing: -0.6, marginBottom: 4 }}>Good afternoon, Amara</div>
            <div style={{ color: '#a3988a', fontSize: 14.5, marginBottom: 24 }}>Two meetings left today. The first one's soon.</div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 26 }}>
              <button className="hv-primary" style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '12px 18px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', boxShadow: '0 8px 30px rgba(240,139,95,.25)' }}>
                <DPlus size={17} />New meeting
              </button>
              <button className="hv-bg-2e" style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#241f1a', color: '#f4eee5', border: '1px solid #3a332b', borderRadius: 12, padding: '12px 18px', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>Join with a code</button>
              <button className="dk-ghost" style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', color: '#a3988a', border: '1px solid #2a241e', borderRadius: 12, padding: '12px 18px', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>
                <DCopy size={16} />Copy my link
              </button>
            </div>

            <div style={{ border: '1px solid #362f28', borderRadius: 18, background: 'linear-gradient(180deg,#221d18,#1e1a16)', padding: 22, display: 'flex', alignItems: 'center', gap: 20, marginBottom: 26 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#f0a97f', marginBottom: 7 }}>Up next · in 12 min</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, marginBottom: 8 }}>Weekly team sync</div>
                <div style={{ color: '#a3988a', fontSize: 13.5 }}>2:55 – 3:30 PM · 6 people invited</div>
              </div>
              <div style={{ display: 'flex' }}>
                <Avatar initials="LB" color="#5a7a6a" />
                <Avatar initials="PR" color="#7a5a7a" overlap />
                <Avatar initials="TN" color="#5a6a8a" overlap />
                <Avatar initials="+3" color="#2a241e" overlap />
              </div>
              <button className="hv-primary" onClick={() => go('meeting')} style={{ background: '#f08b5f', color: '#241209', border: 'none', borderRadius: 12, padding: '13px 26px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Join</button>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: '#6f665b', marginBottom: 10 }}>Later today</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <LaterRow time="4:00 PM" title="Design review — desktop shell" dur="45 min" />
              <LaterRow time="5:30 PM" title="1:1 with Priya" dur="30 min" />
            </div>
          </main>
        </div>
      </WindowFrame>
      <div style={{ ...note, position: 'absolute', bottom: 34, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', maxWidth: 640 }}>
        Shipped web screens render unchanged inside the shell. Desktop only owns the chrome: 1200×800 default, 940×640 min, size and position remembered. Title stays “Diss”.
      </div>
    </>
  );
}
