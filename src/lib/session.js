/**
 * Remembering that someone is signed in, across a reload.
 *
 * Navigation in this app is state, not routes: App decides between the website, the
 * admission form and the portal from booleans, and Portal decides between the login
 * page and a portal from more of them. Nothing is in the URL, so pressing refresh
 * threw all of it away and dropped whoever was working back onto the landing page —
 * mid-attendance, mid-fee-entry, mid-anything.
 *
 * What is stored is deliberately thin: the role, the tab, and for a student the id
 * of her row. Never a password, never a whole record, and nothing that could not be
 * read again from the database on the next load.
 *
 * **This file imports nothing**, and that is load-bearing rather than tidy. `App`
 * needs `storedSession()` to decide what to render, and App is the landing bundle;
 * turning what is stored back into a signed-in portal needs the Supabase client and
 * both profile fetchers, so that half lives in `sessionRestore.js` and is imported
 * only from inside the portal. Merging the two costs every first-time visitor
 * several kilobytes to answer a question about a session she has not got.
 *
 * Nothing is stored in the demo: `__DEMO__` folds to false in a real build so this
 * branch disappears, and the demo's auth lives in memory anyway — a remembered
 * admin there would restore to a session that no longer exists and land on the
 * login page, which is worse than the landing page it lands on today.
 */

const SESSION_KEY = "cmgc-session";

function read() {
  if (__DEMO__) return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.role ? parsed : null;
  } catch {
    return null;
  }
}

function write(payload) {
  if (__DEMO__) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // A browser with storage denied simply does not survive a reload. Everything
    // else has to keep working, so this is never allowed to throw.
  }
}

/** Synchronous, so App can decide what to render without flashing the website first. */
export function storedSession() {
  return read();
}

export function rememberSession(role, data) {
  if (!role) return;
  // A student is only restorable if we know which row she is.
  if (role === "student" && !data?.id) return;
  write({ role, studentId: role === "student" ? data.id : undefined });
}

/** The tab she was on, merged into the session already stored. */
export function rememberTab(tab) {
  const current = read();
  if (!current || !tab || current.tab === tab) return;
  write({ ...current, tab });
}

export function clearSession() {
  if (__DEMO__) return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
