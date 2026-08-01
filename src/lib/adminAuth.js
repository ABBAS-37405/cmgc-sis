import { supabase } from "./supabaseClient";

export const PERMISSION_KEYS = [
  { id: "students", label: "Students" },
  { id: "attendance", label: "Attendance" },
  { id: "results", label: "Results" },
  { id: "fee", label: "Fee Verification" },
  { id: "notices", label: "Notices" },
  { id: "lms", label: "Course Material (LMS)" },
  { id: "teachers", label: "Teachers" },
  { id: "reports", label: "Monthly Reports" },
];

// Re-exported so every existing `import { PROGRAMS } from "adminAuth"` keeps
// working, but the list itself is derived from the group definitions in
// academics.js — adding a group there adds it everywhere, with no second list to
// forget. These strings must match the DB and the RLS policies exactly.
export { PROGRAMS } from "./academics";

/**
 * An update or delete the RLS policies refuse does NOT come back as an error —
 * PostgREST reports a plain success that simply affected zero rows. Any write
 * that matters must therefore ask for the changed rows back (`.select(...)`) and
 * treat an empty result as a failure, or the UI will cheerfully report "saved"
 * while the database ignored the whole thing.
 *
 * In practice this means one of two things: the admin's Supabase session has
 * expired (so the request went out as an anonymous visitor), or a sub-admin is
 * touching a student outside her allowed programs.
 */
export const WRITE_BLOCKED_HINT =
  "Nothing was saved — the database refused the change. Your admin session has most likely expired: " +
  "sign out, sign in again, and try once more. (Sub-admins can only change records in the programs assigned to them.)";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function fetchAdminProfile(userId) {
  const { data, error } = await supabase
    .from("admin_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data;
}

export function hasPermission(profile, key) {
  if (!profile) return false;
  if (profile.is_super_admin) return true;
  return Array.isArray(profile.permissions) && profile.permissions.includes(key);
}

export function allowedProgramsFor(profile) {
  if (!profile || profile.is_super_admin) return [];
  return Array.isArray(profile.allowed_programs) ? profile.allowed_programs : [];
}

async function callAdminApi(path, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, accessToken }),
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "Request failed");
  return result;
}

export function createSubAdmin({ email, password, name, permissions, allowedPrograms }) {
  return callAdminApi("/api/admin/create", { email, password, name, permissions, allowedPrograms });
}

export function deleteSubAdmin(targetUserId) {
  return callAdminApi("/api/admin/delete", { targetUserId });
}
