import { ArrowRight, ArrowLeft } from "lucide-react";
import { tabAfter, tabBefore } from "../../lib/studentTabs";
import "./TabNav.css";

/**
 * Moves the student back and forward through her portal a screen at a time, so
 * everything can be reached without finding the sidebar — which sits at the
 * bottom of the screen on a phone and is easy to miss.
 *
 * The order comes from the same list the sidebar renders. Neither button is
 * invented where there is nothing to go to: the first screen has no Previous,
 * the last has no Next.
 */
export default function TabNav({ current, setActive }) {
  const previous = tabBefore(current);
  const next = tabAfter(current);
  if (!previous && !next) return null;

  const go = (tab) => {
    setActive(tab.id);
    // These sit at the foot of the page, so without this she would arrive at
    // the bottom of the next screen instead of the top of it.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <nav className="tabnav" aria-label="Move between portal screens">
      {previous ? (
        <button type="button" className="tabnav__btn tabnav__btn--prev" onClick={() => go(previous)}>
          <ArrowLeft size={18} className="tabnav__arrow" />
          <span className="tabnav__text">
            <span className="tabnav__label">Previous</span>
            <span className="tabnav__name">{previous.label}</span>
          </span>
        </button>
      ) : (
        // Holds the column so a lone Next stays on the right rather than
        // sliding across to where Previous should be.
        <span className="tabnav__spacer" aria-hidden="true" />
      )}

      {next && (
        <button type="button" className="tabnav__btn tabnav__btn--next" onClick={() => go(next)}>
          <span className="tabnav__text">
            <span className="tabnav__label">Next</span>
            <span className="tabnav__name">{next.label}</span>
          </span>
          <ArrowRight size={18} className="tabnav__arrow" />
        </button>
      )}
    </nav>
  );
}
