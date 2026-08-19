import { supabase } from "./supabaseClient";

// The small Express service in server.js. It holds the two things the browser must
// not — the Supabase service role key and the SMTP/Twilio credentials — so every
// auth user this app creates (sub-admins and teachers alike) is created through it.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// `fetch` rejects with a bare TypeError("Failed to fetch") when the request never
// reaches a server at all, and that message tells an admin nothing: it looks like a
// bug in the form she just filled in rather than a service that is not running.
// It is the single most likely failure here, because server.js has no npm script and
// is started separately from the dev server.
const UNREACHABLE_HINT =
  `Could not reach the college server at ${API_URL}. ` +
  "Logins are created there, not in the browser, so it has to be running: " +
  "start it with `node server.js` (and check VITE_API_URL points at it), then try again. " +
  "Nothing was saved.";

/**
 * POST to an /api/admin/* or /api/teacher/* route with the caller's Supabase access
 * token attached — the server re-verifies it and never trusts a client-supplied role.
 */
export async function callServiceApi(path, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  // Stopped here rather than sent without one. getSession() refreshes an expired
  // token by itself, so no token means the session is genuinely over — and the
  // portal will not have noticed, because every screen on it is React state that
  // keeps rendering long after the session behind it has gone. Sending anyway
  // earns a 403 that reads as "you are not allowed", which is the wrong thing to
  // tell a super admin about a right she has always had.
  if (!accessToken) {
    throw new Error(
      "Your admin session has ended, so nothing was changed. Sign out and sign in again, then retry. " +
      "(The page keeps showing everything for a while after the session behind it expires.)"
    );
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, accessToken }),
    });
  } catch {
    throw new Error(UNREACHABLE_HINT);
  }

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "Request failed");
  return result;
}
