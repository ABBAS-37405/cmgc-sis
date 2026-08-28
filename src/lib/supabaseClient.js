import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "../demo/demoClient";

/**
 * The one Supabase client the whole app shares.
 *
 * `__DEMO__` is a build-time literal from vite.config.js — true only under
 * `--mode demo`. In every other build it folds to `false`, this branch
 * disappears, and Rollup drops `src/demo` entirely, so the real site never ships
 * a byte of the seeded college.
 *
 * Neither half of that is theoretical. Run `npm run build` after touching this:
 * the landing bundle must stay at ~423 kB, and `grep demo-banner` over
 * `dist/assets/index-*.js` must find nothing.
 */
/**
 * Where the admin's and teacher's auth session is kept: `sessionStorage`, so signing
 * in lasts as long as the tab and no longer.
 *
 * supabase-js defaults to `localStorage`, which survives the browser being closed —
 * the office computer shut for the night reopened straight into the admin portal,
 * with every girl's record on screen for whoever sat down next. This is the same
 * decision `session.js` makes for its own marker, and the two have to agree: our
 * marker deciding the session is over while a live refresh token stayed behind
 * would be a logout in appearance only.
 *
 * A reload keeps her signed in, because sessionStorage survives it. A new tab does
 * not share it, so the portal opened twice means signing in twice — the accepted
 * cost of the above.
 */
export const supabase = __DEMO__
  ? createDemoClient()
  : createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      auth: { storage: window.sessionStorage },
    });

/*
 * Tokens written by the older localStorage default are unreachable now, but a
 * refresh token left sitting in storage is exactly what the change above exists to
 * prevent — so whatever is there is cleared once, on the first load of this build.
 */
if (!__DEMO__) {
  try {
    Object.keys(localStorage)
      .filter((k) => /^sb-.*-auth-token/.test(k))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore — storage denied does not stop the app from working
  }
}

/**
 * Drops the stored auth session by hand, for when `signOut()` could not.
 *
 * supabase-js removes the session from storage only *after* the server answers
 * `/auth/v1/logout`; a request that hangs or fails therefore leaves a live
 * refresh token behind. Our own marker saying the session is over while that
 * token stays is a logout in appearance only — the exact thing the sessionStorage
 * decision above exists to prevent — so the caller falls back to this.
 */
export function forgetAuthToken() {
  if (__DEMO__) return;
  try {
    Object.keys(sessionStorage)
      .filter((k) => /^sb-.*-auth-token/.test(k))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore — storage denied does not stop the app from working
  }
}
