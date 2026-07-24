import { GraduationCap, LayoutDashboard, Users, CalendarCheck, FileText, Wallet, Bell, ShieldCheck, LogOut } from "lucide-react";
import { hasPermission } from "../../lib/adminAuth";
import "./AdminSidebar.css";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, permission: null },
  { id: "students", label: "Students", icon: Users, permission: "students" },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, permission: "attendance" },
  { id: "results", label: "Results", icon: FileText, permission: "results" },
  { id: "fee", label: "Fee Verification", icon: Wallet, permission: "fee" },
  { id: "notices", label: "Notices", icon: Bell, permission: "notices" },
  { id: "admins", label: "Manage Admins", icon: ShieldCheck, permission: "__super_admin_only__" },
];

export default function AdminSidebar({ active, setActive, onLogout, adminProfile }) {
  const visibleItems = NAV_ITEMS.filter((it) => {
    if (it.permission === "__super_admin_only__") return !!adminProfile?.is_super_admin;
    if (!it.permission) return true;
    return hasPermission(adminProfile, it.permission);
  });

  return (
    <>
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand"><GraduationCap size={22} /><span>CMGC Admin</span></div>
        {visibleItems.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`admin-sidebar__item ${active === it.id ? "admin-sidebar__item--active" : ""}`}>
            <it.icon size={17} /> {it.label}
          </button>
        ))}
        <div className="admin-sidebar__footer">
          <p className="admin-sidebar__user">{adminProfile?.name || adminProfile?.email || "Admin"}</p>
          <button onClick={onLogout} className="admin-sidebar__logout"><LogOut size={16} /> Logout</button>
        </div>
      </aside>
      <nav className="admin-sidebar__mobile">
        {visibleItems.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`admin-sidebar__mobile-item ${active === it.id ? "admin-sidebar__mobile-item--active" : ""}`}>
            <it.icon size={16} />{it.label}
          </button>
        ))}
        <button onClick={onLogout} className="admin-sidebar__mobile-item admin-sidebar__mobile-item--logout"><LogOut size={16} /> Exit</button>
      </nav>
    </>
  );
}