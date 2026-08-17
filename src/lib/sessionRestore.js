import { supabase } from "./supabaseClient";
import { fetchAdminProfile } from "./adminAuth";
import { fetchTeacherProfile } from "./teacherAuth";
import { storedSession, clearSession } from "./session";

/**
 * Turning a remembered session back into a signed-in portal.
 *
 * Split from `session.js` on purpose — see the note there. The storage half is read
 * by `App`, which is the landing bundle; this half reaches the Supabase client and
 * both profile fetchers and is imported only from `Portal`, which is already lazy.
 *
 * The three roles restore by three different routes, because they sign in by three
 * different mechanisms:
 *
 *  - **Admin and teacher** already had the hard half solved. Their login is real
 *    Supabase Auth and supabase-js persists that session itself; what was missing
 *    was the app remembering which screen to put them back on. The stored role only
 *    says which profile table to read — whether they are still signed in at all is
 *    the database's word, not ours, so a session revoked or expired elsewhere
 *    restores to nothing.
 *  - **A student has no auth at all** (her login is a row match against `students`),
 *    so her id is stored and her row re-read. That is the same read her Attendance
 *    and Results tabs already make as `anon`, and it means a password change, a
 *    deletion or an edit is picked up on the next load rather than carried around
 *    in a stale copy.
 *
 * Because there is no auth behind the student half, "still signed in" is exactly as
 * strong as "this browser profile is hers" — the same trade as any other remembered
 * login on a shared machine, and the reason Logout clears the marker rather than
 * only dropping React state.
 */
export async function restoreSession() {
  const stored = storedSession();
  if (!stored) return null;

  if (stored.role === "student") {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("id", stored.studentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) {
      clearSession();
      return null;
    }
    return { role: "student", data, tab: stored.tab };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    clearSession();
    return null;
  }

  if (stored.role === "admin") {
    const profile = await fetchAdminProfile(userId);
    if (!profile) {
      // Signed in, but not an admin any more. Same conclusion the login screen
      // reaches, so end the auth session too rather than leaving it half-open.
      clearSession();
      await supabase.auth.signOut();
      return null;
    }
    return { role: "admin", data: profile, tab: stored.tab };
  }

  if (stored.role === "teacher") {
    const teacher = await fetchTeacherProfile(userId);
    if (!teacher || teacher.is_active === false) {
      clearSession();
      await supabase.auth.signOut();
      return null;
    }
    return { role: "teacher", data: teacher, tab: stored.tab };
  }

  clearSession();
  return null;
}
