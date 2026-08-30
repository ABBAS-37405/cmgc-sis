/**
 * One student's whole record, in one place.
 *
 * The Reports tab answers "how did this class do in August" and hands the answer
 * to a parent as a PDF. This answers a different question the office asks daily:
 * a girl is standing at the counter, or her father is on the phone — how is she
 * doing, since admission, across everything the college records?
 *
 * So the shape is deliberately the mirror image of monthlyReport.js: that one
 * takes a whole roster for one month, this one takes one student for her whole
 * career. The arithmetic is not rewritten — the four summarisers are imported
 * from there, because "how a fee's paid amount is derived" and "an absent girl
 * is not a zero" must have exactly one definition each.
 *
 * The same performance rule applies: six queries for a student with four terms
 * of history, no query inside a `.map()`.
 */

import { supabase } from "./supabaseClient";
import { examTypeOf } from "./exams";
import { splitOwnSubjects } from "./studentSubjects";
import {
  summariseAttendance,
  summariseTests,
  summariseAssignments,
  summariseFee,
} from "./monthlyReport";

const pct = (obtained, total) => (total > 0 ? (obtained / total) * 100 : null);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** "2026-08" -> "August 2026", built from numbers so no string is ever parsed as UTC. */
export function monthLabel(key) {
  const [y, m] = String(key).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

/**
 * A section the signed-in admin is not allowed to read.
 *
 * This is not cosmetic. RLS refuses a *read* as silently as it refuses a write —
 * `attendance` and `results` are only readable by an admin who holds the matching
 * permission (SUPABASE_ADMIN_ROLES.md, "Program-scoped write policies", which are
 * `for all` and therefore govern select too). Running the query anyway would hand
 * back zero rows, and zero rows rendered as "0% attendance" is a lie about a girl
 * who was in class every day. So the query is skipped and the section says why.
 */
const UNAVAILABLE = (permission) => ({ unavailable: permission });

/**
 * Everything on record for one student.
 *
 * `can` is the permission test — pass `(key) => hasPermission(profile, key)`. It
 * decides which of the two gated tables is fetched at all; the rest (class tests,
 * assignments, fees) are readable by any signed-in admin under their own policies.
 */
export async function buildStudentProgress(student, can = () => true) {
  const id = student.id;
  const year = student.year_of_study || "1st Year";

  const mayReadAttendance = can("attendance");
  const mayReadResults = can("results");

  const [attendanceRes, testRes, assignmentRes, resultRes, feeRes] = await Promise.all([
    mayReadAttendance
      ? supabase.from("attendance").select("date, status").eq("student_id", id)
      : Promise.resolve({ data: [], error: null }),

    // !inner is what lets a mark row carry its test's date and subject —
    // class_test_marks has neither of its own.
    supabase
      .from("class_test_marks")
      .select("marks_obtained, is_absent, remarks, class_tests!inner(id, subject, title, test_date, total_marks)")
      .eq("student_id", id),

    supabase
      .from("assignments")
      .select("id, subject, title, total_marks, due_date, programs, year_of_study")
      .overlaps("programs", [student.program])
      .eq("year_of_study", year),

    mayReadResults
      ? supabase
          .from("results")
          .select("exam_name, subject, marks_obtained, total_marks, created_at")
          .eq("student_id", id)
      : Promise.resolve({ data: [], error: null }),

    supabase
      .from("fees")
      .select(
        "id, label, amount_due, due_date, status, sort_order, " +
        "payment_transactions(amount, status, payment_method, reference_number, recorded_by, created_at)"
      )
      .eq("student_id", id),
  ]);

  // Submissions need the assignment ids, so this one waits for the query above.
  const assignments = assignmentRes.data || [];
  let submissions = [];
  if (assignments.length > 0) {
    const { data } = await supabase
      .from("assignment_submissions")
      .select("assignment_id, student_id, file_url, submitted_at, submitted_in_class, marks_obtained")
      .in("assignment_id", assignments.map((a) => a.id))
      .eq("student_id", id);
    submissions = data || [];
  }

  // A read the database refuses comes back as an error here, not as silence —
  // these are plain selects, not RLS-filtered writes — so surface it rather than
  // showing an empty record as though there were nothing to show.
  const firstError = [testRes, assignmentRes, feeRes, attendanceRes, resultRes].find((r) => r.error);
  if (firstError) throw new Error(firstError.error.message);

  const attendanceRows = attendanceRes.data || [];
  const feeRows = feeRes.data || [];

  // Her own subjects only, in all three places a subject appears. A mark can
  // carry a subject she does not sit — one entered against her before the entry
  // sheets were filtered by combination — and the assignments query is per group,
  // which is not per combination. `dropped` is collected so the *admin's* Student
  // Report can name what is being left out; her own Performance tab shows only
  // the record, because a subject she does not study is not hers to correct.
  const testRows = splitOwnSubjects(student, testRes.data || [], (r) => r.class_tests?.subject);
  const examRows = splitOwnSubjects(student, resultRes.data || []);
  const assignmentRows = splitOwnSubjects(student, assignments);
  const outside = [...new Set([...testRows.dropped, ...examRows.dropped, ...assignmentRows.dropped])].sort();

  return {
    student,
    attendance: mayReadAttendance
      ? { ...summariseAttendance(attendanceRows), byMonth: attendanceByMonth(attendanceRows) }
      : UNAVAILABLE("Attendance"),
    tests: summariseTests(testRows.kept),
    exams: mayReadResults
      ? { list: summariseExams(examRows.kept) }
      : UNAVAILABLE("Results"),
    assignments: summariseAssignments(student, assignmentRows.kept, submissions),
    fee: { ...summariseFee(feeRows), payments: paymentsOf(feeRows) },
    outside,
  };
}

/**
 * Month by month, newest first.
 *
 * The month comes from slicing the stored string, never from `new Date(row.date)`:
 * `attendance.date` is a plain `date`, and parsing it as UTC midnight would move
 * every attendance mark from the 1st into the month before — the same trap
 * `monthKeyOf` avoids in accounts.js.
 */
function attendanceByMonth(rows) {
  const byMonth = new Map();
  rows.forEach((r) => {
    if (!r.date) return;
    const key = String(r.date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(r);
  });

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, monthRows]) => ({
      month,
      label: monthLabel(month),
      ...summariseAttendance(monthRows),
    }));
}

/**
 * One entry per sitting, newest first.
 *
 * `results` has no exam date, so "newest" means most recently entered — the same
 * compromise monthlyReport.js documents. Rows are grouped by `exam_name` because
 * that string is the only thing identifying a sitting.
 */
function summariseExams(rows) {
  const byExam = new Map();
  rows.forEach((r) => {
    if (!r.exam_name) return;
    if (!byExam.has(r.exam_name)) byExam.set(r.exam_name, []);
    byExam.get(r.exam_name).push(r);
  });

  return [...byExam.entries()]
    .map(([examName, subjectRows]) => {
      const subjects = subjectRows
        .map((r) => ({
          subject: r.subject,
          obtained: num(r.marks_obtained) || 0,
          total: num(r.total_marks) || 0,
        }))
        .sort((a, b) => a.subject.localeCompare(b.subject));

      const obtained = subjects.reduce((a, s) => a + s.obtained, 0);
      const total = subjects.reduce((a, s) => a + s.total, 0);
      const enteredAt = subjectRows.reduce(
        (a, r) => (new Date(r.created_at) > new Date(a) ? r.created_at : a),
        subjectRows[0].created_at
      );

      return { examName, type: examTypeOf(examName), enteredAt, subjects, obtained, total, percent: pct(obtained, total) };
    })
    .sort((a, b) => new Date(b.enteredAt) - new Date(a.enteredAt));
}

/**
 * Every payment she has made, newest first.
 *
 * Flattened out of the embedded transactions rather than fetched again, and
 * `created_at` is the date the office chose when recording a cash payment (see
 * FeeVerification), so it is the payment date, not a write timestamp.
 */
function paymentsOf(fees) {
  return fees
    .flatMap((f) =>
      (f.payment_transactions || []).map((t) => ({
        label: f.label || "Fee",
        amount: num(t.amount) || 0,
        status: t.status || "Pending Verification",
        method: t.payment_method || "—",
        reference: t.reference_number || "",
        // 'admin' means cash taken at the office with no proof attached;
        // 'student' means she uploaded a receipt and an admin approved it.
        recordedBy: t.recorded_by || null,
        at: t.created_at,
      }))
    )
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}
