/**
 * B-Form numbers, and making sure one girl gets one record.
 *
 * The number is the only thing that reliably identifies an applicant — names
 * repeat, phone numbers get reused between sisters. `applications.bform` and
 * `students.cnic` (older column, same thing) both hold it.
 *
 * The real guard is the pair of unique indexes in `supabase_bform_unique.sql`;
 * these checks run first only so the applicant is told before she uploads five
 * documents, and so the admin sees who the number already belongs to instead of
 * a raw 23505. Never rely on this alone — two people submitting at the same
 * instant will both pass it, and only the database will catch the second.
 */

import { supabase } from "./supabaseClient";

/** Digits only, so "37407-0651551-0" and "3740706515510" compare equal. */
export function normalizeBForm(value) {
  return String(value || "").replace(/\D/g, "");
}

/** A B-Form is 13 digits, same shape as a CNIC. */
export function isValidBForm(value) {
  return normalizeBForm(value).length === 13;
}

/** 3740706515510 -> 37407-0651551-0 */
export function formatBForm(value) {
  const d = normalizeBForm(value);
  if (d.length !== 13) return String(value || "");
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

// Both spellings are queried because the column is plain text and older rows
// may have been saved either way.
const bothForms = (value) => [formatBForm(value), normalizeBForm(value)];

/**
 * Is this B-Form already on file? Resolves to a message explaining who holds it,
 * or null when it is free.
 *
 * Pass `ignoreStudentId` when editing an existing student, otherwise she clashes
 * with herself.
 */
export async function findBFormClash(bform, { ignoreStudentId, ignoreApplicationId } = {}) {
  const digits = normalizeBForm(bform);
  if (!digits) return null;

  const [formatted, plain] = bothForms(bform);
  const orFilter = `cnic.eq.${formatted},cnic.eq.${plain}`;

  const { data: students } = await supabase
    .from("students")
    .select("id, name, roll_no")
    .is("deleted_at", null)
    .or(orFilter);

  const student = (students || []).find((s) => s.id !== ignoreStudentId);
  if (student) {
    return `This B-Form number is already enrolled — ${student.name} (Roll No ${student.roll_no}). ` +
      "If this is a mistake, correct it from the Students tab.";
  }

  const { data: apps } = await supabase
    .from("applications")
    .select("id, student_name, status")
    .is("deleted_at", null)
    .neq("status", "Rejected")
    .or(`bform.eq.${formatted},bform.eq.${plain}`);

  const app = (apps || []).find((a) => a.id !== ignoreApplicationId);
  if (app) {
    return `An application with this B-Form number has already been submitted — ${app.student_name} ` +
      `(status: ${app.status || "Pending"}). Please contact the college office instead of applying again.`;
  }

  return null;
}

/**
 * Turns the unique-index violation into something readable. Both indexes are
 * named in `supabase_bform_unique.sql`; the roll number has its own from the
 * original schema.
 */
export function describeUniqueViolation(error, fallback) {
  const detail = `${error?.message || ""} ${error?.details || ""}`;
  if (/bform|cnic/i.test(detail)) {
    return "This B-Form number is already on record for another student. Every girl may have only one record.";
  }
  if (/roll_no/i.test(detail)) {
    return "That roll number already belongs to another student. Use a different one.";
  }
  return fallback || error?.message || "That entry already exists.";
}
