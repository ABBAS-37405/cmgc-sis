import { supabase } from "./supabaseClient";
import { subjectsForPrograms } from "./academics";
import { PROGRAMS } from "./adminAuth";
import { callServiceApi } from "./serviceApi";

// Duties an admin can hand to a teacher. Same shape as adminAuth.PERMISSION_KEYS.
export const TEACHER_RIGHTS = [
  { id: "class_tests", label: "Enter Class Tests" },
  { id: "lms", label: "Publish Course Material (LMS)" },
  { id: "assignments", label: "Set & Grade Assignments" },
  { id: "view_students", label: "View Student Roster" },
  { id: "attendance", label: "Mark Attendance" },
  { id: "results", label: "Enter Term Results" },
];

export function hasTeacherRight(teacher, key) {
  if (!teacher) return false;
  return Array.isArray(teacher.rights) && teacher.rights.includes(key);
}

// Empty array = unrestricted, matching the admin_profiles.allowed_programs convention.
export function teacherPrograms(teacher) {
  const list = teacher?.programs;
  return Array.isArray(list) && list.length > 0 ? list.filter((p) => PROGRAMS.includes(p)) : [];
}

export function teacherSubjects(teacher) {
  const list = teacher?.subjects;
  return Array.isArray(list) && list.length > 0 ? list : [];
}

// Subjects this teacher may enter tests for across the given programs: the intersection
// of what she teaches and what those programs actually offer. Pass several programs for
// a combined "All Programs" test — the result is the union of their subjects, still
// narrowed to the ones she teaches. A year narrows it to that class's compulsory list.
export function teacherSubjectsFor(teacher, programs, year) {
  const offered = subjectsForPrograms(programs, year);
  const taught = teacherSubjects(teacher);
  if (taught.length === 0) return offered;
  return offered.filter((s) => taught.includes(s));
}

// Loads the teachers row behind a signed-in auth user. Mirrors fetchAdminProfile():
// no row = this login is not a teacher.
export async function fetchTeacherProfile(userId) {
  const { data, error } = await supabase
    .from("teachers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

// Same helper the sub-admin routes use — both sides create Supabase Auth users through
// server.js, and both fail the same way when it is not running.
const callTeacherApi = callServiceApi;

// `teacherId` attaches a login to a teacher record that already exists; omit it to
// create the login and the record together. The pay fields travel with it because
// this route, not the browser, is what writes the row in that case.
export function createTeacherLogin({
  teacherId, email, password, name, qualification, phone, subjects, programs, rights,
  employment_type, monthly_salary, per_day_salary, joining_date, whatsapp,
}) {
  return callTeacherApi("/api/teacher/create", {
    teacherId, email, password, name, qualification, phone, subjects, programs, rights,
    employment_type, monthly_salary, per_day_salary, joining_date, whatsapp,
  });
}

export function resetTeacherPassword(teacherId, password) {
  return callTeacherApi("/api/teacher/password", { teacherId, password });
}

export function deleteTeacher(teacherId) {
  return callTeacherApi("/api/teacher/delete", { teacherId });
}

/**
 * Every teacher password the college has on record, as
 * `{ ready, passwords: { [teacherId]: password } }`.
 *
 * There is no way to recover a Supabase Auth password, so this reads the vault
 * table that server.js fills in each time one is set — see
 * supabase_teacher_password_vault.sql. A login created before that migration ran has
 * no row here at all, which is why callers must show "not recorded" rather than a
 * blank: an empty box reads as a password of nothing.
 *
 * `ready` is the part worth having. "No rows" and "no table" look identical from a
 * map of passwords, and they are not the same thing at all: the first means nothing
 * has been set yet and Reset Password will record one, the second means the
 * migration has not been run and Reset Password will record nothing. Telling the
 * admin to reset a password to make it appear, when it cannot appear, is the kind
 * of wrong instruction she follows twice before doubting it.
 *
 * Never raises. Only a super admin's select policy matches, and **RLS refuses a
 * read as silently as it refuses a write** — anyone else gets zero rows and no
 * error at all, so a refusal reads as `ready` with nothing in it, which is exactly
 * right for someone who is not meant to see any of this.
 */
export async function fetchTeacherPasswords() {
  const { data, error } = await supabase
    .from("teacher_login_passwords")
    .select("teacher_id, password");

  // 42P01 is "relation does not exist" — the migration has not been run. Anything
  // else that errors is equally unusable, so both land on ready: false.
  if (error || !data) return { ready: false, passwords: {} };

  const passwords = {};
  data.forEach((row) => { passwords[row.teacher_id] = row.password; });
  return { ready: true, passwords };
}
