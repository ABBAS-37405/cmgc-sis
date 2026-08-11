import { useState, useRef, useEffect } from "react";
import { openWhatsApp, isDemoMode } from "../../lib/whatsapp";

/**
 * Sending one message to many people, with the admin confirming once.
 *
 * Bulk WhatsApp is a queue and never a loop: `window.open` fired repeatedly in
 * one tick gets blocked after the first tab, and WhatsApp Web drops chats pushed
 * at it in the same second. What this hook adds on top of that is that the queue
 * advances on its own — a class of thirty used to mean thirty clicks in the
 * portal on top of thirty presses of Send.
 *
 * Four things make that work, and each one is load-bearing:
 *
 * - ONE window is reserved inside the confirm click and held in `windowRef`;
 *   every later chat is a `location.href` assignment on it. Navigating a window
 *   you already own is not a popup, so it needs no gesture — that is the whole
 *   reason the queue can move without a click. If she closes that tab, `openAt`
 *   returns false and the run stops rather than falling through to a
 *   `window.open` the browser would block.
 * - The advance trigger is `blur`/`focus` on `window`, not `visibilitychange`.
 *   They are not interchangeable: an admin running the portal and WhatsApp side
 *   by side in two windows never hides either tab, so `visibilitychange` would
 *   never fire.
 * - `armedRef` is a ref and the effect has no dependency array. No deps means
 *   the listener never closes over a stale queue; the ref means an unrelated
 *   re-render while she is away in WhatsApp cannot quietly disarm it. Arming is
 *   what stops the very first return — the one caused by opening the tab — from
 *   skipping a recipient.
 * - Entries arrive already screened and already carrying their message. Anything
 *   that could raise a modal (a missing number, a prompt) has to be resolved
 *   before `start`, because one dialog half way through strands the rest of the
 *   run.
 *
 * NOTHING HERE SENDS. WhatsApp click-to-chat only pre-fills; a human still
 * presses Send. This removes the clicking on our side, not on theirs. Actual
 * delivery needs the WhatsApp Business API — see the note at the top of
 * `lib/whatsapp.js`.
 *
 * An entry is `{ id, name, number, message }`. `skipped` is whatever the caller
 * could not build an entry for; it is carried only so the finished panel can
 * name them.
 */
export function useWhatsAppQueue() {
  const [queue, setQueue] = useState(null); // { list, index, skipped, finished }
  const windowRef = useRef(null);
  const armedRef = useRef(false);

  // Returns false when the reserved tab is gone, so the caller can stop rather
  // than fall through to a window.open the browser will block — nothing after
  // the first chat runs inside a click gesture.
  const openAt = (list, index) => {
    const entry = list[index];
    if (!entry) return true;

    const held = windowRef.current;
    if (!isDemoMode() && (!held || held.closed)) return false;

    openWhatsApp(entry.number, entry.message, held);
    // Bring the chat forward. Assigning location on a background tab does not
    // raise it, so without this she would have to hunt for the WhatsApp tab
    // after every recipient. Best effort — a browser that refuses just leaves
    // her to switch tabs herself, which is what she was doing anyway.
    try {
      held?.focus();
    } catch {
      // ignore — the chat is loaded either way
    }
    return true;
  };

  const stop = () => {
    windowRef.current = null; // left open — she may still be typing in it
    armedRef.current = false;
    setQueue(null);
  };

  const next = () => {
    if (!queue || queue.finished) return;
    const i = queue.index + 1;
    if (i >= queue.list.length) {
      setQueue({ ...queue, finished: true });
      return;
    }
    if (!openAt(queue.list, i)) {
      alert(
        `The WhatsApp tab was closed, so the run stopped at ${queue.list[queue.index]?.name}.\n\n` +
        "Start again to finish the rest — anyone already messaged will simply get the chat opened a " +
        "second time, and you can close it without sending."
      );
      stop();
      return;
    }
    setQueue({ ...queue, index: i });
  };

  /**
   * The single confirm the admin answers. Returns false if she declined or the
   * run could not start, so the caller can leave its own panel open.
   */
  const start = ({ entries = [], skipped = [], what = "this message", recipientNoun = "recipient" }) => {
    if (entries.length === 0) {
      alert(`Nobody on this list has a usable WhatsApp number, so there is no one to send ${what} to.`);
      return false;
    }

    const plural = entries.length === 1 ? recipientNoun : `${recipientNoun}s`;
    const ok = window.confirm(
      `Send ${what} to ${entries.length} ${plural}, one by one?\n\n` +
      "One WhatsApp tab will open. For each one: press Send in WhatsApp, then switch back to this tab — " +
      "the next chat loads by itself. You will not have to click here again.\n\n" +
      (skipped.length > 0
        ? `${skipped.length} ${skipped.length === 1 ? "has" : "have"} no usable WhatsApp number and will be ` +
          "skipped (listed at the end).\n\n"
        : "") +
      "Start now?"
    );
    if (!ok) return false;

    // Reserved inside the click gesture, the same trick StudentsList.doApprove
    // uses — every later chat reuses this window instead of asking for a popup.
    if (!isDemoMode()) {
      const reserved = window.open("", "_blank");
      if (!reserved) {
        alert(
          "Your browser blocked the WhatsApp tab. Allow pop-ups for this site and try again — " +
          "without it each chat would need a separate click."
        );
        return false;
      }
      windowRef.current = reserved;
    }

    armedRef.current = false;
    setQueue({ list: entries, index: 0, skipped, finished: false });
    openAt(entries, 0);
    return true;
  };

  // Coming back to this window means she is done with the chat that was open.
  // See the note at the top for why this is blur/focus and why there is no
  // dependency array.
  useEffect(() => {
    if (!queue || queue.finished || isDemoMode()) return;

    const onBlur = () => { armedRef.current = true; };
    const onFocus = () => {
      if (!armedRef.current) return;
      armedRef.current = false;
      next();
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  });

  return { queue, start, next, stop };
}
