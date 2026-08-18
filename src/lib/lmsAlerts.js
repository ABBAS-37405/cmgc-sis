/**
 * "Your teacher has put something new up" — worked out, not stored.
 *
 * There is deliberately **no notifications table**. A student has no Supabase
 * Auth account, so a per-girl notification row could not be written by her or
 * scoped to her by RLS; and `notices` cannot carry this either, because it has no
 * audience column on purpose — a notice goes to the whole college, and material
 * for 2nd year Pre-Medical does not.
 *
 * What already exists is enough. `fetchMaterialsForStudent` returns exactly the
 * material that is hers — her group, her year — so "new" is just that list
 * filtered against the last time she looked. One timestamp per student in
 * localStorage, and nothing added to the database at all.
 *
 * The cost, stated plainly: "last looked" is per browser. Opening her portal on
 * her mother's phone for the first time shows nothing as new rather than showing
 * everything — see `firstVisitSeenAt` for why that is the right way round.
 *
 * This file **imports nothing**, so the decision of what counts as new can be
 * driven from plain Node. The storage helpers guard their own access, so they
 * are safe to call where there is no `window`.
 */

const SEEN_KEY = "cmgc-lms-seen";

/** How many are named in the sentence before it falls back to "and N more". */
export const NAMED_IN_SUMMARY = 2;

/**
 * The material she has not seen, newest first.
 *
 * `lastSeen` null means this browser has never opened her portal, which is not
 * the same as "she has seen nothing" — see `firstVisitSeenAt`.
 */
export function newMaterialsSince(materials, lastSeen) {
  if (!lastSeen) return [];
  const cutoff = new Date(lastSeen).getTime();
  if (Number.isNaN(cutoff)) return [];

  return (materials || [])
    .filter((m) => {
      const at = new Date(m?.created_at || 0).getTime();
      return !Number.isNaN(at) && at > cutoff;
    })
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

/**
 * What to stamp when a browser opens her portal for the very first time: now.
 *
 * The alternative is to treat everything ever published as unread, which on a
 * new phone means announcing forty items she has already worked through. A
 * notice that is wrong the first time it appears is one nobody reads the second
 * time, so the first visit deliberately announces nothing and everything from
 * that moment on is genuinely new.
 */
export const firstVisitSeenAt = (now = Date.now()) => new Date(now).toISOString();

/**
 * The short sentence itself: what went up, in her own vocabulary.
 *
 * Names the subject and the title, because "3 new items" tells her nothing about
 * whether to bother looking. Falls back to a count once the list is longer than
 * a sentence can carry.
 */
export function summariseNewMaterial(items) {
  const list = items || [];
  if (list.length === 0) return "";

  const named = list
    .slice(0, NAMED_IN_SUMMARY)
    .map((m) => [m.subject, m.title].filter(Boolean).join(" — "))
    .filter(Boolean);

  const rest = list.length - named.length;
  if (named.length === 0) return `${list.length} new ${list.length === 1 ? "item" : "items"}`;
  if (rest <= 0) return named.join(", ");
  return `${named.join(", ")} and ${rest} more`;
}

// --------------------------------------------------------------------------
// Storage. Guarded rather than assumed: a browser with storage disabled should
// lose the alert, never the portal.
// --------------------------------------------------------------------------

const readAll = () => {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

/** When this browser last showed her the LMS, or null if it never has. */
export function readLmsSeen(studentId) {
  if (!studentId || typeof window === "undefined") return null;
  return readAll()[studentId] || null;
}

export function writeLmsSeen(studentId, at = new Date().toISOString()) {
  if (!studentId || typeof window === "undefined") return;
  try {
    // Keyed by student id, because a shared family phone signs two sisters in
    // and one opening her LMS must not mark the other's material as read.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readAll(), [studentId]: at }));
  } catch {
    // Full, or disabled. The alert simply keeps showing, which is the harmless
    // direction to fail in.
  }
}
