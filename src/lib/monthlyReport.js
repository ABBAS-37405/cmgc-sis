/**
 * Monthly performance reports.
 *
 * One month, one class, one PDF per girl: how often she attended, how her class
 * tests went, what she did with her assignments, the term result if one was
 * recorded, and where her fee stands. The PDF is uploaded to storage and the
 * parent gets its link over WhatsApp — click-to-chat cannot attach a file, so a
 * link is the only way a document reaches them without the paid Business API.
 *
 * Everything here is read-only aggregation. The one rule that matters is the
 * performance rule from CLAUDE.md: no query inside a `.map()`. A class of forty
 * costs the same six queries as a class of four, because every table is fetched
 * once for the whole roster and then grouped in JS.
 */

import { supabase } from "./supabaseClient";

/** "2026-08" -> { from: "2026-08-01", to: "2026-08-31", label: "August 2026" } */
export function monthRange(month) {
  const [y, m] = String(month).split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0); // day 0 of the next month = last day of this one
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return {
    from: iso(start),
    to: iso(end),
    label: start.toLocaleDateString("en-PK", { month: "long", year: "numeric" }),
  };
}

/** The month that just ended — the one an admin actually wants to report on. */
export function defaultMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Months from the current one back through `count`, newest first. */
export function recentMonths(count = 18) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleDateString("en-PK", { month: "long", year: "numeric" }) });
  }
  return out;
}

const pct = (obtained, total) => (total > 0 ? (obtained / total) * 100 : null);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/* --------------------------------------------------------- what to include */

/**
 * Which examination the report speaks about.
 *
 * The default is class tests alone, because that is what most months actually
 * hold. The two sentinels are not exam names — anything else in this field is
 * matched against `results.exam_name` verbatim.
 */
export const EXAM_CLASS_TESTS = "__class_tests__"; // no examination section at all
export const EXAM_AUTO_MONTH = "__auto_month__";   // whatever exam was entered this month

/** Every section is on unless the admin turns it off. */
export const DEFAULT_SECTIONS = {
  attendance: true,
  tests: true,
  assignments: true,
  result: true,
  fee: true,
};

export const SECTION_LABELS = [
  { id: "attendance", label: "Attendance" },
  { id: "tests", label: "Class Tests" },
  { id: "assignments", label: "Assignments" },
  { id: "result", label: "Exam Result" },
  { id: "fee", label: "Fee Position" },
];

export function normaliseSections(sections) {
  return { ...DEFAULT_SECTIONS, ...(sections || {}) };
}

/**
 * The exams these students actually have marks for, newest first.
 *
 * Names are free text built by EnterResults ("Pre-Board Exam - 15 August 2026"),
 * so the only honest source for the dropdown is what is already in the table.
 * Deliberately not limited to the report month: picking an exam is how an admin
 * sends out a Pre-Board result, and that exam rarely sits in the month she is
 * reporting on.
 */
export async function fetchExamNames(studentIds) {
  if (!studentIds || studentIds.length === 0) return [];

  const { data, error } = await supabase
    .from("results")
    .select("exam_name, created_at")
    .in("student_id", studentIds);

  if (error) return [];

  const latest = new Map();
  (data || []).forEach((r) => {
    if (!r.exam_name) return;
    const seen = latest.get(r.exam_name);
    if (!seen || new Date(r.created_at) > new Date(seen)) latest.set(r.exam_name, r.created_at);
  });

  return [...latest.entries()]
    .sort((a, b) => new Date(b[1]) - new Date(a[1]))
    .map(([name, enteredAt]) => ({ name, enteredAt }));
}

/**
 * Builds every student's report for one month in one pass.
 *
 * `students` is the roster the caller already loaded (so program/year scoping and
 * the sub-admin's allowed_programs are decided in one place, not repeated here).
 * Returns one report object per student, in the same order.
 */
export async function buildMonthlyReports(students, month, { examName = EXAM_CLASS_TESTS } = {}) {
  const range = monthRange(month);
  const ids = students.map((s) => s.id);
  if (ids.length === 0) return [];

  const programs = [...new Set(students.map((s) => s.program).filter(Boolean))];
  const years = [...new Set(students.map((s) => s.year_of_study || "1st Year"))];

  // Six queries for the whole class, regardless of its size.
  const [attendanceRes, testRes, assignmentRes, resultRes, feeRes] = await Promise.all([
    supabase
      .from("attendance")
      .select("student_id, date, status")
      .in("student_id", ids)
      .gte("date", range.from)
      .lte("date", range.to),

    // !inner is what lets the date filter apply to the parent test rather than
    // the mark row — class_test_marks itself carries no date.
    supabase
      .from("class_test_marks")
      .select("student_id, marks_obtained, is_absent, remarks, class_tests!inner(id, subject, title, test_date, total_marks)")
      .in("student_id", ids)
      .gte("class_tests.test_date", range.from)
      .lte("class_tests.test_date", range.to),

    supabase
      .from("assignments")
      .select("id, subject, title, total_marks, due_date, programs, year_of_study")
      .overlaps("programs", programs)
      .in("year_of_study", years)
      .gte("due_date", range.from)
      .lte("due_date", range.to),

    examResultsQuery(ids, range, examName),

    // Fee position as it stood at month end: every charge already due by then.
    supabase
      .from("fees")
      .select("id, student_id, label, amount_due, due_date, status, sort_order, payment_transactions(amount, status)")
      .in("student_id", ids)
      .lte("due_date", range.to),
  ]);

  // Submissions need the assignment ids, so this one waits for the query above.
  const assignments = assignmentRes.data || [];
  let submissions = [];
  if (assignments.length > 0) {
    const { data } = await supabase
      .from("assignment_submissions")
      .select("assignment_id, student_id, file_url, submitted_at, marks_obtained")
      .in("assignment_id", assignments.map((a) => a.id))
      .in("student_id", ids);
    submissions = data || [];
  }

  const groupBy = (rows, key) => {
    const map = new Map();
    (rows || []).forEach((r) => {
      if (!map.has(r[key])) map.set(r[key], []);
      map.get(r[key]).push(r);
    });
    return map;
  };

  const attendanceBy = groupBy(attendanceRes.data, "student_id");
  const testsBy = groupBy(testRes.data, "student_id");
  const resultsBy = groupBy(resultRes.data, "student_id");
  const feesBy = groupBy(feeRes.data, "student_id");
  const subsBy = groupBy(submissions, "student_id");

  return students.map((student) =>
    assembleReport({
      student,
      range,
      month,
      attendance: attendanceBy.get(student.id) || [],
      testMarks: testsBy.get(student.id) || [],
      assignments,
      submissions: subsBy.get(student.id) || [],
      results: resultsBy.get(student.id) || [],
      fees: feesBy.get(student.id) || [],
    })
  );
}

/**
 * Which `results` rows the examination section is built from.
 *
 * A named exam is fetched whole, with no date filter — a Pre-Board sat in
 * December is exactly the thing an admin wants to send out in January, and
 * scoping it to the report month would silently return nothing. Only the
 * automatic mode looks at the month, and it looks at `created_at` because
 * `results` carries no exam date of its own.
 */
function examResultsQuery(ids, range, examName) {
  const columns = "student_id, exam_name, subject, marks_obtained, total_marks, created_at";

  if (examName === EXAM_CLASS_TESTS) {
    // Nothing to fetch: the report has no examination section in this mode.
    return Promise.resolve({ data: [], error: null });
  }

  if (examName === EXAM_AUTO_MONTH) {
    return supabase
      .from("results")
      .select(columns)
      .in("student_id", ids)
      .gte("created_at", `${range.from}T00:00:00`)
      .lte("created_at", `${range.to}T23:59:59`);
  }

  return supabase.from("results").select(columns).in("student_id", ids).eq("exam_name", examName);
}

function assembleReport({ student, range, month, attendance, testMarks, assignments, submissions, results, fees }) {
  return {
    student,
    month,
    monthLabel: range.label,
    range,
    attendance: summariseAttendance(attendance),
    tests: summariseTests(testMarks),
    assignments: summariseAssignments(student, assignments, submissions),
    result: summariseResult(results),
    fee: summariseFee(fees),
  };
}

function summariseAttendance(rows) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const present = count("Present");
  const absent = count("Absent");
  const leave = count("Leave");
  const marked = rows.length;

  return {
    present,
    absent,
    leave,
    marked,
    percent: pct(present, marked),
    // Kept sorted so the PDF can list the exact days she missed — that is the
    // detail parents ask about first.
    absentDates: rows
      .filter((r) => r.status === "Absent" || r.status === "Leave")
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((r) => ({ date: r.date, status: r.status })),
  };
}

/** One entry per subject, mirroring how the student's own ClassTests tab groups them. */
function summariseTests(rows) {
  const map = new Map();

  rows.forEach((r) => {
    const t = r.class_tests;
    if (!t) return; // parent test deleted — the orphan mark means nothing
    if (!map.has(t.subject)) map.set(t.subject, { subject: t.subject, tests: [] });

    const total = num(t.total_marks) || 0;
    const obtained = r.is_absent ? null : num(r.marks_obtained);
    map.get(t.subject).tests.push({
      title: t.title,
      date: t.test_date,
      total,
      obtained,
      isAbsent: !!r.is_absent,
      pct: obtained !== null ? pct(obtained, total) : null,
    });
  });

  const subjects = [...map.values()]
    .map((g) => {
      g.tests.sort((a, b) => new Date(a.date) - new Date(b.date));
      const counted = g.tests.filter((t) => t.obtained !== null);
      const obtained = counted.reduce((a, t) => a + t.obtained, 0);
      const total = counted.reduce((a, t) => a + t.total, 0);
      return { ...g, obtained, total, absent: g.tests.filter((t) => t.isAbsent).length, percent: pct(obtained, total) };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const obtained = subjects.reduce((a, s) => a + s.obtained, 0);
  const total = subjects.reduce((a, s) => a + s.total, 0);

  return {
    subjects,
    count: subjects.reduce((a, s) => a + s.tests.length, 0),
    obtained,
    total,
    percent: pct(obtained, total),
  };
}

function summariseAssignments(student, allAssignments, submissions) {
  const byId = {};
  submissions.forEach((s) => { byId[s.assignment_id] = s; });

  // An assignment counts for her only if it was set for her group and her year.
  const mine = allAssignments.filter(
    (a) =>
      (a.programs || []).includes(student.program) &&
      (a.year_of_study || "1st Year") === (student.year_of_study || "1st Year")
  );

  const items = mine
    .map((a) => {
      const sub = byId[a.id];
      const marks = num(sub?.marks_obtained);
      const submittedAt = sub?.submitted_at || null;
      return {
        title: a.title,
        subject: a.subject,
        dueDate: a.due_date,
        totalMarks: num(a.total_marks) || 0,
        submitted: !!(sub?.file_url || submittedAt || marks !== null),
        // Graded work handed in on paper has no submitted_at, so a late flag is
        // only meaningful when we know when it arrived.
        late: submittedAt ? submittedAt.slice(0, 10) > a.due_date : false,
        marks,
      };
    })
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const graded = items.filter((i) => i.marks !== null);
  const obtained = graded.reduce((a, i) => a + i.marks, 0);
  const total = graded.reduce((a, i) => a + i.totalMarks, 0);

  return {
    items,
    set: items.length,
    submitted: items.filter((i) => i.submitted).length,
    missing: items.filter((i) => !i.submitted).length,
    late: items.filter((i) => i.late).length,
    obtained,
    total,
    percent: pct(obtained, total),
  };
}

/** The term exam recorded this month, if there was one. */
function summariseResult(rows) {
  if (rows.length === 0) return null;

  // More than one exam can land in a month; report the most recently entered.
  const latest = rows.reduce((a, r) => (new Date(r.created_at) > new Date(a.created_at) ? r : a), rows[0]);
  const subjects = rows
    .filter((r) => r.exam_name === latest.exam_name)
    .map((r) => ({
      subject: r.subject,
      obtained: num(r.marks_obtained) || 0,
      total: num(r.total_marks) || 0,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  const obtained = subjects.reduce((a, s) => a + s.obtained, 0);
  const total = subjects.reduce((a, s) => a + s.total, 0);

  return { examName: latest.exam_name, subjects, obtained, total, percent: pct(obtained, total) };
}

/**
 * Fee position at month end. The paid amount is derived from the embedded
 * `Success` transactions, exactly as Fee.jsx and FeeVerification.jsx do — the
 * stored `status` is a cache of that sum, not the source of truth.
 */
function summariseFee(fees) {
  const rows = fees
    .map((f) => {
      const paid = (f.payment_transactions || [])
        .filter((t) => t.status === "Success")
        .reduce((a, t) => a + (num(t.amount) || 0), 0);
      const due = num(f.amount_due) || 0;
      return {
        label: f.label || "Fee",
        dueDate: f.due_date,
        due,
        paid,
        balance: Math.max(due - paid, 0),
        status: f.status || "Unpaid",
        sortOrder: f.sort_order ?? 0,
      };
    })
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate) || a.sortOrder - b.sortOrder);

  return {
    rows,
    due: rows.reduce((a, r) => a + r.due, 0),
    paid: rows.reduce((a, r) => a + r.paid, 0),
    balance: rows.reduce((a, r) => a + r.balance, 0),
  };
}

/* ------------------------------------------------- storage and the sent log */

export const REPORTS_BUCKET = "reports";

/**
 * Uploads the PDF and returns its public URL.
 *
 * The path carries the student's UUID, so the URL is not guessable from a roll
 * number — the bucket is public, exactly like `admission-documents`, because the
 * parent opening the link has no login of any kind. `upsert` means regenerating
 * a month's report replaces it instead of littering the bucket, and any link
 * already sent keeps working.
 */
export async function uploadReportPdf(report, blob) {
  const path = `monthly/${report.month}/${report.student.id}.pdf`;

  const { error } = await supabase.storage
    .from(REPORTS_BUCKET)
    .upload(path, blob, { contentType: "application/pdf", upsert: true });

  if (error) throw new Error(`Report upload failed: ${error.message}`);

  const { data } = supabase.storage.from(REPORTS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Records that a report went out. Best effort on purpose: the log is a
 * convenience so the admin can see who has already been sent this month's
 * report, and a logging failure must never look like a sending failure.
 */
export async function logReportSent({ report, url, sentBy }) {
  const { error } = await supabase.from("report_log").upsert(
    {
      student_id: report.student.id,
      month: report.month,
      file_url: url,
      attendance_percent: report.attendance.percent,
      test_percent: report.tests.percent,
      sent_by: sentBy || null,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "student_id,month" }
  );

  return !error;
}

/** month -> { student_id: log row }, so the list can show "already sent". */
export async function fetchReportLog(studentIds, month) {
  if (studentIds.length === 0) return {};

  const { data, error } = await supabase
    .from("report_log")
    .select("student_id, month, file_url, sent_at")
    .in("student_id", studentIds)
    .eq("month", month);

  // The table is optional — a portal running before the migration still works,
  // it just cannot show what was already sent.
  if (error) return {};

  const byStudent = {};
  (data || []).forEach((r) => { byStudent[r.student_id] = r; });
  return byStudent;
}

/**
 * The WhatsApp text that carries the link.
 *
 * Deliberately short: WhatsApp truncates long prefilled messages behind a "read
 * more", and the link is the part that must stay visible.
 */
export function buildReportMessage(report, url, sections) {
  const on = normaliseSections(sections);
  const { student, attendance, tests, result } = report;
  const lines = [
    "Assalamualaikum,",
    "",
    `${student.name} (Roll No: ${student.roll_no}) ki ${report.monthLabel} ki performance report tayyar hai.`,
    "",
  ];

  // Only ever quote a figure the PDF actually contains — a summary line for a
  // section the admin switched off would send the parent looking for it.
  if (on.attendance && attendance.marked > 0) {
    lines.push(`Attendance: ${attendance.present}/${attendance.marked} din (${attendance.percent.toFixed(0)}%)`);
  }
  if (on.tests && tests.percent !== null) {
    lines.push(`Class Tests: ${tests.obtained}/${tests.total} (${tests.percent.toFixed(0)}%)`);
  }
  if (on.result && result && result.percent !== null) {
    lines.push(`${result.examName}: ${result.obtained}/${result.total} (${result.percent.toFixed(0)}%)`);
  }
  if (on.fee && report.fee.balance > 0) {
    lines.push(`Fee baqaya: Rs. ${report.fee.balance.toLocaleString("en-PK")}`);
  }

  lines.push(
    "",
    "Mukammal report is link par dekhein:",
    url,
    "",
    "Kisi bhi sawal ke liye college office se rabta karein.",
    "",
    "CMGC Administration"
  );

  return lines.join("\n");
}
