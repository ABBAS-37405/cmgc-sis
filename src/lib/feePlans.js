import { supabase } from "./supabaseClient";

export const YEARS = ["1st Year", "2nd Year"];

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function fetchFeePlans() {
  const { data, error } = await supabase
    .from("fee_plans")
    .select("*")
    .order("year_of_study")
    .order("program");
  if (error) throw new Error(error.message);
  return data || [];
}

export function findPlan(plans, year, program) {
  return plans.find((p) => p.year_of_study === year && p.program === program) || null;
}

export async function saveFeePlan(plan) {
  const { error } = await supabase
    .from("fee_plans")
    .update({
      admission_fee: Number(plan.admission_fee),
      monthly_fee: Number(plan.monthly_fee),
      total_fee: Number(plan.total_fee),
      installments: plan.installments,
      updated_at: new Date().toISOString(),
    })
    .eq("id", plan.id);
  if (error) throw new Error(error.message);
}

// What a plan's installments actually add up to, ignoring the stored total. The
// admin can set a total that differs (a discount, a rounding), so Fee Settings
// shows both and flags the gap rather than silently trusting either.
export function computedTotal(plan) {
  if (!plan) return 0;
  const months = (plan.installments || []).reduce((sum, i) => sum + (Number(i.months) || 0), 0);
  return Number(plan.admission_fee || 0) + months * Number(plan.monthly_fee || 0);
}

export function totalMonths(plan) {
  return (plan?.installments || []).reduce((sum, i) => sum + (Number(i.months) || 0), 0);
}

const iso = (d) => d.toISOString().split("T")[0];

/**
 * Turns a plan into the actual `fees` rows for one student.
 *
 * `due_month: null` means the charge falls due at admission — a week after
 * enrolment, matching what the office already did by hand. A numbered month
 * resolves to the 10th of the next occurrence of that month at or after the
 * previous instalment, so the schedule always runs forward: a 2nd-year plan
 * starting in July lands Sep–Dec in this year and Jan–Apr in the next, and a
 * student enrolling late never gets a February charge dated before November's.
 */
export function buildFeeRows({ plan, studentId, program, year, from = new Date() }) {
  if (!plan) return [];
  const rows = [];

  const admissionDue = new Date(from);
  admissionDue.setDate(admissionDue.getDate() + 7);

  if (Number(plan.admission_fee) > 0) {
    rows.push({
      student_id: studentId,
      program,
      year_of_study: year,
      label: "Admission Fee",
      amount_due: Number(plan.admission_fee),
      due_date: iso(admissionDue),
      // Every row of one enrolment gets the same created_at (Postgres evaluates
      // now() once per statement), so the student's Fee tab needs this to show
      // them in order rather than arbitrarily.
      sort_order: 0,
      status: "Unpaid",
    });
  }

  // Walks forward through the schedule; each due date is pinned to be no earlier
  // than the one before it.
  let cursor = admissionDue;

  for (const inst of plan.installments || []) {
    const amount = (Number(inst.months) || 0) * Number(plan.monthly_fee || 0);
    if (amount <= 0) continue;

    let due;
    if (inst.due_month == null) {
      due = new Date(admissionDue);
    } else {
      const month = Number(inst.due_month) - 1;
      let year = cursor.getFullYear();
      due = new Date(year, month, 10);
      // At most one roll is ever needed, but the guard keeps this terminating
      // even if a plan is edited into something strange.
      for (let guard = 0; due < cursor && guard < 3; guard += 1) {
        year += 1;
        due = new Date(year, month, 10);
      }
    }
    cursor = due;

    rows.push({
      student_id: studentId,
      program,
      year_of_study: year,
      label: inst.label || "Installment",
      amount_due: amount,
      due_date: iso(due),
      sort_order: rows.length,
      status: "Unpaid",
    });
  }

  return rows;
}

/**
 * The rows a student is missing from her plan.
 *
 * Students enrolled before fee plans existed have a single unlabelled row — the
 * admission fee the old code created — and no instalments at all, so nothing of
 * theirs ever appears under a month. This works out what to add without
 * duplicating what is already there:
 *
 *   - a charge whose label she already has is skipped;
 *   - the admission fee is skipped when she has any unlabelled row, because that
 *     row *is* her admission fee (often already paid, sometimes at an adjusted
 *     amount) and re-adding it would bill her twice.
 */
export function missingFeeRows({ plan, student, existingFees, from = new Date() }) {
  if (!plan) return [];

  const all = buildFeeRows({
    plan,
    studentId: student.id,
    program: student.program,
    year: student.year_of_study || "1st Year",
    from,
  });

  const haveLabels = new Set(existingFees.map((f) => f.label).filter(Boolean));
  const hasUnlabelled = existingFees.some((f) => !f.label);

  return all.filter((row) => {
    if (haveLabels.has(row.label)) return false;
    if (row.label === "Admission Fee" && hasUnlabelled) return false;
    return true;
  });
}
