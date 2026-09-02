import { useState, useEffect, useMemo, useCallback } from "react";
import { Download, Wallet } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  computeSalary,
  isCorrected,
  salaryStatusFor,
  monthKeyOf,
  monthLabel,
  monthRange,
  recentMonths,
  isPerDayType,
  formatMoney,
  formatDays,
} from "../../lib/payroll";
import "./TeacherSalary.css";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * A teacher's own pay, in her own portal.
 *
 * **This needs no new right and no new policy.** `staff_attendance_select` and
 * `staff_salaries_select` already allow `is_this_teacher(teacher_id)`, so the
 * queries below return her rows and nobody else's — the database is what scopes
 * this, not the UI. Salary is deliberately not gated behind `teachers.rights[]`
 * either: a right is something the admin grants, and her own pay is not the
 * admin's to withhold.
 *
 * Every figure is recomputed here with the same `computeSalary()` the admin
 * screen uses, from the same attendance rows. That is the point — the slip she
 * downloads cannot disagree with the sheet the office is working from, because
 * neither of them stores the answer.
 */
export default function TeacherSalary({ teacher }) {
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [attendance, setAttendance] = useState({});
  const [holidays, setHolidays] = useState([]);
  const [stored, setStored] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const months = useMemo(() => recentMonths(12), []);

  // Pulled out of the closure rather than read as `teacher?.id` inside it: the
  // React Compiler infers the whole `teacher` object as the dependency of an
  // optional chain, which does not match the narrower list written here.
  const teacherId = teacher?.id;

  const load = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError("");
    const { from, to } = monthRange(month);

    const [attendanceRes, holidayRes, salaryRes, historyRes] = await Promise.all([
      supabase
        .from("staff_attendance")
        .select("date, status")
        .eq("teacher_id", teacherId)
        .gte("date", from)
        .lte("date", to),
      supabase.from("college_holidays").select("date").gte("date", from).lte("date", to),
      supabase.from("staff_salaries").select("*").eq("teacher_id", teacherId).eq("month", month).maybeSingle(),
      // The whole payment history, so she can see which months are settled
      // without stepping through the picker one month at a time.
      supabase
        .from("staff_salaries")
        .select("month, net_payable, paid_amount, status, paid_on")
        .eq("teacher_id", teacherId)
        .order("month", { ascending: false }),
    ]);

    const firstError = attendanceRes.error || holidayRes.error || historyRes.error;
    if (firstError) setError(firstError.message);

    const map = {};
    (attendanceRes.data || []).forEach((r) => { map[r.date] = r.status; });
    setAttendance(map);
    setHolidays((holidayRes.data || []).map((h) => h.date));
    setStored(salaryRes.data || null);
    setHistory(historyRes.data || []);
    setLoading(false);
  }, [teacherId, month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const calc = useMemo(
    () =>
      computeSalary({
        person: teacher,
        attendance,
        monthKey: month,
        holidays,
        bonus: stored?.bonus || 0,
        otherDeduction: stored?.other_deduction || 0,
        // The office's correction to her present days, if it made one. Read here
        // for the same reason the bonus is: this tab recomputes rather than reads,
        // so anything it leaves out is a way for her slip and the office's sheet
        // to state two different figures.
        presentDaysOverride: stored?.present_days_override ?? null,
      }),
    [teacher, attendance, month, holidays, stored]
  );

  const paidAmount = Number(stored?.paid_amount) || 0;
  const status = salaryStatusFor(calc.netPayable, paidAmount);
  // Regular and Fix Pay are both monthly; only Visiting is paid by the day.
  const isVisiting = isPerDayType(calc.employmentType);
  const hasRate = Number(teacher?.monthly_salary) > 0 || Number(teacher?.per_day_salary) > 0;

  const downloadSlip = async () => {
    setDownloading(true);
    setError("");
    try {
      // Imported here, not at the top: the teacher portal statically imports its
      // tabs, so a top-level import would put the ~400 kB PDF engine in the
      // portal chunk for every teacher who never downloads a slip.
      const { buildPayslipPdf, downloadPayslip } = await import("../../lib/payslipPdf");
      const blob = await buildPayslipPdf(teacher, calc, {
        monthText: monthLabel(month),
        roleLabel: "Teacher",
        status,
        paidAmount,
        paidOn: stored?.paid_on || null,
        notes: stored?.notes || "",
      });
      downloadPayslip(blob, teacher.name, month);
    } catch (err) {
      setError("Could not build the payslip: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (!hasRate) {
    return (
      <div className="tsalary">
        <div className="tsalary__card tsalary__card--empty">
          <Wallet size={28} />
          <p>Your salary has not been set yet.</p>
          <p className="tsalary__hint">
            Once the office records your monthly or per-day rate, this tab will show your
            attendance, the calculation and your payslip for every month.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tsalary">
      <div className="tsalary__toolbar">
        <div className="tsalary__field">
          <label>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <button type="button" onClick={downloadSlip} disabled={loading || downloading} className="tsalary__download">
          <Download size={14} /> {downloading ? "Preparing..." : "Download Payslip (PDF)"}
        </button>
      </div>

      {error && <p className="tsalary__error">{error}</p>}

      {loading ? (
        <p className="tsalary__empty">Loading {monthLabel(month)}...</p>
      ) : (
        <>
          <div className="tsalary__card">
            <div className="tsalary__head">
              <div>
                <p className="tsalary__label">Net payable for {monthLabel(month)}</p>
                <p className="tsalary__net">{formatMoney(calc.netPayable)}</p>
              </div>
              <span className={`tsalary__badge tsalary__badge--${status.replace(/ /g, "-").toLowerCase()}`}>
                {status}
              </span>
            </div>
            <p className="tsalary__terms">
              {isVisiting
                ? `${calc.employmentType} — ${formatMoney(teacher.per_day_salary)} per day worked`
                : `${calc.employmentType} — ${formatMoney(teacher.monthly_salary)} per month`}
              {stored?.paid_on ? ` · paid ${fmtDate(stored.paid_on)}` : ""}
            </p>
            {paidAmount > 0 && status !== "Paid" && (
              <p className="tsalary__terms tsalary__terms--due">
                {formatMoney(paidAmount)} received · {formatMoney(calc.netPayable - paidAmount)} outstanding
              </p>
            )}
          </div>

          <div className="tsalary__card">
            <h3 className="tsalary__section-title">Attendance</h3>
            <div className="tsalary__grid">
              <Stat label="Working days" value={formatDays(calc.workingDays)} />
              <Stat label="Present" value={formatDays(calc.presentDays)} tone="p" />
              <Stat label="Leave" value={formatDays(calc.leaveDays)} tone="l" />
              <Stat label="Absent" value={formatDays(calc.absentDays)} tone="a" />
              {calc.halfDays > 0 && <Stat label="Half days" value={formatDays(calc.halfDays)} tone="h" />}
              <Stat label="Holidays / Sundays" value={formatDays(calc.holidayDays)} />
            </div>
            {isCorrected(calc) && (
              <p className="tsalary__note">
                Your present days for this month were set to <strong>{formatDays(calc.presentDays)}</strong> by
                the office; the daily register itself had recorded {formatDays(calc.registerPresentDays)}. Your
                salary below is worked out from the corrected figure. If it does not match your own record of
                the month, please contact the office.
              </p>
            )}
            {calc.unmarkedDays > 0 && (
              <p className="tsalary__note">
                {formatDays(calc.unmarkedDays)} day{calc.unmarkedDays === 1 ? " has" : "s have"} no entry in the
                register yet. Unmarked days are <strong>never</strong> counted as absence and cost you nothing.
              </p>
            )}
          </div>

          <div className="tsalary__card">
            <h3 className="tsalary__section-title">How this was calculated</h3>
            <table className="tsalary__table">
              <tbody>
                {isVisiting ? (
                  <>
                    <Row label="Rate per day" value={formatMoney(calc.perDayRate)} />
                    <Row label="Paid days" value={formatDays(calc.paidDays)} />
                    <Row
                      label={`Earned (${formatDays(calc.paidDays)} × ${formatMoney(calc.perDayRate)})`}
                      value={formatMoney(calc.baseAmount)}
                    />
                  </>
                ) : (
                  <>
                    <Row label="Monthly salary" value={formatMoney(calc.baseAmount)} />
                    <Row
                      label={`One day's pay (${formatMoney(calc.baseAmount)} ÷ ${formatDays(calc.workingDays)} working days)`}
                      value={formatMoney(calc.perDayRate)}
                    />
                    <Row label="Leave / absent days" value={formatDays(calc.absenceDays)} />
                    <Row label="Allowed free" value={formatDays(calc.freeDays)} />
                    <Row
                      label={
                        calc.chargeableDays > 0
                          ? `Deduction (${formatDays(calc.chargeableDays)} × ${formatMoney(calc.perDayRate)})`
                          : "Deduction"
                      }
                      value={calc.chargeableDays > 0 ? `− ${formatMoney(calc.absenceDeduction)}` : "Nil"}
                      tone={calc.chargeableDays > 0 ? "minus" : undefined}
                    />
                  </>
                )}
                {calc.bonus > 0 && (
                  <Row label="Allowance / bonus" value={`+ ${formatMoney(calc.bonus)}`} tone="plus" />
                )}
                {calc.otherDeduction > 0 && (
                  <Row label="Other deduction" value={`− ${formatMoney(calc.otherDeduction)}`} tone="minus" />
                )}
                <tr className="tsalary__table-total">
                  <td>Net payable</td>
                  <td>{formatMoney(calc.netPayable)}</td>
                </tr>
              </tbody>
            </table>
            {stored?.notes && <p className="tsalary__note">📝 {stored.notes}</p>}
            {!isVisiting && (
              <p className="tsalary__note">
                The first leave or absence each month is free. Holidays and Sundays are not working
                days, so they never reduce your salary.
              </p>
            )}
          </div>

          {history.length > 0 && (
            <div className="tsalary__card">
              <h3 className="tsalary__section-title">Payment History</h3>
              <div className="tsalary__table-wrap">
                <table className="tsalary__table tsalary__table--history">
                  <thead>
                    <tr><th>Month</th><th>Net Payable</th><th>Received</th><th>Status</th><th>Paid On</th></tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.month}>
                        <td>{monthLabel(h.month)}</td>
                        <td>{formatMoney(h.net_payable)}</td>
                        <td>{formatMoney(h.paid_amount)}</td>
                        <td>
                          <span className={`tsalary__badge tsalary__badge--${String(h.status || "Unpaid").replace(/ /g, "-").toLowerCase()}`}>
                            {h.status || "Unpaid"}
                          </span>
                        </td>
                        <td>{h.paid_on ? fmtDate(h.paid_on) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tsalary__note">
                A month appears here once the office has opened it on the salary sheet. Months not
                listed are still being processed.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="tsalary__stat">
      <p className={`tsalary__stat-value ${tone ? `tsalary__stat-value--${tone}` : ""}`}>{value}</p>
      <p className="tsalary__stat-label">{label}</p>
    </div>
  );
}

function Row({ label, value, tone }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={tone ? `tsalary__amount--${tone}` : ""}>{value}</td>
    </tr>
  );
}
