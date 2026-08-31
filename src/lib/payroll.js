/**
 * Payroll — turning a month of attendance into one payable figure.
 *
 * This covers **everyone the college pays**: teachers from the `teachers` table
 * and non-teaching staff from `staff`. Nothing below reads a subject, a program
 * or a right, so an accountant and a physics teacher price identically — the
 * only thing that matters is the employment type and the rate. That is why the
 * functions take a `person` rather than a `teacher`, and why the two rosters can
 * stay separate tables while sharing one calculation.
 *
 * This file imports nothing that reaches `supabaseClient`, for the same reason
 * `reportPdf.js` doesn't: the arithmetic below is the part that quietly goes
 * wrong, and keeping it free of the database is what lets it be driven from
 * plain Node against fixture data in a repo with no test runner.
 *
 * Two pay shapes, and they are not variations of each other:
 *
 *   Regular   — a fixed monthly salary. Absence is a *deduction* from it. The
 *               first absent/leave day each month is free; every day after that
 *               costs one day's pay, where a day is `monthly_salary / working
 *               days in that month`. Because holidays are never working days,
 *               a holiday can neither shrink the salary nor inflate the rate.
 *
 *   Visiting   — paid for days actually worked: `present days × per_day_salary`.
 *               There is no deduction to compute, because nothing was owed for
 *               a day not worked. A holiday is simply a day not present, so it
 *               is unpaid — which is the asymmetry the college asked for and the
 *               reason these are two branches, not one.
 *
 * "Visiting" is the label the college uses for a visiting lecturer, and it is
 * the same arrangement as a daily-wage guard or sweeper: the word is theirs, the
 * arithmetic is per-day either way.
 *
 * An unmarked day is not an absence. It is counted and reported separately so
 * the admin can see the register is incomplete, but it never deducts from a
 * Regular salary. Silently reading "nobody filled the register" as "they didn't
 * come" would take money off someone who was at work.
 *
 * PRESENT DAYS MAY BE OVERRIDDEN, and only a super admin is offered the box.
 * The register is filled in every morning and is sometimes simply wrong — a
 * week nobody marked, a teacher who came in during the holidays, days agreed at
 * the office that were never entered. Rather than ask the office to go back and
 * repair a month of the register to fix one figure, `presentDaysOverride` says
 * what the present days actually were, and the salary is priced off that.
 *
 * It is a correction, not a second pay rule, so it changes exactly one input:
 *
 *   Visiting   — the paid days are the days stated. `20 × per day`, whatever the
 *                register happens to hold.
 *
 *   Regular    — the working days the correction does not account for become
 *                absence: `working days − present − half days ÷ 2`. Where the
 *                register is complete that is arithmetically the same absence it
 *                already held, so a correction that agrees with the register
 *                changes nothing at all.
 *
 * That last point is what makes the override safe to state as an absolute rather
 * than as a nudge, and it is worth being clear about how it sits beside the rule
 * above it. An unmarked day is not an absence — nobody may read silence as "she
 * didn't come". A stated present count is not silence: a super admin saying "she
 * was present 20 days" in a month of 26 working days has accounted for the whole
 * month, and the six days she did not claim are days not attended. So the rule
 * is not weakened; it is that there is no longer anything unaccounted for. This
 * is also why the box is a super admin's and why every screen prints what the
 * register itself held beside it.
 *
 * Null means the register decides, and that is the default for everybody. What
 * the register itself counted is always carried back as `registerPresentDays`,
 * so no screen has to choose between showing the correction and showing what it
 * corrected.
 */

export const EMPLOYMENT_TYPES = ["Regular", "Visiting"];

export const ATTENDANCE_STATUSES = [
  { id: "Present", label: "Present", short: "P" },
  { id: "Absent", label: "Absent", short: "A" },
  { id: "Leave", label: "Leave", short: "L" },
  { id: "Half Day", label: "Half Day", short: "H" },
];

/** A Regular employee's first absent/leave day in a month costs them nothing. */
export const FREE_ABSENCE_DAYS = 1;

/** Sunday is the weekly off. Never a working day, for either pay shape. */
export const WEEKLY_OFF_DAY = 0; // matches Date#getDay

export const SALARY_STATUSES = ["Unpaid", "Partially Paid", "Paid"];

/* ------------------------------------------------------------------ dates */

const pad = (n) => String(n).padStart(2, "0");

/** Date | string -> "YYYY-MM" */
export function monthKeyOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "2026-08" -> "August 2026" */
export function monthLabel(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

/** The last N months, newest first, as [{ key, label }]. */
export function recentMonths(count = 12, from = new Date()) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    const key = monthKeyOf(d);
    out.push({ key, label: monthLabel(key) });
  }
  return out;
}

/** "2026-08" -> { from: "2026-08-01", to: "2026-08-31", days: 31 } */
export function monthRange(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(days)}`, days };
}

/** Every date in the month as [{ date, day, weekday, isWeeklyOff }]. */
export function monthDays(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  const total = new Date(y, m, 0).getDate();
  const out = [];
  for (let day = 1; day <= total; day += 1) {
    const dt = new Date(y, m - 1, day);
    out.push({
      date: `${y}-${pad(m)}-${pad(day)}`,
      day,
      weekday: dt.getDay(),
      isWeeklyOff: dt.getDay() === WEEKLY_OFF_DAY,
    });
  }
  return out;
}

/* --------------------------------------------------------------- the maths */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round = (n) => Math.round(n * 100) / 100;

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

/**
 * The stored override as a number, or null for "the register decides".
 *
 * An empty box, a blank column and a value that is not a number all mean the
 * same thing and must all mean the register — a correction nobody made may
 * never price a salary.
 */
export function normalisePresentDays(value, maxDays = 31) {
  if (value === null || value === undefined) return null;
  // Trimmed before the Number(), because `Number("   ")` is 0, not NaN — a box
  // holding a stray space would otherwise read as "present zero days" and take
  // a whole month's salary off somebody.
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n * 2) / 2, 0, maxDays);
}

export const employmentTypeOf = (person) =>
  person?.employment_type === "Visiting" ? "Visiting" : "Regular";

/**
 * Which column on the attendance/salary tables points back at this person.
 * A `teachers` row and a `staff` row share both tables, distinguished only by
 * which of the two foreign keys is filled in — the database enforces that
 * exactly one of them ever is.
 */
export const ownerColumnFor = (person) =>
  person?.kind === "staff" ? "staff_id" : "teacher_id";

/** What one day is worth for this person in this month. */
export function perDayRateFor(person, workingDays) {
  if (employmentTypeOf(person) === "Visiting") return num(person?.per_day_salary);
  if (!workingDays) return 0;
  return num(person?.monthly_salary) / workingDays;
}

/**
 * The whole calculation for one person for one month.
 *
 * @param person         a `teachers` or `staff` row (employment type + the rate)
 * @param attendance     { "YYYY-MM-DD": "Present" | "Absent" | "Leave" | "Half Day" }
 * @param monthKey       "YYYY-MM"
 * @param holidays       college holiday dates falling in that month
 * @param bonus          admin-added allowance/arrears for this month
 * @param otherDeduction admin-added deduction (advance recovered, fine, ...)
 * @param presentDaysOverride  super-admin correction to the present days; null
 *                             (the default) leaves the register in charge
 */
export function computeSalary({
  person,
  attendance = {},
  monthKey,
  holidays = [],
  bonus = 0,
  otherDeduction = 0,
  presentDaysOverride = null,
}) {
  const type = employmentTypeOf(person);
  const holidaySet = new Set(holidays);

  let workingDays = 0;
  let holidayDays = 0;
  const count = { Present: 0, Absent: 0, Leave: 0, "Half Day": 0 };
  let unmarkedDays = 0;

  monthDays(monthKey).forEach((d) => {
    if (d.isWeeklyOff || holidaySet.has(d.date)) {
      holidayDays += 1;
      return;
    }
    workingDays += 1;
    const status = attendance[d.date];
    if (status && status in count) count[status] += 1;
    else unmarkedDays += 1;
  });

  const registerPresentDays = count.Present;
  const absentDays = count.Absent;
  const leaveDays = count.Leave;
  const halfDays = count["Half Day"];

  // A month has no more days than it has, whichever way the office corrects it.
  const override = normalisePresentDays(presentDaysOverride, monthRange(monthKey).days);
  const presentDays = override === null ? registerPresentDays : override;

  const perDayRate = perDayRateFor(person, workingDays);

  // A half day is half a day of absence on a Regular contract, and half a day
  // of pay on a Visiting one — the same 0.5, read from the two directions.
  //
  // A stated present count accounts for the whole month, so whatever it leaves
  // over is absence. With a complete register the two lines below agree exactly
  // — working days = P + A + L + H, so `wd − P − H/2` is `A + L + H/2` — which
  // is what lets a correction that matches the register change nothing.
  const registerAbsenceDays = absentDays + leaveDays + halfDays * 0.5;
  const absenceDays =
    override === null
      ? registerAbsenceDays
      : clamp(workingDays - presentDays - halfDays * 0.5, 0, workingDays);

  let baseAmount;
  let absenceDeduction;
  let chargeableDays;
  let paidDays;

  if (type === "Visiting") {
    // Nothing is owed for a day not worked, so there is no deduction to make.
    chargeableDays = 0;
    absenceDeduction = 0;
    paidDays = presentDays + halfDays * 0.5;
    baseAmount = round(paidDays * perDayRate);
  } else {
    chargeableDays = Math.max(0, absenceDays - FREE_ABSENCE_DAYS);
    absenceDeduction = round(chargeableDays * perDayRate);
    paidDays = Math.max(0, workingDays - chargeableDays);
    baseAmount = round(num(person?.monthly_salary));
  }

  const netPayable = Math.max(
    0,
    round(baseAmount - absenceDeduction + num(bonus) - num(otherDeduction))
  );

  return {
    employmentType: type,
    monthKey,
    workingDays,
    holidayDays,
    presentDays,
    registerPresentDays,
    presentDaysOverride: override,
    absentDays,
    leaveDays,
    halfDays,
    // Once a present count is stated there is nothing unaccounted for, so there
    // is no incomplete register left to warn about — and a screen that kept
    // printing "never deducted" beside days the correction did deduct would be
    // telling the employee the opposite of what her slip does.
    unmarkedDays: override === null ? unmarkedDays : 0,
    registerUnmarkedDays: unmarkedDays,
    absenceDays,
    registerAbsenceDays,
    freeDays: type === "Regular" ? Math.min(FREE_ABSENCE_DAYS, absenceDays) : 0,
    chargeableDays,
    paidDays,
    perDayRate: round(perDayRate),
    baseAmount,
    absenceDeduction,
    bonus: round(num(bonus)),
    otherDeduction: round(num(otherDeduction)),
    netPayable,
  };
}

/** Was this month's present-day count set by hand rather than counted? */
export const isCorrected = (calc) =>
  calc?.presentDaysOverride !== null && calc?.presentDaysOverride !== undefined;

/** Derived exactly like a fee's status: from what has actually been paid. */
export function salaryStatusFor(netPayable, paidAmount) {
  const net = num(netPayable);
  const paid = num(paidAmount);
  if (paid <= 0) return "Unpaid";
  if (paid + 0.5 >= net) return "Paid";
  return "Partially Paid";
}

/** A `staff_salaries` row from a live calculation — the snapshot that gets stored. */
export function salaryRowFor(person, calc, extra = {}) {
  return {
    [ownerColumnFor(person)]: person.id,
    month: calc.monthKey,
    employment_type: calc.employmentType,
    per_day_rate: calc.perDayRate,
    working_days: calc.workingDays,
    holiday_days: calc.holidayDays,
    present_days: calc.presentDays,
    present_days_override: calc.presentDaysOverride,
    absent_days: calc.absentDays,
    leave_days: calc.leaveDays,
    half_days: calc.halfDays,
    chargeable_days: calc.chargeableDays,
    base_amount: calc.baseAmount,
    absence_deduction: calc.absenceDeduction,
    bonus: calc.bonus,
    other_deduction: calc.otherDeduction,
    net_payable: calc.netPayable,
    ...extra,
  };
}

/* ------------------------------------------------------------ presentation */

export const formatMoney = (amount) =>
  `Rs ${Math.round(num(amount)).toLocaleString("en-PK")}`;

/** 2 -> "2", 2.5 -> "2.5" — half days should not print as 2.50. */
export const formatDays = (value) => {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/**
 * The WhatsApp text: the attendance, then how the figure was reached.
 *
 * The working is spelled out on purpose. A salary slip that only states a total
 * invites the argument the college is trying to avoid — the employee should be
 * able to check the arithmetic against their own record of the month.
 *
 * `roleLabel` is the job title for non-teaching staff (Accountant, Security
 * Guard, ...). Omit it for a teacher, whose slip needs no designation line.
 */
export function buildSalaryMessage(
  person,
  calc,
  { paidAmount = 0, status = "Unpaid", notes = "", roleLabel = "" } = {}
) {
  const lines = [
    "Assalamualaikum,",
    "",
    `${person.name}${roleLabel ? ` (${roleLabel})` : ""} — salary statement for ${monthLabel(calc.monthKey)}.`,
    "",
    "*Attendance*",
    `Working days: ${formatDays(calc.workingDays)}`,
    `Present: ${formatDays(calc.presentDays)}`,
    `Leave: ${formatDays(calc.leaveDays)}`,
    `Absent: ${formatDays(calc.absentDays)}`,
  ];

  // The correction is said where it is read, not in a footnote. Without this the
  // slip prints "Absent: 2" above a deduction taken for four days, and the
  // employee is left to work out which of the two numbers is wrong.
  if (isCorrected(calc)) {
    lines.push(
      `(Present days corrected by the office — the register had recorded ${formatDays(calc.registerPresentDays)}.)`
    );
    if (calc.employmentType === "Regular" && calc.absenceDays !== calc.registerAbsenceDays) {
      lines.push(`Absence counted after the correction: ${formatDays(calc.absenceDays)}`);
    }
  }
  if (calc.halfDays > 0) lines.push(`Half days: ${formatDays(calc.halfDays)}`);
  if (calc.holidayDays > 0) lines.push(`Holidays / weekly off: ${formatDays(calc.holidayDays)}`);
  if (calc.unmarkedDays > 0) lines.push(`Not marked: ${formatDays(calc.unmarkedDays)}`);

  lines.push("", "*Salary*");

  if (calc.employmentType === "Visiting") {
    lines.push(
      `Type: Visiting (per day ${formatMoney(calc.perDayRate)})`,
      `Paid days: ${formatDays(calc.paidDays)}`,
      `${formatDays(calc.paidDays)} × ${formatMoney(calc.perDayRate)} = ${formatMoney(calc.baseAmount)}`
    );
  } else {
    lines.push(
      `Type: Regular (monthly ${formatMoney(calc.baseAmount)})`,
      `One day's pay: ${formatMoney(calc.perDayRate)} (${formatMoney(calc.baseAmount)} ÷ ${formatDays(calc.workingDays)} working days)`
    );
    if (calc.chargeableDays > 0) {
      lines.push(
        `Leave/absent: ${formatDays(calc.absenceDays)} day(s), first ${formatDays(FREE_ABSENCE_DAYS)} allowed free`,
        `Deduction: ${formatDays(calc.chargeableDays)} × ${formatMoney(calc.perDayRate)} = ${formatMoney(calc.absenceDeduction)}`
      );
    } else {
      lines.push(`Leave/absent: ${formatDays(calc.absenceDays)} day(s) — within the free allowance, no deduction.`);
    }
  }

  if (calc.bonus > 0) lines.push(`Allowance / bonus: + ${formatMoney(calc.bonus)}`);
  if (calc.otherDeduction > 0) lines.push(`Other deduction: − ${formatMoney(calc.otherDeduction)}`);

  lines.push("", `*Net payable: ${formatMoney(calc.netPayable)}*`);

  if (status === "Paid") {
    lines.push(`Status: Paid ✅ (${formatMoney(paidAmount)})`);
  } else if (status === "Partially Paid") {
    lines.push(
      `Status: Partially paid — ${formatMoney(paidAmount)} received, ${formatMoney(calc.netPayable - paidAmount)} remaining.`
    );
  } else {
    lines.push("Status: Payment pending.");
  }

  if (notes && notes.trim()) lines.push("", `Note: ${notes.trim()}`);

  lines.push(
    "",
    "If anything above does not match your own record, please contact the college office.",
    "",
    "Regards,",
    "CMGC Administration"
  );

  return lines.join("\n");
}
