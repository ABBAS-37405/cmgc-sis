import { Home, CalendarCheck, FileText, Wallet, LogOut, GraduationCap } from "lucide-react";
import "./Sidebar.css";

const ITEMS = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "results", label: "Results", icon: FileText },
  { id: "fee", label: "Fee", icon: Wallet },
];

export default function Sidebar({ active, setActive, onLogout, userLabel }) {
  return (
    <>
      <aside className="sidebar">
        <div className="sidebar__brand"><GraduationCap size={22} /><span>CMGC Portal</span></div>
        {ITEMS.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`sidebar__item ${active === it.id ? "sidebar__item--active" : ""}`}>
            <it.icon size={17} /> {it.label}
          </button>
        ))}
        <div className="sidebar__footer">
          <p className="sidebar__user">{userLabel}</p>
          <button onClick={onLogout} className="sidebar__logout"><LogOut size={16} /> Logout</button>
        </div>
      </aside>

      <nav className="sidebar__mobile">
        {ITEMS.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`sidebar__mobile-item ${active === it.id ? "sidebar__mobile-item--active" : ""}`}>
            <it.icon size={18} />
            {it.label}
          </button>
        ))}
        <button onClick={onLogout} className="sidebar__mobile-item sidebar__mobile-item--logout"><LogOut size={18} /> Exit</button>
      </nav>
    </>
  );
}