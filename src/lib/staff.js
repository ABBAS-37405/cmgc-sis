/**
 * Non-teaching staff — accounts, office, security, maintenance, transport.
 *
 * These people are deliberately **not** rows in `teachers`. A peon has no
 * subjects, no programs, no portal rights and no login, and putting him there
 * would drop him into every teacher dropdown in the app — class tests, LMS,
 * assignments, the class-test report. The two rosters are separate tables that
 * happen to share one payroll.
 *
 * `designation` is free text with these as suggestions, because every college
 * invents a job title sooner or later and a fixed list would be the first thing
 * to need a migration. `department` is the fixed part: it is what the salary
 * sheet groups and subtotals by, so it has to come from a known set.
 */

export const STAFF_DEPARTMENTS = [
  "Administration",
  "Accounts",
  "Academic Support",
  "Security",
  "Maintenance",
  "Transport",
];

/** Suggested titles, each with the department it normally belongs to. */
export const STAFF_DESIGNATIONS = [
  { title: "Admin Officer", department: "Administration" },
  { title: "Office Clerk", department: "Administration" },
  { title: "Receptionist", department: "Administration" },
  { title: "Data Entry Operator", department: "Administration" },
  { title: "Accountant", department: "Accounts" },
  { title: "Accounts Assistant", department: "Accounts" },
  { title: "Fee Clerk", department: "Accounts" },
  { title: "Librarian", department: "Academic Support" },
  { title: "Lab Assistant", department: "Academic Support" },
  { title: "IT Support", department: "Academic Support" },
  { title: "Security Guard", department: "Security" },
  { title: "Gatekeeper (Chowkidar)", department: "Security" },
  { title: "Peon (Naib Qasid)", department: "Maintenance" },
  { title: "Sweeper", department: "Maintenance" },
  { title: "Gardener (Mali)", department: "Maintenance" },
  { title: "Cook", department: "Maintenance" },
  { title: "Driver", department: "Transport" },
];

/** The department a suggested title belongs to, or "" for a title typed by hand. */
export function departmentFor(title) {
  const match = STAFF_DESIGNATIONS.find(
    (d) => d.title.toLowerCase() === String(title || "").trim().toLowerCase()
  );
  return match ? match.department : "";
}

/** What to call this person on a salary slip or in a roster. */
export function roleLabelFor(person) {
  if (!person) return "";
  if (person.kind === "staff") return person.designation || "Staff";
  return person.designation || "Teacher";
}
