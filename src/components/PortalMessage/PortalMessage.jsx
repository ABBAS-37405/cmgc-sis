import { useState, useEffect, useRef } from "react";
import { Megaphone, X } from "lucide-react";
import {
  fetchPortalMessages, unreadFor, readSeenIds, writeSeenId,
} from "../../lib/portalMessages";
import "./PortalMessage.css";

const LONG_DATE = { day: "numeric", month: "long", year: "numeric" };

/**
 * The office's message, in front of whoever it was sent to.
 *
 * Rendered once by each portal — `Portal` for a student, `TeacherPortal` for a
 * teacher — rather than inside a tab, because the whole point of it is that it
 * does not wait for her to go and look. It costs one query, and only for someone
 * signed in.
 *
 * Four things about it:
 *
 * - **Only "Got it" marks it read.** Escape and a click outside close the dialog
 *   for now and it opens again next time she signs in. That is the opposite of
 *   the usual modal convention, and deliberate: this is the one thing on the
 *   screen she cannot go back and find later, so a stray key press must not be
 *   able to lose it. `BackGuard` treats Escape as "cancel" for the same reason —
 *   the safe answer is the one a mistake lands on.
 * - **They are read oldest first, one at a time**, with "1 of 3" on the header,
 *   so a run of them arrives in the order the office sent them rather than as a
 *   stack to be clicked through backwards.
 * - **What is read is remembered per viewer in this browser** — see
 *   `portalMessages.js`. There is no read-receipt table and there cannot be a
 *   useful one, because a student has no auth account to scope it to.
 * - **A failure here is silent.** No table yet, a refused read, a network that
 *   dropped: the dialog does not open and the portal behind it is untouched. It
 *   is the office talking over her shoulder, not a screen she asked for.
 */
export default function PortalMessage({ viewer, reader = "student" }) {
  const viewerId = viewer?.id || null;

  const [queue, setQueue] = useState([]);
  const [closed, setClosed] = useState(false);
  const liveIds = useRef([]);
  const okRef = useRef(null);

  useEffect(() => {
    if (!viewerId) return undefined;
    let live = true;

    const load = async () => {
      const { messages } = await fetchPortalMessages(reader);
      if (!live) return;
      liveIds.current = messages.map((m) => m.id);
      setQueue(unreadFor(messages, readSeenIds(viewerId)));
    };

    load();
    return () => { live = false; };
  }, [viewerId, reader]);

  const current = closed ? null : queue[0] || null;

  // The safe button takes focus, and Escape is "not now" rather than "read".
  useEffect(() => {
    if (!current) return undefined;
    okRef.current?.focus();

    const onKey = (e) => { if (e.key === "Escape") setClosed(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;

  const acknowledge = () => {
    writeSeenId(viewerId, current.id, liveIds.current);
    setQueue((rest) => rest.slice(1));
  };

  const total = queue.length;

  return (
    <div
      className="pmsg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pmsg-title"
      onClick={() => setClosed(true)}
    >
      <div className="pmsg__card" onClick={(e) => e.stopPropagation()}>
        <div className="pmsg__head">
          <span className="pmsg__icon"><Megaphone size={17} /></span>
          <div className="pmsg__from">
            <p className="pmsg__label">Message from the office</p>
            <p className="pmsg__date">
              {new Date(current.created_at).toLocaleDateString("en-PK", LONG_DATE)}
              {total > 1 && ` · 1 of ${total}`}
            </p>
          </div>
          {/* Closes it for now. It opens again next time she signs in, and the
              button says so rather than looking like a dismissal. */}
          <button
            type="button"
            className="pmsg__later"
            onClick={() => setClosed(true)}
            aria-label="Close for now — this message will be shown again"
            title="Close for now — it will be shown again next time"
          >
            <X size={16} />
          </button>
        </div>

        {current.title && <h3 className="pmsg__title" id="pmsg-title">{current.title}</h3>}
        <p className="pmsg__body" id={current.title ? undefined : "pmsg-title"}>{current.body}</p>

        <div className="pmsg__actions">
          <button type="button" ref={okRef} className="pmsg__btn" onClick={acknowledge}>
            {total > 1 ? "Got it — next" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
