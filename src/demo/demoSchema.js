/**
 * What the demo client needs to know about the real schema.
 *
 * Only two things matter to it: which tables exist, and how an embedded select
 * joins. Columns are deliberately not listed — the demo client returns whole
 * rows rather than projecting to the selected column list, because a superset
 * never breaks a screen while a mis-parsed projection silently empties one.
 *
 * The relations below were read off the live database's PostgREST schema, so
 * they are the real foreign keys, not a guess. Adding a table here is only
 * necessary if a query embeds it.
 */

export const PRIMARY_KEY = "id";

/** Every table the app touches. Order is only for the reset log. */
export const TABLES = [
  "students",
  "teachers",
  "admin_profiles",
  "applications",
  "attendance",
  "results",
  "class_tests",
  "class_test_marks",
  "assignments",
  "assignment_submissions",
  "fees",
  "payment_transactions",
  "notices",
  "lms_materials",
  "profile_edit_requests",
  "fee_plans",
  "report_log",
  "staff",
  "staff_attendance",
  "college_holidays",
  "staff_salaries",
];

/**
 * parent table → embed name → how to resolve it.
 *
 *   kind "one"   the parent holds the key; the embed is an object (or null)
 *   kind "many"  the child holds the key; the embed is an array
 *
 * `!inner` is not recorded here — it is read off the query, because the same
 * relation is embedded both ways in different screens.
 */
export const RELATIONS = {
  class_test_marks: {
    class_tests: { kind: "one", table: "class_tests", localKey: "class_test_id", foreignKey: "id" },
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
  },
  class_tests: {
    teachers: { kind: "one", table: "teachers", localKey: "teacher_id", foreignKey: "id" },
    class_test_marks: { kind: "many", table: "class_test_marks", localKey: "id", foreignKey: "class_test_id" },
  },
  fees: {
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
    payment_transactions: { kind: "many", table: "payment_transactions", localKey: "id", foreignKey: "fee_id" },
  },
  payment_transactions: {
    fees: { kind: "one", table: "fees", localKey: "fee_id", foreignKey: "id" },
  },
  profile_edit_requests: {
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
  },
  attendance: {
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
  },
  results: {
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
  },
  assignment_submissions: {
    assignments: { kind: "one", table: "assignments", localKey: "assignment_id", foreignKey: "id" },
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
  },
  assignments: {
    teachers: { kind: "one", table: "teachers", localKey: "teacher_id", foreignKey: "id" },
    assignment_submissions: { kind: "many", table: "assignment_submissions", localKey: "id", foreignKey: "assignment_id" },
  },
  lms_materials: {
    teachers: { kind: "one", table: "teachers", localKey: "teacher_id", foreignKey: "id" },
  },
  report_log: {
    students: { kind: "one", table: "students", localKey: "student_id", foreignKey: "id" },
  },
  // Both carry teacher_id AND staff_id, exactly one of them set per row. Only
  // the teacher side is embeddable here because that is the only one any query
  // embeds; the payroll screen joins nothing, it merges the two rosters in JS.
  staff_attendance: {
    teachers: { kind: "one", table: "teachers", localKey: "teacher_id", foreignKey: "id" },
    staff: { kind: "one", table: "staff", localKey: "staff_id", foreignKey: "id" },
  },
  staff_salaries: {
    teachers: { kind: "one", table: "teachers", localKey: "teacher_id", foreignKey: "id" },
    staff: { kind: "one", table: "staff", localKey: "staff_id", foreignKey: "id" },
  },
};

/** Columns stamped with the current time on insert, per table. */
export const TIMESTAMP_DEFAULTS = {
  students: ["created_at"],
  teachers: ["created_at"],
  admin_profiles: ["created_at"],
  applications: ["created_at"],
  attendance: ["created_at"],
  results: ["created_at"],
  class_tests: ["created_at"],
  class_test_marks: ["created_at"],
  assignments: ["created_at"],
  assignment_submissions: ["created_at"],
  fees: ["created_at"],
  payment_transactions: ["created_at"],
  notices: ["created_at"],
  lms_materials: ["created_at"],
  profile_edit_requests: ["created_at"],
  report_log: ["created_at"],
  staff: ["created_at"],
  staff_attendance: ["created_at"],
  college_holidays: ["created_at"],
  staff_salaries: ["created_at"],
};
