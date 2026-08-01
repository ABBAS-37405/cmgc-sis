/**
 * "My Form" — the student's own admission record, and the request/approve cycle
 * that lets her correct it.
 *
 * She may look at everything but change nothing until an admin approves a
 * request. Approval opens a window (`approved_until`); while it is open she can
 * edit the fields listed here and save as often as she needs.
 *
 * STUDENT_EDITABLE must stay in step with the column-level GRANT in
 * `supabase_profile_edit_requests.sql`. That grant is the real limit — anything
 * added here without adding it there will simply fail to save.
 */

import { supabase } from "./supabaseClient";

/** How long an approval stays usable. Long enough to finish, short enough to close. */
export const EDIT_WINDOW_HOURS = 48;

/**
 * The fields a student may correct herself. Grouped the way the admission form
 * grouped them so the screen reads like the form she filled in.
 */
export const STUDENT_EDITABLE = [
  {
    title: "Contact",
    fields: [
      { key: "phone", label: "Phone", placeholder: "03XXXXXXXXX" },
      { key: "phone2", label: "Alternate Phone", placeholder: "03XXXXXXXXX" },
      { key: "whatsapp", label: "WhatsApp No.", placeholder: "03XXXXXXXXX" },
      { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Postal Address", type: "textarea", wide: true },
    ],
  },
  {
    title: "Personal",
    fields: [
      { key: "dob", label: "Date of Birth", type: "date" },
      { key: "nationality", label: "Nationality" },
      { key: "religion", label: "Religion" },
    ],
  },
  {
    title: "Family",
    fields: [
      { key: "father_name", label: "Father's Name" },
      { key: "father_cnic", label: "Father's NIC", placeholder: "12345-1234567-1" },
      { key: "father_occupation", label: "Father's Occupation" },
      { key: "monthly_income", label: "Monthly Income (Rs)", type: "number" },
      { key: "family_members", label: "Family Members", type: "number" },
      { key: "orphan", label: "Orphan", type: "boolean" },
      { key: "financial_assistance", label: "Needs Financial Assistance", type: "boolean" },
    ],
  },
];

/** Everything she can see but not touch — shown read-only, always. */
export const STUDENT_READONLY = [
  { key: "roll_no", label: "Roll Number" },
  { key: "name", label: "Student Name" },
  { key: "cnic", label: "B-Form No." },
  { key: "program", label: "Group" },
  { key: "year_of_study", label: "Class" },
  { key: "subject_combination", label: "Subject Combination" },
  { key: "board", label: "Board" },
  { key: "ssc_roll_no", label: "SSC Roll No." },
  { key: "ssc_registration_no", label: "SSC Registration No." },
  { key: "matric_marks_obtained", label: "Matric Marks Obtained" },
  { key: "matric_total_marks", label: "Matric Total Marks" },
  { key: "matric_percentage", label: "Matric %" },
];

const EDITABLE_KEYS = STUDENT_EDITABLE.flatMap((g) => g.fields.map((f) => f.key));

/** Only the granted columns, so a stray key can never reach the update. */
export function editableRowFrom(values) {
  const row = {};
  for (const group of STUDENT_EDITABLE) {
    for (const field of group.fields) {
      const raw = values[field.key];
      if (field.type === "boolean") row[field.key] = raw === true;
      else if (field.type === "number") row[field.key] = raw === "" || raw == null ? null : Number(raw);
      else row[field.key] = String(raw ?? "").trim() || null;
    }
  }
  return row;
}

export function editableValuesFrom(student) {
  const values = {};
  for (const key of EDITABLE_KEYS) {
    const raw = student?.[key];
    values[key] = raw === null || raw === undefined ? "" : raw;
  }
  return values;
}

/** Her most recent request, whatever its state — null if she has never asked. */
export async function fetchLatestRequest(studentId) {
  if (!studentId) return null;
  const { data } = await supabase
    .from("profile_edit_requests")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data && data[0]) || null;
}

/** True while the database would actually accept her edits. */
export function windowIsOpen(request) {
  if (!request || request.status !== "Approved" || !request.approved_until) return false;
  return new Date(request.approved_until).getTime() > Date.now();
}

export async function submitRequest(studentId, reason) {
  const { error } = await supabase
    .from("profile_edit_requests")
    .insert({ student_id: studentId, reason: reason.trim(), status: "Pending" });

  // The partial unique index allows one Pending row per student.
  if (error?.code === "23505") {
    return "You already have a request waiting for the admin. Please wait for it to be answered.";
  }
  return error ? error.message : null;
}

/** Admin side. Approving stamps the deadline the student policy checks against. */
export async function reviewRequest(request, decision, note) {
  const approvedUntil = decision === "Approved"
    ? new Date(Date.now() + EDIT_WINDOW_HOURS * 3600 * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("profile_edit_requests")
    .update({
      status: decision,
      admin_note: note?.trim() || null,
      approved_until: approvedUntil,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .select("id");

  if (error) return error.message;
  // An RLS-blocked update reports success with zero rows — see WRITE_BLOCKED_HINT.
  if (!data || data.length === 0) return "BLOCKED";
  return null;
}
