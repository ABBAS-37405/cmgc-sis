import { useState, useEffect, useMemo, useCallback } from "react";
import { CalendarDays, Wallet, Check, Save, CalendarOff, Download } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber } from "../../lib/whatsapp";
import { roleLabelFor } from "../../lib/staff";
import {
  ATTENDANCE_STATUSES,
  computeSalary,
  salaryStatusFor,
  salaryRowFor,
  buildSalaryMessage,
  ownerColumnFor,
  monthKeyOf,
  monthLabel,
  monthRange,
  recentMonths,
  employmentTypeOf,
  formatMoney,
  formatDays,
} from "../../lib/payroll";
import "./StaffPayroll.css";

const today = () => new Date().toISOString().split("T")[0];

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * One key for a person across both rosters. A teacher and a staff member can
 * never share a UUID in practice, but keying on the pair rather than the bare id
 * means nothing silently merges if they ever did — and it reads as what it is.
 */
const keyOf = (person) => `${person.kind}:${person.id}`;

/** The same key, derived from an attendance or salary row's two foreign keys. */
const keyOfRow = (row) => (row.staff_id ? `staff:${row.staff_id}` : `teacher:${row.teacher_id}`);

/** Which unique index an upsert for this person must target. */
const conflictFor = (person, column) => `${ownerColumnFor(person)},${column}`;

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.46 0 .09 5.37.09 11.95c0 2.11.55 4.09 1.51 5.81L0 24l6.4-1.68a11.86 11.86 0 0 0 5.64 1.43h.01c6.58 0 11.95-5.37 11.95-11.95 0-3.19-1.24-6.19-3.48-8.32ZM12.05 21.3h-.01a9.3 9.3 0 0 1-4.74-1.3l-.34-.2-3.53.93.94-3.44-.22-.35a9.3 9.3 0 0 1-1.43-4.99c0-5.14 4.19-9.33 9.34-9.33 2.49 0 4.83.97 6.59 2.73a9.26 9.26 0 0 1 2.73 6.6c0 5.15-4.19 9.35-9.33 9.35Zm5.34-6.98c-.29-.15-1.72-.85-1.99-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.3-.36.45-.54.15-.18.2-.31.3-.51.1-.2.05-.37-.03-.51-.08-.15-.6-1.46-.82-2-.22-.53-.44-.46-.6-.47-.16-.01-.34-.01-.52-.01-.18 0-.47.07-.72.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.13 2.86.14.18 1.86 2.84 4.5 3.87 2.65 1.03 2.65.69 3.12.64.47-.05 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.24-.16-.53-.31Z" />
    </svg>
  );
}

/**
 * Their WhatsApp number, prompting for one if what is on file is unusable.
 * `whatsapp` first, `phone` only as a fallback — the two are often different.
 */
function resolveNumber(person) {
  let number = whatsappNumberFor(person);
  if (isValidWhatsAppNumber(number)) return number;
  const entered = window.prompt(
    `WhatsApp number for ${person.name} is missing or invalid. Enter one (03XXXXXXXXX):`,
    number || ""
  );
  if (!entered || !entered.trim()) return null;
  return entered.trim();
}

const GROUPS = [
  { id: "all", label: "Everyone" },
  { id: "teacher", label: "Teaching" },
  { id: "staff", label: "Non-Teaching" },
];

/**
 * Attendance and salary for everyone the college pays.
 *
 * The two rosters are separate tables — a guard has no subjects and no login, so
 * he is not a `teachers` row — but they price identically, so this screen merges
 * them into one list of `person` objects carrying `kind`. That `kind` is the only
 * thing that differs downstream: it decides whether a row is written against
 * `teacher_id` or `staff_id`.
 */
export default function StaffPayroll({ teachers = [], staff = [] }) {
  const [view, setView] = useState("attendance");
  const [group, setGroup] = useState("all");

  const people = useMemo(() => {
    const merged = [
      ...teachers.map((t) => ({ ...t, kind: "teacher" })),
      ...staff.map((s) => ({ ...s, kind: "staff" })),
    ];
    // Retired and left staff keep their history but should not appear on a live register.
    return merged
      .filter((p) => !p.left_date && (p.kind === "teacher" || p.is_active !== false))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teachers, staff]);

  const roster = useMemo(
    () => (group === "all" ? people : people.filter((p) => p.kind === group)),
    [people, group]
  );

  return (
    <div className="payroll">
      <div className="payroll__switch" role="group" aria-label="Attendance or salary">
        <button
          type="button"
          onClick={() => setView("attendance")}
          className={`payroll__switch-btn ${view === "attendance" ? "payroll__switch-btn--active" : ""}`}
        >
          <CalendarDays size={15} /> Daily Attendance
        </button>
        <button
          type="button"
          onClick={() => setView("salary")}
          className={`payroll__switch-btn ${view === "salary" ? "payroll__switch-btn--active" : ""}`}
        >
          <Wallet size={15} /> Monthly Salary
        </button>

        <div className="payroll__group" role="group" aria-label="Filter by staff type">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              className={`payroll__group-btn ${group === g.id ? "payroll__group-btn--active" : ""}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {view === "attendance" ? (
        <DailyRegister roster={roster} />
      ) : (
        <MonthlySalary roster={roster} />
      )}
    </div>
  );
}

/* ==================================================================== */
/* Daily attendance register                                            */
/* ==================================================================== */

function DailyRegister({ roster }) {
  const [date, setDate] = useState(today());
  const [records, setRecords] = useState({});
  const [holiday, setHoliday] = useState(null); // the college_holidays row for this date
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyMarked, setAlreadyMarked] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (roster.length === 0) return;
    setLoading(true);
    setError("");

    const [{ data: rows, error: rowsError }, { data: holidayRow }] = await Promise.all([
      supabase.from("staff_attendance").select("teacher_id, staff_id, status").eq("date", date),
      supabase.from("college_holidays").select("*").eq("date", date).maybeSingle(),
    ]);

    if (rowsError) setError(rowsError.message);

    const savedRows = {};
    (rows || []).forEach((r) => { savedRows[keyOfRow(r)] = r.status; });

    // Unmarked people default to Present, exactly like the student register —
    // except on a holiday, where nobody is marked at all.
    const initial = {};
    roster.forEach((p) => {
      const key = keyOf(p);
      if (savedRows[key]) initial[key] = savedRows[key];
      else if (!holidayRow) initial[key] = "Present";
    });

    setRecords(initial);
    setHoliday(holidayRow || null);
    setAlreadyMarked(Object.keys(savedRows).length > 0);
    setSaved(false);
    setLoading(false);
  }, [date, roster]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const setStatus = (key, status) => {
    setRecords((p) => ({ ...p, [key]: status }));
    setSaved(false);
  };

  const setAll = (status) => {
    const next = {};
    roster.forEach((p) => { next[keyOf(p)] = status; });
    setRecords(next);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");

    const marked = roster.filter((p) => records[keyOf(p)]);
    if (marked.length === 0) {
      setSaving(false);
      setError("Nothing to save — nobody has a status for this date.");
      return;
    }

    // Two upserts, not one: a teacher row conflicts on (teacher_id, date) and a
    // staff row on (staff_id, date), and PostgREST takes a single conflict target
    // per request. Splitting here is what keeps both unique indexes honoured.
    const batches = [
      { people: marked.filter((p) => p.kind === "teacher"), conflict: "teacher_id,date" },
      { people: marked.filter((p) => p.kind === "staff"), conflict: "staff_id,date" },
    ].filter((b) => b.people.length > 0);

    let written = 0;
    for (const batch of batches) {
      const rows = batch.people.map((p) => ({
        [ownerColumnFor(p)]: p.id,
        date,
        status: records[keyOf(p)],
      }));
      const { data, error: dbError } = await supabase
        .from("staff_attendance")
        .upsert(rows, { onConflict: batch.conflict })
        .select("id");

      if (dbError) {
        setSaving(false);
        return setError(dbError.message);
      }
      written += (data || []).length;
    }

    setSaving(false);
    // A refused write comes back as success with zero rows, never as an error.
    if (written === 0) return setError(WRITE_BLOCKED_HINT);

    setSaved(true);
    setAlreadyMarked(true);
  };

  /**
   * Declaring a holiday. A day in `college_holidays` is not a working day, so it
   * neither deducts from a Regular salary nor pays a Visiting one — which means
   * any attendance already marked for it would only be misleading, and is offered
   * for deletion the way MarkAttendance offers it for students.
   */
  const markHoliday = async () => {
    const title = window.prompt(`Why is the college closed on ${fmtDate(date)}? (e.g. Eid-ul-Fitr)`, "");
    if (title === null) return;

    const { data, error: dbError } = await supabase
      .from("college_holidays")
      .upsert({ date, title: title.trim() || "Holiday" }, { onConflict: "date" })
      .select("date");

    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);

    if (alreadyMarked && window.confirm("Attendance is already marked for this date. Delete it, since it is now a holiday?")) {
      await supabase.from("staff_attendance").delete().eq("date", date);
    }
    await load();
  };

  const clearHoliday = async () => {
    if (!window.confirm(`Remove the holiday on ${fmtDate(date)}? It becomes a working day again.`)) return;
    const { data, error: dbError } = await supabase
      .from("college_holidays").delete().eq("date", date).select("date");
    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);
    await load();
  };

  const counts = ATTENDANCE_STATUSES.map((s) => ({
    ...s,
    count: roster.filter((p) => records[keyOf(p)] === s.id).length,
  }));

  return (
    <div className="payroll__section">
      <div className="payroll__toolbar">
        <div className="payroll__field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="payroll__toolbar-actions">
          {holiday ? (
            <button type="button" onClick={clearHoliday} className="payroll__ghost-btn">
              <CalendarOff size={14} /> Remove Holiday
            </button>
          ) : (
            <button type="button" onClick={markHoliday} className="payroll__ghost-btn">
              <CalendarOff size={14} /> Mark as Holiday
            </button>
          )}
        </div>
      </div>

      {holiday && (
        <div className="payroll__banner payroll__banner--holiday">
          🏝️ <strong>{holiday.title || "Holiday"}</strong> — the college is closed on {fmtDate(date)}.
          Regular staff lose nothing for it; Visiting and daily-wage staff are not paid for it.
        </div>
      )}

      {alreadyMarked && !saved && !holiday && (
        <div className="payroll__banner">⚠️ Attendance for this date is already saved — saving again will overwrite it.</div>
      )}

      {error && <p className="payroll__error">{error}</p>}

      {loading ? (
        <p className="payroll__empty">Loading...</p>
      ) : roster.length === 0 ? (
        <p className="payroll__empty">Nobody on the register yet. Add teachers or staff from the tabs above.</p>
      ) : (
        <>
          <div className="payroll__summary">
            {counts.map((c) => (
              <span key={c.id} className={`payroll__count payroll__count--${c.short.toLowerCase()}`}>
                {c.label}: {c.count}
              </span>
            ))}
            <div className="payroll__bulk">
              <span className="payroll__bulk-label">Mark all:</span>
              {ATTENDANCE_STATUSES.map((s) => (
                <button key={s.id} type="button" onClick={() => setAll(s.id)} className="payroll__bulk-btn">
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="payroll__rows">
            {roster.map((p) => (
              <div key={keyOf(p)} className="payroll__row">
                <div className="payroll__row-info">
                  <p className="payroll__row-name">
                    {p.name}
                    <span className="payroll__role">{roleLabelFor(p)}</span>
                    <span className={`payroll__type payroll__type--${employmentTypeOf(p).toLowerCase()}`}>
                      {employmentTypeOf(p)}
                    </span>
                  </p>
                  <p className="payroll__row-meta">
                    {employmentTypeOf(p) === "Visiting"
                      ? `${formatMoney(p.per_day_salary)} / day`
                      : `${formatMoney(p.monthly_salary)} / month`}
                    {p.kind === "staff" && p.department ? ` · ${p.department}` : ""}
                    {p.kind === "teacher" && (p.subjects || []).length > 0 ? ` · ${(p.subjects || []).join(", ")}` : ""}
                  </p>
                </div>
                <div className="payroll__row-btns">
                  {ATTENDANCE_STATUSES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStatus(keyOf(p), s.id)}
                      className={
                        `payroll__status-btn payroll__status-btn--${s.short.toLowerCase()} ` +
                        (records[keyOf(p)] === s.id ? "payroll__status-btn--active" : "")
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={save} disabled={saving} className="payroll__save">
            {saving ? "Saving..." : "Save Attendance"}
          </button>
          {saved && (
            <p className="payroll__confirm"><Check size={14} /> Saved for {fmtDate(date)}</p>
          )}
        </>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Monthly salary                                                       */
/* ==================================================================== */

function MonthlySalary({ roster }) {
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [attendance, setAttendance] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [salaries, setSalaries] = useState({}); // person key -> staff_salaries row
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [draft, setDraft] = useState({ bonus: "", other_deduction: "", notes: "" });
  const [busyKey, setBusyKey] = useState(null);
  const [waQueue, setWaQueue] = useState(null); // { list, index }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { from, to } = monthRange(month);

    const [attendanceRes, holidayRes, salaryRes] = await Promise.all([
      supabase.from("staff_attendance").select("teacher_id, staff_id, date, status").gte("date", from).lte("date", to),
      supabase.from("college_holidays").select("date, title").gte("date", from).lte("date", to),
      supabase.from("staff_salaries").select("*").eq("month", month),
    ]);

    const firstError = attendanceRes.error || holidayRes.error || salaryRes.error;
    if (firstError) setError(firstError.message);

    setAttendance(attendanceRes.data || []);
    setHolidays((holidayRes.data || []).map((h) => h.date));

    const map = {};
    (salaryRes.data || []).forEach((r) => { map[keyOfRow(r)] = r; });
    setSalaries(map);
    setLoading(false);
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /** date -> status map for one person, out of the flat month query. */
  const attendanceFor = useCallback(
    (person) => {
      const key = keyOf(person);
      const out = {};
      attendance.forEach((r) => { if (keyOfRow(r) === key) out[r.date] = r.status; });
      return out;
    },
    [attendance]
  );

  /**
   * Every figure is recomputed here rather than read from `staff_salaries`, so a
   * corrected attendance mark changes the payslip immediately. Only bonus, other
   * deduction and notes come from the stored row — they are the parts that cannot
   * be derived from anything.
   */
  const rows = useMemo(() => {
    const byPerson = new Map();
    attendance.forEach((r) => {
      const key = keyOfRow(r);
      if (!byPerson.has(key)) byPerson.set(key, {});
      byPerson.get(key)[r.date] = r.status;
    });

    return roster.map((person) => {
      const key = keyOf(person);
      const stored = salaries[key] || null;
      const calc = computeSalary({
        person,
        attendance: byPerson.get(key) || {},
        monthKey: month,
        holidays,
        bonus: stored?.bonus || 0,
        otherDeduction: stored?.other_deduction || 0,
      });
      const paidAmount = Number(stored?.paid_amount) || 0;
      return { key, person, calc, stored, paidAmount, status: salaryStatusFor(calc.netPayable, paidAmount) };
    });
  }, [roster, attendance, holidays, salaries, month]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      net: acc.net + r.calc.netPayable,
      paid: acc.paid + r.paidAmount,
      deduction: acc.deduction + r.calc.absenceDeduction,
    }),
    { net: 0, paid: 0, deduction: 0 }
  ), [rows]);

  /** Upserts the whole snapshot for one person. Everything that writes goes through here. */
  const persist = async (row, extra) => {
    const payload = {
      ...salaryRowFor(row.person, row.calc, {
        bonus: row.calc.bonus,
        other_deduction: row.calc.otherDeduction,
        notes: row.stored?.notes || null,
        paid_amount: row.paidAmount,
        status: row.status,
        paid_on: row.stored?.paid_on || null,
        payment_method: row.stored?.payment_method || null,
        updated_at: new Date().toISOString(),
      }),
      ...extra,
    };

    const { data, error: dbError } = await supabase
      .from("staff_salaries")
      .upsert(payload, { onConflict: conflictFor(row.person, "month") })
      .select("*");

    if (dbError) throw new Error(dbError.message);
    if (!data || data.length === 0) throw new Error(WRITE_BLOCKED_HINT);
    return data[0];
  };

  const runWrite = async (row, extra) => {
    setBusyKey(row.key);
    setError("");
    try {
      const savedRow = await persist(row, extra);
      setSalaries((prev) => ({ ...prev, [row.key]: savedRow }));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const startEdit = (row) => {
    setExpanded(row.key);
    setDraft({
      bonus: row.calc.bonus ? String(row.calc.bonus) : "",
      other_deduction: row.calc.otherDeduction ? String(row.calc.otherDeduction) : "",
      notes: row.stored?.notes || "",
    });
  };

  const saveEdit = async (row) => {
    const bonus = Number(draft.bonus) || 0;
    const otherDeduction = Number(draft.other_deduction) || 0;
    // Recompute with the new adjustments so the stored snapshot and the derived
    // status agree with what the screen is about to show.
    const calc = computeSalary({
      person: row.person,
      attendance: attendanceFor(row.person),
      monthKey: month,
      holidays,
      bonus,
      otherDeduction,
    });
    const ok = await runWrite(
      { ...row, calc },
      {
        bonus,
        other_deduction: otherDeduction,
        notes: draft.notes.trim() || null,
        status: salaryStatusFor(calc.netPayable, row.paidAmount),
      }
    );
    if (ok) setExpanded(null);
  };

  const markPaid = async (row) => {
    if (row.calc.netPayable <= 0) {
      setError(`${row.person.name} has nothing payable for ${monthLabel(month)}.`);
      return;
    }
    if (!window.confirm(`Record ${formatMoney(row.calc.netPayable)} paid to ${row.person.name} for ${monthLabel(month)}?`)) return;
    await runWrite(row, {
      paid_amount: row.calc.netPayable,
      status: "Paid",
      paid_on: today(),
      payment_method: "Cash",
    });
  };

  const recordPartial = async (row) => {
    const entered = window.prompt(
      `How much was paid to ${row.person.name} for ${monthLabel(month)}? (Net payable ${formatMoney(row.calc.netPayable)})`,
      String(row.paidAmount || "")
    );
    if (entered === null) return;
    const amount = Number(entered);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid amount.");
      return;
    }
    await runWrite(row, {
      paid_amount: amount,
      status: salaryStatusFor(row.calc.netPayable, amount),
      paid_on: amount > 0 ? today() : null,
    });
  };

  const markUnpaid = async (row) => {
    if (!window.confirm(`Undo the payment recorded for ${row.person.name}?`)) return;
    await runWrite(row, { paid_amount: 0, status: "Unpaid", paid_on: null, payment_method: null });
  };

  /**
   * The same payslip the teacher can download from her own portal — same lib,
   * same `calc`, so the office and the employee are never holding two documents
   * that disagree. `import()`ed here rather than at the top: jsPDF is ~400 kB and
   * the admin chunk should not carry it for an admin who never downloads a slip.
   */
  const downloadSlip = async (row) => {
    setBusyKey(row.key);
    setError("");
    try {
      const { buildPayslipPdf, downloadPayslip } = await import("../../lib/payslipPdf");
      const blob = await buildPayslipPdf(row.person, row.calc, {
        monthText: monthLabel(month),
        roleLabel: roleLabelFor(row.person),
        status: row.status,
        paidAmount: row.paidAmount,
        paidOn: row.stored?.paid_on || null,
        notes: row.stored?.notes || "",
      });
      downloadPayslip(blob, row.person.name, month);
    } catch (err) {
      setError("Could not build the payslip: " + err.message);
    } finally {
      setBusyKey(null);
    }
  };

  const sendOne = (row, windowRef) => {
    const number = resolveNumber(row.person);
    if (!number) return false;
    const message = buildSalaryMessage(row.person, row.calc, {
      paidAmount: row.paidAmount,
      status: row.status,
      notes: row.stored?.notes || "",
      roleLabel: row.person.kind === "staff" ? roleLabelFor(row.person) : "",
    });
    return openWhatsApp(number, message, windowRef);
  };

  // A queue, not a loop: window.open fired repeatedly in one tick gets blocked
  // after the first tab, and WhatsApp Web drops chats pushed at it in the same second.
  const startQueue = () => {
    const list = rows.filter((r) => isValidWhatsAppNumber(whatsappNumberFor(r.person)));
    if (list.length === 0) {
      setError("Nobody on this sheet has a usable WhatsApp number.");
      return;
    }
    setWaQueue({ list, index: 0 });
  };

  const sendNext = () => {
    if (!waQueue) return;
    sendOne(waQueue.list[waQueue.index]);
    const next = waQueue.index + 1;
    if (next >= waQueue.list.length) setWaQueue(null);
    else setWaQueue({ list: waQueue.list, index: next });
  };

  const downloadCsv = () => {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      [cell("Community Model Girls College")],
      [cell(`Salary Sheet — ${monthLabel(month)}`)],
      [cell(`Generated: ${fmtDate(today())}`)],
      [],
      [
        "Name", "Role", "Department", "Type", "Rate", "Working Days", "Present", "Absent",
        "Leave", "Half Day", "Holidays", "Not Marked", "Deducted Days", "Base", "Deduction",
        "Bonus", "Other Deduction", "Net Payable", "Paid", "Status", "Paid On", "Notes",
      ].map(cell),
      ...rows.map((r) => [
        r.person.name, roleLabelFor(r.person),
        r.person.kind === "staff" ? (r.person.department || "") : "Teaching",
        r.calc.employmentType, r.calc.perDayRate, r.calc.workingDays,
        r.calc.presentDays, r.calc.absentDays, r.calc.leaveDays, r.calc.halfDays,
        r.calc.holidayDays, r.calc.unmarkedDays, r.calc.chargeableDays, r.calc.baseAmount,
        r.calc.absenceDeduction, r.calc.bonus, r.calc.otherDeduction, r.calc.netPayable,
        r.paidAmount, r.status, r.stored?.paid_on || "", r.stored?.notes || "",
      ].map(cell)),
      [],
      [cell("TOTAL"), ...Array(16).fill(cell("")), cell(Math.round(totals.net)), cell(Math.round(totals.paid))],
    ];
    const blob = new Blob([lines.map((l) => l.join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Salary_Sheet_${month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="payroll__section">
      <div className="payroll__toolbar">
        <div className="payroll__field">
          <label>Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {recentMonths(12).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <div className="payroll__toolbar-actions">
          <button type="button" onClick={downloadCsv} disabled={rows.length === 0} className="payroll__ghost-btn">
            <Download size={14} /> Salary Sheet (CSV)
          </button>
          <button type="button" onClick={startQueue} disabled={rows.length === 0} className="payroll__wa-btn">
            <WhatsappIcon /> Send Slips to All
          </button>
        </div>
      </div>

      {error && <p className="payroll__error">{error}</p>}

      {waQueue && (
        <div className="payroll__banner payroll__banner--queue">
          <div>
            <strong>{waQueue.list[waQueue.index]?.person.name}</strong>
            <span> — chat {waQueue.index + 1} of {waQueue.list.length}. Open it, press <b>Send</b> in WhatsApp, then come back for the next.</span>
            <span className="payroll__queue-tip">The slip is copied to your clipboard too — if the chat opens empty, press Ctrl+V.</span>
          </div>
          <div className="payroll__queue-actions">
            <button type="button" className="payroll__wa-btn" onClick={sendNext}>
              <WhatsappIcon /> Open chat {waQueue.index + 1}
            </button>
            <button type="button" className="payroll__ghost-btn" onClick={() => setWaQueue(null)}>Stop</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="payroll__empty">Loading {monthLabel(month)}...</p>
      ) : rows.length === 0 ? (
        <p className="payroll__empty">Nobody on the register yet.</p>
      ) : (
        <>
          <div className="payroll__stat-row">
            <div className="payroll__stat">
              <p className="payroll__stat-value">{rows.length}</p>
              <p className="payroll__stat-label">On Payroll</p>
            </div>
            <div className="payroll__stat">
              <p className="payroll__stat-value">{formatMoney(totals.net)}</p>
              <p className="payroll__stat-label">Total Payable</p>
            </div>
            <div className="payroll__stat">
              <p className="payroll__stat-value">{formatMoney(totals.paid)}</p>
              <p className="payroll__stat-label">Paid So Far</p>
            </div>
            <div className="payroll__stat">
              <p className="payroll__stat-value">{formatMoney(totals.net - totals.paid)}</p>
              <p className="payroll__stat-label">Outstanding</p>
            </div>
            <div className="payroll__stat">
              <p className="payroll__stat-value">{formatMoney(totals.deduction)}</p>
              <p className="payroll__stat-label">Absence Deductions</p>
            </div>
          </div>

          <div className="payroll__cards">
            {rows.map((row) => (
              <SalaryCard
                key={row.key}
                row={row}
                month={month}
                busy={busyKey === row.key}
                expanded={expanded === row.key}
                draft={draft}
                setDraft={setDraft}
                onEdit={() => startEdit(row)}
                onCancelEdit={() => setExpanded(null)}
                onSaveEdit={() => saveEdit(row)}
                onMarkPaid={() => markPaid(row)}
                onPartial={() => recordPartial(row)}
                onUnpaid={() => markUnpaid(row)}
                onWhatsApp={() => sendOne(row)}
                onPayslip={() => downloadSlip(row)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SalaryCard({
  row, month, busy, expanded, draft, setDraft,
  onEdit, onCancelEdit, onSaveEdit, onMarkPaid, onPartial, onUnpaid, onWhatsApp, onPayslip,
}) {
  const { person, calc, stored, paidAmount, status } = row;
  const isVisiting = calc.employmentType === "Visiting";

  return (
    <div className="payroll__card">
      <div className="payroll__card-head">
        <div>
          <p className="payroll__row-name">
            {person.name}
            <span className="payroll__role">{roleLabelFor(person)}</span>
            <span className={`payroll__type payroll__type--${calc.employmentType.toLowerCase()}`}>
              {calc.employmentType}
            </span>
            <span className={`payroll__badge payroll__badge--${status.replace(/ /g, "-").toLowerCase()}`}>
              {status}
            </span>
          </p>
          <p className="payroll__row-meta">
            {isVisiting
              ? `${formatMoney(person.per_day_salary)} per day`
              : `${formatMoney(person.monthly_salary)} per month`}
            {" · one day = "}{formatMoney(calc.perDayRate)}
            {person.kind === "staff" && person.department ? ` · ${person.department}` : ""}
            {stored?.paid_on ? ` · paid ${fmtDate(stored.paid_on)}` : ""}
          </p>
        </div>
        <p className="payroll__net">{formatMoney(calc.netPayable)}</p>
      </div>

      <div className="payroll__chips">
        <span className="payroll__chip">Working {formatDays(calc.workingDays)}</span>
        <span className="payroll__chip payroll__chip--p">Present {formatDays(calc.presentDays)}</span>
        <span className="payroll__chip payroll__chip--l">Leave {formatDays(calc.leaveDays)}</span>
        <span className="payroll__chip payroll__chip--a">Absent {formatDays(calc.absentDays)}</span>
        {calc.halfDays > 0 && <span className="payroll__chip payroll__chip--h">Half {formatDays(calc.halfDays)}</span>}
        <span className="payroll__chip">Holidays {formatDays(calc.holidayDays)}</span>
        {calc.unmarkedDays > 0 && (
          <span className="payroll__chip payroll__chip--warn" title="No register entry — never deducted, but worth filling in">
            Not marked {formatDays(calc.unmarkedDays)}
          </span>
        )}
      </div>

      <div className="payroll__working">
        {isVisiting ? (
          <span>
            {formatDays(calc.paidDays)} paid day{calc.paidDays === 1 ? "" : "s"} × {formatMoney(calc.perDayRate)} = <strong>{formatMoney(calc.baseAmount)}</strong>
          </span>
        ) : calc.chargeableDays > 0 ? (
          <span>
            {formatMoney(calc.baseAmount)} − {formatDays(calc.chargeableDays)} day
            {calc.chargeableDays === 1 ? "" : "s"} × {formatMoney(calc.perDayRate)} ({formatDays(calc.absenceDays)} absent/leave, first {formatDays(calc.freeDays)} free) = <strong>{formatMoney(calc.baseAmount - calc.absenceDeduction)}</strong>
          </span>
        ) : (
          <span>
            {formatMoney(calc.baseAmount)} — {formatDays(calc.absenceDays)} absent/leave day
            {calc.absenceDays === 1 ? "" : "s"}, within the free allowance, <strong>no deduction</strong>.
          </span>
        )}
        {calc.bonus > 0 && <span> + {formatMoney(calc.bonus)} allowance</span>}
        {calc.otherDeduction > 0 && <span> − {formatMoney(calc.otherDeduction)} other</span>}
        {paidAmount > 0 && status !== "Paid" && (
          <span className="payroll__working-due"> · {formatMoney(paidAmount)} received, {formatMoney(calc.netPayable - paidAmount)} remaining</span>
        )}
      </div>

      {stored?.notes && <p className="payroll__note">📝 {stored.notes}</p>}

      {expanded ? (
        <div className="payroll__edit">
          <div className="payroll__edit-row">
            <div className="payroll__field">
              <label>Allowance / Bonus (Rs)</label>
              <input
                type="number" min="0" value={draft.bonus}
                onChange={(e) => setDraft((d) => ({ ...d, bonus: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="payroll__field">
              <label>Other Deduction (Rs)</label>
              <input
                type="number" min="0" value={draft.other_deduction}
                onChange={(e) => setDraft((d) => ({ ...d, other_deduction: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="payroll__field">
              <label>Note (shown on the slip)</label>
              <input
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="e.g. Advance recovered"
              />
            </div>
          </div>
          <div className="payroll__card-actions">
            <button type="button" onClick={onSaveEdit} disabled={busy} className="payroll__primary-btn">
              <Save size={13} /> {busy ? "Saving..." : "Save Adjustments"}
            </button>
            <button type="button" onClick={onCancelEdit} className="payroll__ghost-btn">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="payroll__card-actions">
          {status !== "Paid" && (
            <button type="button" onClick={onMarkPaid} disabled={busy} className="payroll__primary-btn">
              <Check size={13} /> Mark Paid ({formatMoney(calc.netPayable)})
            </button>
          )}
          <button type="button" onClick={onPartial} disabled={busy} className="payroll__ghost-btn">
            Record Amount
          </button>
          <button type="button" onClick={onEdit} className="payroll__ghost-btn">
            Edit Adjustments
          </button>
          <button type="button" onClick={onPayslip} disabled={busy} className="payroll__ghost-btn">
            <Download size={13} /> Payslip
          </button>
          {paidAmount > 0 && (
            <button type="button" onClick={onUnpaid} disabled={busy} className="payroll__ghost-btn payroll__ghost-btn--danger">
              Undo Payment
            </button>
          )}
          <button type="button" onClick={onWhatsApp} className="payroll__wa-btn" title={`Send ${monthLabel(month)} slip`}>
            <WhatsappIcon /> Send Slip
          </button>
        </div>
      )}
    </div>
  );
}
