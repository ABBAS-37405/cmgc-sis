import { LayoutDashboard, Users, CalendarCheck, FileText, Wallet, Bell, BookOpen, ShieldCheck, LogOut, FileBarChart } from "lucide-react";
import Logo from "../Logo/Logo";
import { hasPermission } from "../../lib/adminAuth";
import "./AdminSidebar.css";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, permission: null },
  { id: "students", label: "Students", icon: Users, permission: "students" },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, permission: "attendance" },
  { id: "results", label: "Results", icon: FileText, permission: "results" },
  { id: "fee", label: "Fee Verification", icon: Wallet, permission: "fee" },
  { id: "notices", label: "Notices", icon: Bell, permission: "notices" },
  { id: "lms", label: "LMS", icon: BookOpen, permission: "lms" },
  // Also holds the non-teaching register and payroll — same `teachers` permission,
  // so no new key was added to PERMISSION_KEYS or the RLS policies built on it.
  { id: "teachers", label: "Teachers & Staff", icon: BookOpen, permission: "teachers" },
  { id: "reports", label: "Monthly Reports", icon: FileBarChart, permission: "reports" },
  { id: "admins", label: "Manage Admins", icon: ShieldCheck, permission: "__super_admin_only__" },
];

export default function AdminSidebar({ active, setActive, onLogout, adminProfile }) {
  const visibleItems = NAV_ITEMS.filter((it) => {
    if (it.permission === "__super_admin_only__") return !!adminProfile?.is_super_admin;
    if (!it.permission) return true;
    return hasPermission(adminProfile, it.permission);
  });

  const sidebarItems = [...visibleItems];
  const manageAdminsIndex = sidebarItems.findIndex((it) => it.id === "admins");
  const logoutItem = { id: "logout", label: "Logout", icon: LogOut, permission: null, isLogout: true };
  if (manageAdminsIndex >= 0) {
    sidebarItems.splice(manageAdminsIndex + 1, 0, logoutItem);
  } else {
    sidebarItems.push(logoutItem);
  }

  return (
    <>
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand"><Logo size={26} /><span>CMGC Admin</span></div>
        {sidebarItems.map((it) => (
          <button
            key={it.id}
            onClick={() => (it.isLogout ? onLogout() : setActive(it.id))}
            className={`admin-sidebar__item ${active === it.id ? "admin-sidebar__item--active" : ""} ${it.isLogout ? "admin-sidebar__item--logout" : ""}`}
          >
            <it.icon size={17} /> {it.label}
          </button>
        ))}
        <div className="admin-sidebar__footer">
          <p className="admin-sidebar__user">{adminProfile?.name || adminProfile?.email || "Admin"}</p>
        </div>
      </aside>
      <nav className="admin-sidebar__mobile">
        {sidebarItems.map((it) => (
          <button
            key={it.id}
            onClick={() => (it.isLogout ? onLogout() : setActive(it.id))}
            className={`admin-sidebar__mobile-item ${active === it.id ? "admin-sidebar__mobile-item--active" : ""} ${it.isLogout ? "admin-sidebar__mobile-item--logout" : ""}`}
          >
            <it.icon size={16} />{it.label}
          </button>
        ))}
      </nav>
    </>
  );
}