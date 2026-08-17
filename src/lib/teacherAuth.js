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
