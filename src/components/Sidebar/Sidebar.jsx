import { LogOut } from "lucide-react";
import Logo from "../Logo/Logo";
import MobileTabMenu from "../MobileTabMenu/MobileTabMenu";
import { STUDENT_TABS } from "../../lib/studentTabs";
import "./Sidebar.css";

// `items` lets the teacher portal reuse this shell with its own nav; students get STUDENT_TABS.
//
// `badges` is `{ tabId: count }` — currently only the LMS tab, for material a
// teacher has put up since she last looked. Null when there is nothing to say,
// so a portal that never passes it renders exactly as it did before.
// `onItemHover` warms a tab's code before it is asked for. Both portals lazy-load
// their tabs now, so without it the fetch cannot start until the click has landed;
// with it, the pointer resting on a nav item (or a finger landing on the bottom
// bar) is the head start. Same idea as preload.js and the admin sidebar.
export default function Sidebar({ active, setActive, onLogout, userLabel, items = STUDENT_TABS, badges = null, onItemHover = null }) {
  const badgeFor = (id) => (badges && badges[id] > 0 ? badges[id] : null);
  const warm = (id) => { if (onItemHover) onItemHover(id); };

  return (
    <>
      {/* Phone only. The bottom bar below is unchanged — this is the full list
          for the tabs that scroll off the end of it. */}
      <MobileTabMenu
        items={items}
        active={active}
        setActive={setActive}
        onLogout={onLogout}
        title="CMGC Portal"
        userLabel={userLabel}
        badges={badges}
        onItemHover={onItemHover}
      />

      <aside className="sidebar">
        <div className="sidebar__brand"><Logo size={26} /><span>CMGC Portal</span></div>
        {items.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} onMouseEnter={() => warm(it.id)} onFocus={() => warm(it.id)} className={`sidebar__item ${active === it.id ? "sidebar__item--active" : ""}`}>
            <it.icon size={17} /> {it.label}
            {badgeFor(it.id) && <span className="sidebar__badge">{badgeFor(it.id)}</span>}
          </button>
        ))}

        {/* Logout sits with the menu rather than only in the footer: with six
            nav items the footer is pushed to the bottom of a full-height column,
            where students were missing it. */}
        <button onClick={onLogout} className="sidebar__item sidebar__item--logout">
          <LogOut size={17} /> Logout
        </button>

        <div className="sidebar__footer">
          <p className="sidebar__user">{userLabel}</p>
        </div>
      </aside>

      <nav className="sidebar__mobile">
        {items.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} onTouchStart={() => warm(it.id)} className={`sidebar__mobile-item ${active === it.id ? "sidebar__mobile-item--active" : ""}`}>
            <it.icon size={18} />
            {it.label}
            {badgeFor(it.id) && <span className="sidebar__badge sidebar__badge--dot">{badgeFor(it.id)}</span>}
          </button>
        ))}
        <button onClick={onLogout} className="sidebar__mobile-item sidebar__mobile-item--logout"><LogOut size={18} /> Logout</button>
      </nav>
    </>
  );
}