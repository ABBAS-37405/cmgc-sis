import { LogOut } from "lucide-react";
import Logo from "../Logo/Logo";
import MobileTabMenu from "../MobileTabMenu/MobileTabMenu";
import { ADMIN_NAV_ITEMS, canSeeAdminTab } from "../../lib/adminNav";
import "./AdminSidebar.css";

/**
 * `onItemHover` is how a tab's code starts downloading before it is asked for.
 * Every tab but the Overview is `lazy()` in AdminPortal now, so without it the
 * fetch cannot begin until the click has already landed. The pointer resting on
 * a nav item is the earliest honest signal, exactly as `preload.js` treats the
 * pointer on the Portal button; `touchstart` covers a phone, where there is no
 * hover but there is still a moment between the finger landing and lifting.
 */
export default function AdminSidebar({ active, setActive, onLogout, adminProfile, onItemHover }) {
  const warm = (id) => { if (onItemHover) onItemHover(id); };
  const visibleItems = ADMIN_NAV_ITEMS.filter((it) => canSeeAdminTab(adminProfile, it.id));

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
      {/* Phone only. Fed `visibleItems`, not `sidebarItems` — it renders its own
          Logout, so passing the injected one would show it twice. The bottom bar
          below is unchanged; this is the full list for the tabs that scroll off
          the end of it. */}
      <MobileTabMenu
        items={visibleItems}
        active={active}
        setActive={setActive}
        onLogout={onLogout}
        onItemHover={onItemHover}
        title="CMGC Admin"
        userLabel={adminProfile?.name || adminProfile?.email || "Admin"}
        variant="admin"
      />

      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand"><Logo size={26} /><span>CMGC Admin</span></div>
        {sidebarItems.map((it) => (
          <button
            key={it.id}
            onClick={() => (it.isLogout ? onLogout() : setActive(it.id))}
            onMouseEnter={() => !it.isLogout && warm(it.id)}
            onFocus={() => !it.isLogout && warm(it.id)}
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
            onTouchStart={() => !it.isLogout && warm(it.id)}
            className={`admin-sidebar__mobile-item ${active === it.id ? "admin-sidebar__mobile-item--active" : ""} ${it.isLogout ? "admin-sidebar__mobile-item--logout" : ""}`}
          >
            <it.icon size={16} />{it.label}
          </button>
        ))}
      </nav>
    </>
  );
}