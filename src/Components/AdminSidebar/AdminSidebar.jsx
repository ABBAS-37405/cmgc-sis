import { GraduationCap, LayoutDashboard, Users, CalendarCheck, FileText, Wallet, Bell, LogOut } from "lucide-react";
import "./AdminSidebar.css";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "students", label: "Students", icon: Users },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "results", label: "Results", icon: FileText },
  { id: "fee", label: "Fee Verification", icon: Wallet },
  { id: "notices", label: "Notices", icon: Bell },
];

export default function AdminSidebar({ active, setActive, onLogout }) {
  return (
    <>
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand"><GraduationCap size={22} /><span>CMGC Admin</span></div>
        {NAV_ITEMS.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`admin-sidebar__item ${active === it.id ? "admin-sidebar__item--active" : ""}`}>
            <it.icon size={17} /> {it.label}
          </button>
        ))}
        <div className="admin-sidebar__footer">
          <p className="admin-sidebar__user">Admin</p>
          <button onClick={onLogout} className="admin-sidebar__logout"><LogOut size={16} /> Logout</button>
        </div>
      </aside>
      <nav className="admin-sidebar__mobile">
        {NAV_ITEMS.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`admin-sidebar__mobile-item ${active === it.id ? "admin-sidebar__mobile-item--active" : ""}`}>
            <it.icon size={16} />{it.label}
          </button>
        ))}
        <button onClick={onLogout} className="admin-sidebar__mobile-item admin-sidebar__mobile-item--logout"><LogOut size={16} /> Exit</button>
      </nav>
    </>
  );
}