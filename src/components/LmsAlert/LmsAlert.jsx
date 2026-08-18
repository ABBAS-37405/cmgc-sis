import { BookOpen, X } from "lucide-react";
import { summariseNewMaterial } from "../../lib/lmsAlerts";
import { categoryLabel } from "../../lib/lms";
import "./LmsAlert.css";

const when = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short" }) : "";

/**
 * The short notice on her Overview: a teacher has put something up for her class.
 *
 * It names what went up rather than counting it. "3 new items" gives her nothing
 * to decide on; "Physics — Chapter 4 Notes" tells her whether it is worth opening
 * now, which is the entire job of a notice this small.
 *
 * Nothing is written when it is shown or dismissed — see `useLmsAlerts`. Opening
 * the LMS is what marks it read, so the one action on it is the one that also
 * clears it.
 */
export default function LmsAlert({ items, onOpen, onDismiss }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="lms-alert" role="status">
      <span className="lms-alert__icon"><BookOpen size={18} /></span>

      <div className="lms-alert__body">
        <p className="lms-alert__head">
          {items.length === 1
            ? "Your teacher has uploaded new material"
            : `Your teachers have uploaded ${items.length} new items`}
        </p>
        <p className="lms-alert__what">{summariseNewMaterial(items)}</p>

        {/* The full list only while it is short enough to read at a glance —
            past that the summary line above is doing the work. */}
        {items.length > 1 && items.length <= 4 && (
          <ul className="lms-alert__list">
            {items.map((m) => (
              <li key={m.id}>
                <strong>{m.subject}</strong> — {m.title}
                <span className="lms-alert__tag">{categoryLabel(m.category)}</span>
                <span className="lms-alert__when">{when(m.created_at)}</span>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="lms-alert__open" onClick={onOpen}>
          Open the LMS tab to see it
        </button>
      </div>

      <button type="button" className="lms-alert__close" onClick={onDismiss} aria-label="Hide this notice">
        <X size={15} />
      </button>
    </div>
  );
}
