/**
 * How a class did, rather than how one girl did.
 *
 * studentProgress.js runs down a single student; this runs across the tests
 * themselves — every class test in scope, what the class averaged in it, which
 * subjects are carrying and which are not, and how the marks are spread across
 * the board's grade bands.
 *
 * It serves two screens with one shape: a teacher sees the tests she conducted,
 * an admin sees every test in the groups she administers plus a breakdown by
 * teacher. Passing a `teacherId` is the only difference between them.
 *
 * Three rules this file will not bend:
 *
 * - **An absent girl is not a zero.** She is counted in `absent` and left out of
 *   every average, exactly as testReport.js does it. Averaging her in as nothing
 *   would drag a class average down by however many girls had flu that week.
 * - **It counts marks, never a roster.** Nothing here says "30 students": it says
 *   "30 marks recorded". Whoever was never marked is not in this data at all, and
 *   quietly turning her absence from the register into a fact about the class is
 *   the same lie in a different place.
 * - **No query inside a map.** Two queries for a term of tests, plus one for the
 *   teacher names, however many tests there are.
 */

import { supabase } from "./supabaseClient";
import { gradeFor, PASS_PERCENT } from "./testReport";

/** The board's bands, in the order a result sheet prints them. */
export const GRADE_ORDER = ["A+", "A", "B", "C", "D", "E", "F"];

export const PERIODS = [
  { id: "3", label: "Last 3 months", months: 3 },
  { id: "6", label: "Last 6 months", months: 6 },
  { id: "12", label: "Last 12 months", months: 12 },
  { id: "all", label: "Everything on record", months: null },
];

/** The first day, `months` back, as a plain YYYY-MM-DD — never a parsed string. */
export function periodStart(months) {
  if (!months) return null;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const pct = (obtained, total) => (total > 0 ? (obtained / total) * 100 : null);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * Everything both performance screens need, for one scope.
 *
 * `programs` is the scope in force (a sub-admin's allowed groups, or a teacher's
 * assigned ones); empty means unrestricted, the same convention as everywhere
 * else. `teacherId` narrows to one teacher's own tests.
 */
export async function buildClassPerformance({
  programs = [], teacherId = null, program = null, year = null, months = 6,
} = {}) {
  let query = supabase
    .from("class_tests")
    .select("id, subject, title, test_date, total_marks, program, programs, year_of_study, teacher_id")
    .order("test_date", { ascending: true });

  const scope = program ? [program] : programs;
  if (scope.length > 0) query = query.overlaps("programs", scope);
  if (year) query = query.eq("year_of_study", year);
  if (teacherId) query = query.eq("teacher_id", teacherId);

  const from = periodStart(months);
  if (from) query = query.gte("test_date", from);

  const { data: tests, error } = await query;
  if (error) throw new Error(error.message);
  if (!tests || tests.length === 0) return emptyResult();

  const { data: marks, error: marksError } = await supabase
    .from("class_test_marks")
    .select("class_test_id, student_id, marks_obtained, is_absent")
    .in("class_test_id", tests.map((t) => t.id));
  if (marksError) throw new Error(marksError.message);

  // Names for the by-teacher breakdown. One query for the lot; a test whose
  // teacher_id is null is real (an admin entered it) and gets its own bucket.
  //
  // Skipped entirely when the caller asked for one teacher: the breakdown would
  // be a single bar, and `teachers_select` only returns a teacher her own row —
  // so from her portal the query could not answer it anyway.
  const teacherIds = teacherId ? [] : [...new Set(tests.map((t) => t.teacher_id).filter(Boolean))];
  const teacherNames = {};
  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase.from("teachers").select("id, name").in("id", teacherIds);
    (teachers || []).forEach((t) => { teacherNames[t.id] = t.name; });
  }

  const marksByTest = new Map();
  (marks || []).forEach((m) => {
    if (!marksByTest.has(m.class_test_id)) marksByTest.set(m.class_test_id, []);
    marksByTest.get(m.class_test_id).push(m);
  });

  const grades = Object.fromEntries(GRADE_ORDER.map((g) => [g, 0]));
  const studentsSeen = new Set();

  const testRows = tests.map((test) => {
    const rows = marksByTest.get(test.id) || [];
    const total = num(test.total_marks) || 0;
    const scored = rows.filter((r) => !r.is_absent && r.marks_obtained !== null);

    scored.forEach((r) => {
      studentsSeen.add(r.student_id);
      const p = pct(num(r.marks_obtained) || 0, total);
      const g = gradeFor(p);
      if (grades[g] !== undefined) grades[g] += 1;
    });

    const obtained = scored.reduce((a, r) => a + (num(r.marks_obtained) || 0), 0);
    const average = scored.length > 0 ? obtained / scored.length : null;

    return {
      id: test.id,
      subject: test.subject,
      title: test.title,
      date: test.test_date,
      teacherId: test.teacher_id,
      teacherName: test.teacher_id ? teacherNames[test.teacher_id] || "Unknown" : "Entered by admin",
      total,
      marked: scored.length,
      absent: rows.filter((r) => r.is_absent).length,
      average,
      percent: average !== null ? pct(average, total) : null,
      passed: scored.filter((r) => pct(num(r.marks_obtained) || 0, total) >= PASS_PERCENT).length,
      // A test nobody has marked yet is kept and shown as such — dropping it
      // would hide the fact that it is sitting unmarked.
      unmarked: rows.length === 0,
    };
  });

  return {
    tests: testRows,
    subjects: groupBy(testRows, (t) => t.subject, "subject"),
    byTeacher: teacherId ? [] : groupBy(testRows, (t) => t.teacherName, "teacher"),
    grades: GRADE_ORDER.map((g) => ({ grade: g, count: grades[g] })),
    stats: statsFor(testRows, studentsSeen.size),
  };
}

/**
 * Averages within a bucket, weighted by marks rather than by test.
 *
 * A test sat by forty girls and one sat by four are not equal evidence, so the
 * bucket sums marks and totals and divides once. Averaging the per-test averages
 * would let a four-girl test move a subject as much as a whole class.
 */
function groupBy(testRows, keyOf, kind) {
  const map = new Map();

  testRows.forEach((t) => {
    if (t.percent === null) return;
    const key = keyOf(t);
    if (!map.has(key)) map.set(key, { name: key, kind, tests: 0, marks: 0, obtained: 0, total: 0, passed: 0 });
    const bucket = map.get(key);
    bucket.tests += 1;
    bucket.marks += t.marked;
    bucket.obtained += t.average * t.marked;
    bucket.total += t.total * t.marked;
    bucket.passed += t.passed;
  });

  return [...map.values()]
    .map((b) => ({ ...b, percent: pct(b.obtained, b.total) }))
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
}

function statsFor(testRows, studentCount) {
  const scored = testRows.filter((t) => t.percent !== null);
  const marks = scored.reduce((a, t) => a + t.marked, 0);
  const obtained = scored.reduce((a, t) => a + t.average * t.marked, 0);
  const total = scored.reduce((a, t) => a + t.total * t.marked, 0);
  const passed = scored.reduce((a, t) => a + t.passed, 0);

  return {
    testCount: testRows.length,
    unmarkedTests: testRows.filter((t) => t.unmarked).length,
    marks,
    students: studentCount,
    absent: testRows.reduce((a, t) => a + t.absent, 0),
    percent: pct(obtained, total),
    passPercent: marks > 0 ? (passed / marks) * 100 : null,
    passMark: PASS_PERCENT,
  };
}

function emptyResult() {
  return {
    tests: [],
    subjects: [],
    byTeacher: [],
    grades: GRADE_ORDER.map((g) => ({ grade: g, count: 0 })),
    stats: {
      testCount: 0, unmarkedTests: 0, marks: 0, students: 0, absent: 0,
      percent: null, passPercent: null, passMark: PASS_PERCENT,
    },
  };
}
