/**
 * Class test result sheets.
 *
 * One test, the whole class: who scored what, where each girl stands, and how
 * the class did as a whole. Produces the sheet the office pins up and the slip
 * that goes home, from the same numbers.
 *
 * Kept apart from monthlyReport.js because the axis is different — that one is
 * one girl across a month, this one is one test across a class.
 */

import { supabase } from "./supabaseClient";

/**
 * The groups a test actually covered.
 *
 * `program` may hold the "All Programs" literal, so it is not a roster filter on
 * its own; `programs[]` is authoritative. Rows written before that column
 * existed fall back to `[program]`. Reading `program` alone silently returns
 * nobody for a combined test — the same trap ClassTestEntry documents.
 */
export function testPrograms(test) {
  return Array.isArray(test?.programs) && test.programs.length > 0
    ? test.programs
    : [test?.program].filter(Boolean);
}

/** Pakistani board bands. 33% is the pass mark. */
export const PASS_PERCENT = 33;

export function gradeFor(percent) {
  if (percent === null || percent === undefined) return "—";
  if (percent >= 80) return "A+";
  if (percent >= 70) return "A";
  if (percent >= 60) return "B";
  if (percent >= 50) return "C";
  if (percent >= 40) return "D";
  if (percent >= PASS_PERCENT) return "E";
  return "F";
}

/**
 * Tests an admin may pick from, newest first.
 *
 * `allowedPrograms` empty means unrestricted, the same convention as everywhere
 * else. A restricted sub-admin sees a combined test only when it overlaps her
 * groups — she then sees just her own girls in it, because the roster is filtered
 * again in buildTestReport().
 */
export async function fetchTests({ allowedPrograms = [], program, year, limit = 200 } = {}) {
  let query = supabase
    .from("class_tests")
    .select("id, subject, title, test_date, total_marks, program, programs, year_of_study")
    .order("test_date", { ascending: false })
    .limit(limit);

  if (year && year !== "Both") query = query.eq("year_of_study", year);

  const scope = program && program !== "All Programs" ? [program] : allowedPrograms;
  if (scope.length > 0) query = query.overlaps("programs", scope);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Everything needed to print one test: the roster, each girl's mark, her
 * position, and the class statistics.
 *
 * Two queries, whatever the class size.
 */
export async function buildTestReport(test, { allowedPrograms = [] } = {}) {
  const groups = testPrograms(test);
  const scoped = allowedPrograms.length > 0 ? groups.filter((g) => allowedPrograms.includes(g)) : groups;

  if (scoped.length === 0) {
    return { test, groups, rows: [], stats: emptyStats() };
  }

  const [{ data: students, error: rosterError }, { data: marks, error: marksError }] = await Promise.all([
    supabase
      .from("students")
      .select("id, name, roll_no, program, year_of_study, father_name")
      .in("program", scoped)
      .eq("year_of_study", test.year_of_study)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("class_test_marks")
      .select("student_id, marks_obtained, is_absent, remarks")
      .eq("class_test_id", test.id),
  ]);

  if (rosterError) throw new Error(rosterError.message);
  if (marksError) throw new Error(marksError.message);

  const byStudent = {};
  (marks || []).forEach((m) => { byStudent[m.student_id] = m; });

  const total = Number(test.total_marks) || 0;

  const rows = (students || []).map((student) => {
    const m = byStudent[student.id];
    const isAbsent = !!m?.is_absent;
    // No mark row at all is not the same as a zero — she simply has not been
    // marked yet, and printing 0 for that would be a lie.
    const obtained = !m || isAbsent || m.marks_obtained === null ? null : Number(m.marks_obtained);
    const percent = obtained !== null && total > 0 ? (obtained / total) * 100 : null;

    return {
      student,
      obtained,
      isAbsent,
      notMarked: !m,
      remarks: m?.remarks || "",
      percent,
      // Graded here rather than in the renderer, so reportPdf.js stays free of
      // any import that reaches supabaseClient — that is what lets the PDF code
      // be exercised outside a browser.
      grade: gradeFor(percent),
    };
  });

  rankInPlace(rows);

  return { test, groups: scoped, rows, stats: statsFor(rows, total) };
}

/**
 * Position within the class, highest first.
 *
 * Equal marks share a position and the next one is skipped (1, 2, 2, 4) — that
 * is what a result sheet means by position. Absent and unmarked girls get none.
 */
function rankInPlace(rows) {
  const scored = rows.filter((r) => r.obtained !== null).sort((a, b) => b.obtained - a.obtained);

  let lastMark = null;
  let lastRank = 0;
  scored.forEach((row, i) => {
    if (lastMark !== null && row.obtained === lastMark) {
      row.position = lastRank;
    } else {
      row.position = i + 1;
      lastRank = row.position;
      lastMark = row.obtained;
    }
  });

  rows.forEach((r) => { if (r.obtained === null) r.position = null; });
}

function emptyStats() {
  return {
    strength: 0, taken: 0, absent: 0, notMarked: 0,
    highest: null, lowest: null, average: null, averagePercent: null,
    passed: 0, failed: 0, total: 0,
  };
}

function statsFor(rows, total) {
  const scored = rows.filter((r) => r.obtained !== null);
  if (scored.length === 0) {
    return { ...emptyStats(), strength: rows.length, absent: rows.filter((r) => r.isAbsent).length, notMarked: rows.filter((r) => r.notMarked).length, total };
  }

  const values = scored.map((r) => r.obtained);
  const sum = values.reduce((a, v) => a + v, 0);
  const average = sum / values.length;

  return {
    strength: rows.length,
    taken: scored.length,
    absent: rows.filter((r) => r.isAbsent).length,
    notMarked: rows.filter((r) => r.notMarked).length,
    highest: Math.max(...values),
    lowest: Math.min(...values),
    average,
    averagePercent: total > 0 ? (average / total) * 100 : null,
    passed: scored.filter((r) => r.percent !== null && r.percent >= PASS_PERCENT).length,
    failed: scored.filter((r) => r.percent !== null && r.percent < PASS_PERCENT).length,
    passPercent: PASS_PERCENT,
    total,
  };
}

export function testReportFileName(report) {
  const t = report.test;
  const safe = `${t.subject}-${t.title}`.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").slice(0, 60);
  return `test-${safe}-${t.test_date}.pdf`;
}
