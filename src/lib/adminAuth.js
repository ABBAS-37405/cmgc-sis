import { supabase } from "./supabaseClient";

export const PERMISSION_KEYS = [
  { id: "students", label: "Students" },
  { id: "attendance", label: "Attendance" },
  { id: "results", label: "Results" },
  { id: "fee", label: "Fee Verification" },
  { id: "notices", label: "Notices" },
];

export const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];

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
