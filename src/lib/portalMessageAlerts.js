/**
 * Which of the office's messages this viewer still has to see.
 *
 * The deciding half of the portal-message feature, kept apart from the half that
 * talks to Supabase for the same reason `lmsAlerts.js` is kept apart from
 * `lms.js`: what counts as unread involves a date window and a set difference,
 * which is exactly the arithmetic that quietly goes wrong, and this repo has no
 * test runner. **This file imports nothing**, so all of it can be driven from
 * plain Node against fixtures.
 *
 * There is no read-receipt table and there cannot be a useful one — a student
 * has no auth account, so a row saying "this girl has read it" could be written
 * by anybody and scoped by RLS to nobody. So "read" is a list of ids per viewer
 * in `localStorage`, with the same honest cost as the LMS alert: her mother's
 * phone has its own idea of what she has read.
 */

/**
 * How long a message keeps opening itself.
 *
 * Without a cap, a girl opening her portal on a new phone in March is met with a
 * stack of dialogs about a fee deadline in September — her browser has never
 * seen them, so to it they are all unread. Thirty days is long enough that
 * nobody misses a current message, short enough that nothing stale ambushes her,
 * and the admin's list says out loud when a message has passed it, so one that
 * has stopped opening never looks like one that is still working.
 */
export const SHOW_FOR_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Past the window it is still in the admin's list, but it opens for nobody. */
export function isStillShowing(message, now = Date.now()) {
  const at = new Date(message?.created_at || 0).getTime();
  if (Number.isNaN(at) || at === 0) return false;
  return now - at <= SHOW_FOR_DAYS * DAY_MS;
}

/**
 * What this viewer has not read, **oldest first** — a run of them is then read
 * in the order the office sent them rather than backwards off a stack.
 */
export function unreadFor(messages, seenIds, now = Date.now()) {
  const seen = new Set(seenIds || []);
  return (messages || [])
    .filter((m) => m?.id && !seen.has(m.id) && isStillShowing(m, now))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

// --------------------------------------------------------------------------
// What has been read, per viewer, in this browser. Guarded rather than assumed:
// a browser with storage disabled should lose the memory, never the portal —
// and failing that way round means the message opens again, which is the
// harmless direction.
// --------------------------------------------------------------------------

const SEEN_KEY = "cmgc-portal-messages-seen";

const readAll = () => {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

export function readSeenIds(viewerId) {
  if (!viewerId || typeof window === "undefined") return [];
  const list = readAll()[viewerId];
  return Array.isArray(list) ? list : [];
}

/**
 * Marks one read, and forgets the ids of messages that no longer exist.
 *
 * `liveIds` is whatever the last fetch returned. Without that prune this key
 * grows for the life of the browser profile, holding the ids of messages the
 * office deleted a year ago. Keyed by viewer, because a shared family phone
 * signs two sisters in and one reading a message must not mark it read for the
 * other.
 */
export function writeSeenId(viewerId, messageId, liveIds) {
  if (!viewerId || !messageId || typeof window === "undefined") return;
  const live = liveIds ? new Set(liveIds) : null;
  const kept = readSeenIds(viewerId).filter((id) => !live || live.has(id));

  try {
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({ ...readAll(), [viewerId]: [...new Set([...kept, messageId])] })
    );
  } catch {
    // Full, or disabled. The message simply opens again next time.
  }
}
