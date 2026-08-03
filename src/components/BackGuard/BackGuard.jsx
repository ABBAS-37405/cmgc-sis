import { useEffect, useRef } from "react";
import { LogOut, ExternalLink } from "lucide-react";
import Logo from "../Logo/Logo";
import { useBackGuard, answerPending } from "../../lib/backStack";
import "./BackGuard.css";

/**
 * The question the Back button asks before it does something she cannot undo —
 * leaving the site, or signing out of a portal.
 *
 * Rendered once by App, outside every screen branch, because it is also what
 * installs the history guard: unmounting it would disarm the back button.
 *
 * Cancel is the safe answer, so Escape and a click on the backdrop both mean
 * "stay", and it is the button that takes focus.
 */
export default function BackGuard() {
  const pending = useBackGuard();
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") answerPending(false);
      if (e.key === "Enter" && document.activeElement === cancelRef.current) answerPending(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!pending) return null;

  const leaving = !pending.signOut;

  return (
    <div
      className="backguard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backguard-title"
      onClick={() => answerPending(false)}
    >
      <div className="backguard__card" onClick={(e) => e.stopPropagation()}>
        <div className="backguard__head">
          <span className="backguard__icon">
            {leaving ? <ExternalLink size={18} /> : <LogOut size={18} />}
          </span>
          <Logo size={30} />
        </div>

        <h3 className="backguard__title" id="backguard-title">{pending.title}</h3>
        <p className="backguard__body">{pending.body}</p>

        <div className="backguard__actions">
          <button
            type="button"
            ref={cancelRef}
            className="backguard__btn"
            onClick={() => answerPending(false)}
          >
            {pending.cancelLabel}
          </button>
          <button
            type="button"
            className="backguard__btn backguard__btn--go"
            onClick={() => answerPending(true)}
          >
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
