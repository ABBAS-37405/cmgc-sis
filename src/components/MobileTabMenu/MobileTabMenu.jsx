import { useEffect, useState } from "react";
import { ChevronDown, LogOut, X } from "lucide-react";
import Logo from "../Logo/Logo";
import "./MobileTabMenu.css";

/**
 * The phone's tab menu, for both portals.
 *
 * It does not replace the bottom bar — that stays exactly as it is, because a
 * tab already on screen beats one you have to open a menu to find. This is the
 * relief for the tabs that scrolled off the end of it: every screen in one
 * list, named in full, with the one she is on marked.
 *
 * `items` is the same array the bar renders, so the two can never offer
 * different screens. Logout is appended here rather than passed in, so a caller
 * cannot forget it — the bottom bar is scrollable and Logout is the item most
 * often pushed past its right edge.
 *
 * Hidden above 1024px, where the real sidebar takes over.
 */
export default function MobileTabMenu({ items, active, setActive, onLogout, title, userLabel, variant = "student", badges = null }) {
  const [open, setOpen] = useState(false);

  const current = items.find((it) => it.id === active);
  // `{ tabId: count }`, or null. The trigger carries a plain dot instead of the
  // number: it names the tab she is on, and a count beside a different tab's
  // name would read as belonging to it.
  const badgeFor = (id) => (badges && badges[id] > 0 ? badges[id] : null);
  const anyBadge = items.some((it) => badgeFor(it.id));

  // Escape closes it. Registered only while open, so it cannot swallow a press
  // meant for a modal on the screen behind.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /*
   * The menu is a fixed overlay, so without this the page behind it scrolls
   * under her finger and she closes the menu onto a different part of the
   * screen than she opened it from.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const choose = (id) => {
    setOpen(false);
    setActive(id);
    // She picked this from a bar pinned to the top of the screen; landing
    // half way down the new one would look like nothing happened.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const block = `mtm mtm--${variant}`;

  return (
    <>
      <div className={block}>
        <div className="mtm__brand"><Logo size={22} /><span>{title}</span></div>
        <button
          type="button"
          className="mtm__trigger"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {current?.icon && <current.icon size={15} />}
          <span className="mtm__trigger-label">{current?.label || "Menu"}</span>
          {anyBadge && !open && <span className="mtm__dot" aria-label="New material" />}
          <ChevronDown size={15} className={`mtm__chev ${open ? "mtm__chev--open" : ""}`} />
        </button>
      </div>

      {open && (
        <div className={`mtm__overlay mtm__overlay--${variant}`}>
          {/* Sits behind the panel and swallows the tap that closes it, so a
              press anywhere off the list gets her out. */}
          <button
            type="button"
            className="mtm__backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="mtm__panel" role="menu">
            <div className="mtm__panel-head">
              <span className="mtm__panel-title">{userLabel || title}</span>
              <button type="button" className="mtm__close" onClick={() => setOpen(false)} aria-label="Close menu">
                <X size={16} />
              </button>
            </div>

            <div className="mtm__items">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  onClick={() => choose(it.id)}
                  className={`mtm__item ${active === it.id ? "mtm__item--active" : ""}`}
                >
                  <it.icon size={17} /> {it.label}
                  {badgeFor(it.id) && <span className="mtm__badge">{badgeFor(it.id)}</span>}
                </button>
              ))}
            </div>

            <button type="button" className="mtm__item mtm__item--logout" onClick={onLogout}>
              <LogOut size={17} /> Logout
            </button>
          </div>
        </div>
      )}
    </>
  );
}
