/**
 * The college's books: what came in, what went out, what is left.
 *
 * This file imports nothing that reaches `supabaseClient`, for the same reason
 * `payroll.js`, `reportPdf.js` and `xlsx.js` do not — the arithmetic is the part
 * that quietly goes wrong, and in a repo with no test runner the only way it
 * gets exercised is by being drivable from plain Node against fixtures. Give it
 * three arrays of rows and it hands back the ledger; it never asks where they
 * came from.
 *
 * THE LEDGER IS CASH BASIS, both sides. Income is money actually received
 * (`Success` transactions), not fees invoiced; salary expense is
 * `paid_amount`, not `net_payable`. Mixing the two — billing on one side and
 * cash on the other — is how a college with unpaid fees convinces itself it had
 * a good month. `salaryPayable` is carried alongside so the screen can show
 * what is still owed to staff, but it never enters the net.
 */

/**
 * What miscellaneous money goes on. Fixed, because the month-wise breakdown
 * groups by it and free text would make that list useless within a term.
 * `Other` is the escape hatch, and the description field carries the detail.
 *
 * There is deliberately no "Salaries" category: salaries come from
 * `staff_salaries` and adding one here would count it twice.
 */
export const EXPENSE_CATEGORIES = [
  "Utility Bills",
  "Rent",
  "Repairs & Maintenance",
  "Stationery & Printing",
  "Furniture & Equipment",
  "Transport & Fuel",
  "Internet & Phone",
  "Marketing & Advertising",
  "Events & Functions",
  "Government & Legal",
  "FTF Fund",
  "Other",
];

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Cheque", "Card", "Other"];

/**
 * Jan–Dec, or the college's own year, which runs May to April — not Pakistan's
 * July–June government fiscal year, because the college keeps its books to its
 * own session.
 *
 * `startMonth` is the entire definition of a period. `monthsOfPeriod` and
 * `periodLabelOf` both read it rather than testing the id, so moving a year's
 * boundary is this one number and nothing else.
 */
export const PERIOD_MODES = [
  { id: "calendar", label: "Calendar year (Jan–Dec)", startMonth: 1 },
  { id: "fiscal", label: "Financial year (May–Apr)", startMonth: 5 },
];

const startMonthOf = (mode) =>
  PERIOD_MODES.find((p) => p.id === mode)?.startMonth || 1;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * 'YYYY-MM' out of anything the database hands back.
 *
 * The leading slice is not laziness — it is the only correct reading of the two
 * shapes that arrive here:
 *
 *   'YYYY-MM-DD'  a plain `date` column (expenses.spent_on). Feeding this to
 *                 `new Date()` parses it as UTC midnight, which west of
 *                 Greenwich lands on the previous day and moves anything spent
 *                 on the 1st into the month before.
 *   ISO timestamp `payment_transactions.created_at`. When the office records a
 *                 cash payment the column is written as the chosen day's UTC
 *                 midnight, so slicing hands back exactly the date the admin
 *                 picked. Reading it in local time would be the thing that
 *                 shifts it.
 *
 * The residual case is a student-submitted payment approved in the last hours
 * of a UTC month, which lands in that month rather than the next. Nobody
 * reconciles a college's books to the hour, and the alternative breaks the
 * admin-entered path, which is the one that carries the money.
 */
export function monthKeyOf(value) {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** '2026-08' -> 'August 2026'. */
export function monthLabelOf(key) {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!y || !m) return key || "";
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** '2026-08' -> 'Aug 26', for a table column that has to stay narrow. */
export function shortMonthOf(key) {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!y || !m) return key || "";
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
}

/**
 * The twelve months of a period, in order.
 *
 * A financial year is named for the calendar year it starts in: 2026 means
 * May 2026 through April 2027.
 */
export function monthsOfPeriod(year, mode = "calendar") {
  const startMonth = startMonthOf(mode);
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const m = startMonth + i;
    const y = year + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12) + 1;
    out.push(`${y}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

/** Human name for a period, e.g. 'FY 2026–27' for May 2026 – April 2027. */
export function periodLabelOf(year, mode = "calendar") {
  return startMonthOf(mode) === 1
    ? String(year)
    : `FY ${year}–${String(year + 1).slice(2)}`;
}

/** The first and last day of a period, as 'YYYY-MM-DD' — for query bounds. */
export function periodRangeOf(year, mode = "calendar") {
  const months = monthsOfPeriod(year, mode);
  const first = months[0];
  const last = months[months.length - 1];
  const [ly, lm] = last.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
  return { from: `${first}-01`, to: `${last}-${String(lastDay).padStart(2, "0")}` };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The whole ledger for one period.
 *
 * Every month of the period gets a row even when nothing happened in it — a
 * gap in the table would read as "no data yet" when it actually means the
 * college neither earned nor spent, and the two are not the same statement.
 *
 * Rows dated outside `months` are ignored rather than folded into the nearest
 * month, so the totals always equal the sum of the rows shown. Anything the
 * caller wants counted has to be in the period it asked for.
 */
export function buildLedger({ months = [], payments = [], salaries = [], expenses = [] } = {}) {
  const blank = () => ({
    income: 0,
    salaryPaid: 0,
    salaryPayable: 0,
    misc: 0,
    byCategory: {},
    expenseCount: 0,
  });

  const bucket = new Map(months.map((m) => [m, blank()]));

  // Only money that actually arrived. A pending or rejected transaction is not
  // income, and counting it is how the books end up ahead of the bank.
  payments.forEach((p) => {
    if (p?.status !== "Success") return;
    const b = bucket.get(monthKeyOf(p.created_at));
    if (b) b.income += num(p.amount);
  });

  // `month` on a salary row is already 'YYYY-MM' — it is the month worked, not
  // the day the wage was handed over. That is the right grouping here: an April
  // salary paid in May is April's cost.
  salaries.forEach((s) => {
    const b = bucket.get(String(s?.month || ""));
    if (!b) return;
    b.salaryPaid += num(s.paid_amount);
    b.salaryPayable += Math.max(num(s.net_payable) - num(s.paid_amount), 0);
  });

  expenses.forEach((e) => {
    const b = bucket.get(monthKeyOf(e?.spent_on));
    if (!b) return;
    const amount = num(e.amount);
    b.misc += amount;
    b.expenseCount += 1;
    const key = e.category || "Other";
    b.byCategory[key] = (b.byCategory[key] || 0) + amount;
  });

  const rows = months.map((month) => {
    const b = bucket.get(month) || blank();
    const outgoing = b.salaryPaid + b.misc;
    return {
      month,
      label: monthLabelOf(month),
      income: b.income,
      salaryPaid: b.salaryPaid,
      salaryPayable: b.salaryPayable,
      misc: b.misc,
      expenses: outgoing,
      net: b.income - outgoing,
      byCategory: b.byCategory,
      expenseCount: b.expenseCount,
      // A month nobody has touched yet is not a month that broke even. The
      // screen greys these out rather than printing a confident Rs 0 profit,
      // the same reason a report never prints 0 for a mark nobody entered.
      empty: b.income === 0 && outgoing === 0 && b.salaryPayable === 0,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      income: acc.income + r.income,
      salaryPaid: acc.salaryPaid + r.salaryPaid,
      salaryPayable: acc.salaryPayable + r.salaryPayable,
      misc: acc.misc + r.misc,
      expenses: acc.expenses + r.expenses,
      net: acc.net + r.net,
    }),
    { income: 0, salaryPaid: 0, salaryPayable: 0, misc: 0, expenses: 0, net: 0 }
  );

  // Category totals across the whole period, biggest first — the answer to
  // "where is the money going" that a month-by-month table cannot give.
  const byCategory = {};
  rows.forEach((r) => {
    Object.entries(r.byCategory).forEach(([k, v]) => {
      byCategory[k] = (byCategory[k] || 0) + v;
    });
  });
  const categories = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const active = rows.filter((r) => !r.empty);

  return {
    rows,
    totals,
    categories,
    monthsWithActivity: active.length,
    bestMonth: active.reduce((best, r) => (best === null || r.net > best.net ? r : best), null),
    worstMonth: active.reduce((worst, r) => (worst === null || r.net < worst.net ? r : worst), null),
  };
}

/** 'Profit' / 'Loss' / 'Break-even' — one definition, never re-derived in a component. */
export function resultOf(net) {
  if (net > 0) return "Profit";
  if (net < 0) return "Loss";
  return "Break-even";
}

/** Rs 1,23,456 — the app writes amounts this way everywhere else. */
export function formatMoney(value) {
  return `Rs ${Math.round(num(value)).toLocaleString("en-PK")}`;
}

/** A signed amount, so a loss reads as one at a glance. */
export function formatSigned(value) {
  const n = Math.round(num(value));
  if (n < 0) return `− ${formatMoney(Math.abs(n))}`;
  return formatMoney(n);
}
