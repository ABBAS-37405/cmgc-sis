import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Plus, Trash2, AlertCircle, Wallet } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  PERIOD_MODES,
  buildLedger,
  monthsOfPeriod,
  periodRangeOf,
  periodLabelOf,
  monthLabelOf,
  shortMonthOf,
  monthKeyOf,
  resultOf,
  formatMoney,
  formatSigned,
} from "../../lib/accounts";
import "./Accounts.css";

/**
 * Accounts — what came in, what went out, and what is left, by month and for
 * the year.
 *
 * Nothing on this screen is stored that could be recomputed, the same rule the
 * rest of Reports follows. Income is read from `payment_transactions` and the
 * salary bill from `staff_salaries` every time the period changes, so a fee
 * approved or a wage corrected elsewhere in the portal shows up here at once
 * and cannot disagree with the screen it was entered on. The only thing this
 * tab owns is `expenses` — the bills, rent and repairs that live nowhere else.
 *
 * The arithmetic is all in `src/lib/accounts.js`, which touches no database.
 * This component fetches and renders; it does not add up money.
 */

const currentYear = new Date().getFullYear();
const todayIso = () => new Date().toISOString().split("T")[0];

const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => currentYear + 1 - i);

const emptyForm = () => ({
  spent_on: todayIso(),
  category: EXPENSE_CATEGORIES[0],
  description: "",
  amount: "",
  payment_method: PAYMENT_METHODS[0],
});

export default function Accounts({ adminProfile }) {
  const [year, setYear] = useState(currentYear);
  const [mode, setMode] = useState("calendar");

  const [payments, setPayments] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [expenses, setExpenses] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const months = monthsOfPeriod(year, mode);
  const ledger = buildLedger({ months, payments, salaries, expenses });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const { from, to } = periodRangeOf(year, mode);
    const periodMonths = monthsOfPeriod(year, mode);

    const [pay, sal, exp] = await Promise.all([
      supabase
        .from("payment_transactions")
        .select("amount, status, created_at")
        .eq("status", "Success")
        .gte("created_at", from)
        .lte("created_at", `${to}T23:59:59.999Z`),
      // `in` on the exact month keys rather than a text range: `month` is a
      // 'YYYY-MM' string, and a range over strings would quietly include
      // '2026-1' style rows if one ever got written unpadded.
      supabase
        .from("staff_salaries")
        .select("month, paid_amount, net_payable")
        .in("month", periodMonths),
      supabase
        .from("expenses")
        .select("*")
        .gte("spent_on", from)
        .lte("spent_on", to)
        .order("spent_on", { ascending: false }),
    ]);

    // The salary read is the one that can come back empty for a reason other
    // than "no salaries yet": staff_salaries is gated on the `teachers`
    // permission and RLS refuses a read silently. Saying so is better than
    // showing a profit with the entire wage bill missing.
    if (sal.error) {
      setError(
        "The salary figures could not be read, so the expense side of this page is incomplete. " +
        "This normally means your admin session has expired — sign out and back in. (" + sal.error.message + ")"
      );
    } else if (exp.error) {
      setError("Expenses could not be read: " + exp.error.message);
    }

    setPayments(pay.data || []);
    setSalaries(sal.data || []);
    setExpenses(exp.data || []);
    setLoading(false);
  }, [year, mode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, mode]);

  const addExpense = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter an amount greater than zero.");
      return;
    }
    if (!form.spent_on) {
      alert("Pick the date the money was spent.");
      return;
    }

    // Outside the period on screen the row would save and then vanish, which
    // reads as a failed save. Better to say so than to let her wonder.
    if (!months.includes(monthKeyOf(form.spent_on))) {
      const carryOn = window.confirm(
        `${form.spent_on} is outside ${periodLabelOf(year, mode)}, so this expense will not appear in the table below. ` +
        "Save it anyway?"
      );
      if (!carryOn) return;
    }

    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("expenses")
      .insert({
        spent_on: form.spent_on,
        category: form.category,
        description: form.description.trim() || null,
        amount,
        payment_method: form.payment_method,
        recorded_by: adminProfile?.user_id || null,
      })
      .select("id");

    setSaving(false);

    if (insertError) {
      alert("Could not save the expense: " + insertError.message);
      return;
    }
    // A refused write comes back as a plain success with no rows.
    if (!data || data.length === 0) {
      alert(WRITE_BLOCKED_HINT);
      return;
    }

    setForm({ ...emptyForm(), spent_on: form.spent_on, payment_method: form.payment_method });
    await load();
  };

  const removeExpense = async (row) => {
    const ok = window.confirm(
      `Delete this expense?\n\n${row.category} — ${formatMoney(row.amount)} on ${row.spent_on}` +
      (row.description ? `\n${row.description}` : "")
    );
    if (!ok) return;

    const { data, error: delError } = await supabase
      .from("expenses")
      .delete()
      .eq("id", row.id)
      .select("id");

    if (delError) {
      alert("Could not delete: " + delError.message);
      return;
    }
    if (!data || data.length === 0) {
      alert(WRITE_BLOCKED_HINT);
      return;
    }
    await load();
  };

  const netClass = (n) => (n > 0 ? "acct__pos" : n < 0 ? "acct__neg" : "");
  const { totals } = ledger;

  return (
    <div className="mrep__pane">
      <div className="mrep__filters">
        <label className="mrep__field">
          <span>Year</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <label className="mrep__field mrep__field--wide">
          <span>Period</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {PERIOD_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        <label className="mrep__field">
          <span>&nbsp;</span>
          <button type="button" className="mrep__refresh" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "mrep__spin" : ""} /> Refresh
          </button>
        </label>
      </div>

      {error && (
        <div className="mrep__error">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div className="acct__cards">
        <div className="acct__card acct__card--in">
          <span className="acct__card-label">Income — fees received</span>
          <strong className="acct__card-value">{formatMoney(totals.income)}</strong>
          <span className="acct__card-note">Money actually collected in {periodLabelOf(year, mode)}, not fees billed.</span>
        </div>

        <div className="acct__card acct__card--out">
          <span className="acct__card-label">Expenses</span>
          <strong className="acct__card-value">{formatMoney(totals.expenses)}</strong>
          <span className="acct__card-note">
            Salaries {formatMoney(totals.salaryPaid)} &bull; Other {formatMoney(totals.misc)}
            {totals.salaryPayable > 0 && (
              <> &bull; <span className="acct__warn">{formatMoney(totals.salaryPayable)} still owed to staff</span></>
            )}
          </span>
        </div>

        <div className={`acct__card acct__card--net ${netClass(totals.net)}`}>
          <span className="acct__card-label">Net {resultOf(totals.net).toLowerCase()} — {periodLabelOf(year, mode)}</span>
          <strong className="acct__card-value">{formatSigned(totals.net)}</strong>
          <span className="acct__card-note">
            {ledger.monthsWithActivity === 0
              ? "Nothing recorded in this period yet."
              : `Across ${ledger.monthsWithActivity} month${ledger.monthsWithActivity === 1 ? "" : "s"} with activity.`}
          </span>
        </div>
      </div>

      <div className="acct__tablewrap">
        <table className="acct__table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="acct__num">Fee income</th>
              <th className="acct__num">Salaries</th>
              <th className="acct__num">Other expenses</th>
              <th className="acct__num">Total expenses</th>
              <th className="acct__num">Net</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((r) => (
              <tr key={r.month} className={r.empty ? "acct__row--empty" : ""}>
                <td className="acct__month">{shortMonthOf(r.month)}</td>
                <td className="acct__num">{r.empty ? "—" : formatMoney(r.income)}</td>
                <td className="acct__num">{r.empty ? "—" : formatMoney(r.salaryPaid)}</td>
                <td className="acct__num">{r.empty ? "—" : formatMoney(r.misc)}</td>
                <td className="acct__num">{r.empty ? "—" : formatMoney(r.expenses)}</td>
                <td className={`acct__num ${netClass(r.net)}`}>{r.empty ? "—" : formatSigned(r.net)}</td>
                <td>
                  {r.empty ? (
                    <span className="acct__tag acct__tag--none">Nothing recorded</span>
                  ) : (
                    <span className={`acct__tag ${r.net >= 0 ? "acct__tag--pos" : "acct__tag--neg"}`}>
                      {resultOf(r.net)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{periodLabelOf(year, mode)}</td>
              <td className="acct__num">{formatMoney(totals.income)}</td>
              <td className="acct__num">{formatMoney(totals.salaryPaid)}</td>
              <td className="acct__num">{formatMoney(totals.misc)}</td>
              <td className="acct__num">{formatMoney(totals.expenses)}</td>
              <td className={`acct__num ${netClass(totals.net)}`}>{formatSigned(totals.net)}</td>
              <td>
                <span className={`acct__tag ${totals.net >= 0 ? "acct__tag--pos" : "acct__tag--neg"}`}>
                  {resultOf(totals.net)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {ledger.bestMonth && ledger.worstMonth && ledger.monthsWithActivity > 1 && (
        <p className="mrep__hint">
          Best month: <strong>{ledger.bestMonth.label}</strong> at {formatSigned(ledger.bestMonth.net)}.
          {" "}Worst: <strong>{ledger.worstMonth.label}</strong> at {formatSigned(ledger.worstMonth.net)}.
        </p>
      )}

      <div className="acct__split">
        <section className="acct__panel">
          <h3 className="acct__panel-title"><Plus size={15} /> Record an expense</h3>
          <p className="acct__panel-sub">
            Bills, rent, repairs, stationery, fuel — anything the college pays for that is not a salary.
            <strong> Do not enter salaries here:</strong> they are already counted from the Teachers &amp; Staff
            salary sheet, so adding one would charge it twice.
          </p>

          <form className="acct__form" onSubmit={addExpense}>
            <label className="mrep__field">
              <span>Date spent</span>
              <input
                type="date"
                value={form.spent_on}
                onChange={(e) => setForm((f) => ({ ...f, spent_on: e.target.value }))}
                required
              />
            </label>

            <label className="mrep__field">
              <span>Category</span>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            <label className="mrep__field">
              <span>Amount (Rs)</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="e.g. 12500"
                required
              />
            </label>

            <label className="mrep__field">
              <span>Paid by</span>
              <select
                value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="mrep__field mrep__field--grow">
              <span>Description</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. K-Electric bill for July"
              />
            </label>

            <button type="submit" className="acct__submit" disabled={saving}>
              {saving ? "Saving…" : "Add expense"}
            </button>
          </form>
        </section>

        <section className="acct__panel">
          <h3 className="acct__panel-title"><Wallet size={15} /> Where the money went</h3>
          {ledger.categories.length === 0 ? (
            <p className="acct__panel-sub">No expenses recorded for {periodLabelOf(year, mode)} yet.</p>
          ) : (
            <ul className="acct__cats">
              {ledger.categories.map((c) => (
                <li key={c.category}>
                  <span>{c.category}</span>
                  <strong>{formatMoney(c.amount)}</strong>
                </li>
              ))}
              <li className="acct__cats-total">
                <span>Total other expenses</span>
                <strong>{formatMoney(totals.misc)}</strong>
              </li>
            </ul>
          )}
        </section>
      </div>

      <section className="acct__panel">
        <h3 className="acct__panel-title">
          Expenses recorded in {periodLabelOf(year, mode)} ({expenses.length})
        </h3>
        {expenses.length === 0 ? (
          <p className="acct__panel-sub">Nothing yet. Add the first one above.</p>
        ) : (
          <div className="acct__tablewrap">
            <table className="acct__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Month</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Paid by</th>
                  <th className="acct__num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses.map((row) => (
                  <tr key={row.id}>
                    <td>{row.spent_on}</td>
                    <td>{monthLabelOf(monthKeyOf(row.spent_on))}</td>
                    <td>{row.category}</td>
                    <td className="acct__desc">{row.description || "—"}</td>
                    <td>{row.payment_method || "—"}</td>
                    <td className="acct__num">{formatMoney(row.amount)}</td>
                    <td>
                      <button
                        type="button"
                        className="acct__del"
                        onClick={() => removeExpense(row)}
                        title="Delete this expense"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mrep__hint">
        Income counts fee payments marked <strong>Success</strong>, dated by the day of payment. Salaries are the
        amounts actually paid out on the Teachers &amp; Staff salary sheet, charged to the month worked. Nothing here
        is stored as a total — correct a fee or a salary anywhere in the portal and this page changes with it.
      </p>
    </div>
  );
}
