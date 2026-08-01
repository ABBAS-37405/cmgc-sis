import { LogOut } from "lucide-react";
import Logo from "../Logo/Logo";
import { STUDENT_TABS } from "../../lib/studentTabs";
import "./Sidebar.css";

// `items` lets the teacher portal reuse this shell with its own nav; students get STUDENT_TABS.
export default function Sidebar({ active, setActive, onLogout, userLabel, items = STUDENT_TABS }) {
  return (
    <>
      <aside className="sidebar">
        <div className="sidebar__brand"><Logo size={26} /><span>CMGC Portal</span></div>
        {items.map((it) => (
          <button key={it.id} onClick={() => setActive(it.id)} className={`sidebar__item ${active === it.id ? "sidebar__item--active" : ""}`}>
            <it.icon size={17} /> {it.label}
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
          <button key={it.id} onClick={() => setActive(it.id)} className={`sidebar__mobile-item ${active === it.id ? "sidebar__mobile-item--active" : ""}`}>
            <it.icon size={18} />
            {it.label}
          </button>
        ))}
        <button onClick={onLogout} className="sidebar__mobile-item sidebar__mobile-item--logout"><LogOut size={18} /> Logout</button>
      </nav>
    </>
  );
}