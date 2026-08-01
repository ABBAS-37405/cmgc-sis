import { useState, useEffect } from "react";
import { FileDown, Send, RefreshCw, CheckCircle2, AlertCircle, CalendarRange } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, YEARS } from "../../lib/academics";
import {
  buildMonthlyReports,
  buildReportMessage,
  defaultMonth,
  recentMonths,
  uploadReportPdf,
  logReportSent,
  fetchReportLog,
} from "../../lib/monthlyReport";
import { buildReportPdf, reportFileName } from "../../lib/reportPdf";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber } from "../../lib/whatsapp";
import "./MonthlyReports.css";

const ALL_PROGRAMS = "All Programs";
const MONTHS = recentMonths(18);

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);

/** Attendance below 75% is the number the college acts on, so it is coloured. */
const pctTone = (p, good = 75) => {
  if (p === null || p === undefined) return "";
  if (p >= good) return "mrep__pct--good";
  if (p >= good - 25) return "mrep__pct--mid";
  return "mrep__pct--low";
};

export default function MonthlyReports({ allowedPrograms = [], adminProfile }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [month, setMonth] = useState(defaultMonth);
  const [program, setProgram] = useState(isRestricted ? visiblePrograms[0] || ALL_PROGRAMS : ALL_PROGRAMS);
  const [yearFilter, setYearFilter] = useState("Both");
  const [search, setSearch] = useState("");

  const [reports, setReports] = useState([]);
  const [sentLog, setSentLog] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState("");

  // Sending is a queue, never a loop: browsers block a burst of window.open and
  // WhatsApp Web drops chats pushed at it in the same second. Each click here is
  // a real user gesture, so nothing is blocked. Same pattern as MarkAttendance.
  const [waQueue, setWaQueue] = useState(null); // { list, index }

  const load = async () => {
    setLoading(true);
    setError("");
    setWaQueue(null);
    setNote("");

    let query = supabase
      .from("students")
      .select("id, name, roll_no, program, year_of_study, father_name, phone, whatsapp")
      .is("deleted_at", null)
      .order("program")
      .order("name");

    if (program !== ALL_PROGRAMS) {
      query = query.eq("program", program);
    } else if (isRestricted) {
      // "All Programs" always means all of *hers*, never the whole college.
      query = query.in("program", allowedPrograms);
    }
    if (yearFilter !== "Both") query = query.eq("year_of_study", yearFilter);

    const { data: students, error: dbError } = await query;
    if (dbError) {
      setError(dbError.message);
      setLoading(false);
      return;
    }

    try {
      const built = await buildMonthlyReports(students || [], month);
      setReports(built);
      setSentLog(await fetchReportLog((students || []).map((s) => s.id), month));
    } catch (e) {
      setError(e.message || "Could not build the reports.");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, yearFilter, month]);

  /** PDF + upload, shared by download and send. */
  const generate = async (report) => {
    const blob = await buildReportPdf(report);
    return { blob, url: await uploadReportPdf(report, blob) };
  };

  const download = async (report) => {
    setBusyId(report.student.id);
    setError("");
    try {
      const blob = await buildReportPdf(report);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = reportFileName(report);
      // Firefox ignores a click on a detached node, and revoking the URL in the
      // same tick cancels the download it just started — hence the append and
      // the deferred revoke.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30000);
    } catch (e) {
      setError(e.message || "Could not build the PDF.");
    }
    setBusyId(null);
  };

  /**
   * `windowRef` must be opened by the caller *before* any await — a popup
   * reserved outside the click gesture is blocked. Same reason StudentsList
   * opens its window before awaiting.
   */
  const send = async (report, windowRef) => {
    let number = whatsappNumberFor(report.student);
    if (!isValidWhatsAppNumber(number)) {
      const entered = window.prompt(
        `WhatsApp number for ${report.student.name} is missing or invalid. Enter one (03XXXXXXXXX):`,
        number || ""
      );
      if (!entered || !entered.trim()) {
        if (windowRef && !windowRef.closed) windowRef.close();
        return false;
      }
      number = entered.trim();
    }

    setBusyId(report.student.id);
    setError("");
    try {
      const { url } = await generate(report);
      openWhatsApp(number, buildReportMessage(report, url), windowRef);
      await logReportSent({ report, url, sentBy: adminProfile?.user_id || null });
      setSentLog((prev) => ({
        ...prev,
        [report.student.id]: { file_url: url, sent_at: new Date().toISOString() },
      }));
      setBusyId(null);
      return true;
    } catch (e) {
      if (windowRef && !windowRef.closed) windowRef.close();
      setError(e.message || "Could not send the report.");
      setBusyId(null);
      return false;
    }
  };

  const startQueue = () => {
    const list = filtered.filter((r) => isValidWhatsAppNumber(whatsappNumberFor(r.student)));
    const skipped = filtered.length - list.length;
    if (list.length === 0) {
      setError("None of these students has a usable WhatsApp number on file.");
      return;
    }
    setWaQueue({ list, index: 0 });
    setNote(
      skipped > 0
        ? `${list.length} students queued. ${skipped} skipped — no valid WhatsApp number on file.`
        : `${list.length} students queued.`
    );
  };

  const sendNextInQueue = async () => {
    if (!waQueue) return;
    const report = waQueue.list[waQueue.index];
    // Reserved inside the click, before the PDF work begins.
    const windowRef = window.open("", "_blank");
    await send(report, windowRef);

    const nextIndex = waQueue.index + 1;
    if (nextIndex >= waQueue.list.length) {
      setWaQueue(null);
      setNote(`All ${waQueue.list.length} reports have been opened in WhatsApp.`);
    } else {
      setWaQueue({ ...waQueue, index: nextIndex });
    }
  };

  const filtered = reports.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.student.name?.toLowerCase().includes(q) ||
      r.student.roll_no?.toLowerCase().includes(q)
    );
  });

  const sentCount = filtered.filter((r) => sentLog[r.student.id]).length;

  return (
    <div className="mrep">
      <div className="mrep__head">
        <div>
          <h2 className="mrep__title">Monthly Reports</h2>
          <p className="mrep__sub">
            One PDF per student — attendance, class tests, assignments, term result and fee position.
            Sending opens WhatsApp with a link to her report; you still press Send.
          </p>
        </div>
        <button className="mrep__refresh" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "mrep__spin" : ""} /> Refresh
        </button>
      </div>

      <div className="mrep__filters">
        <label className="mrep__field">
          <span><CalendarRange size={13} /> Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <label className="mrep__field">
          <span>Group</span>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value={ALL_PROGRAMS}>{isRestricted ? "All My Groups" : ALL_PROGRAMS}</option>
            {visiblePrograms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label className="mrep__field">
          <span>Class</span>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="Both">Both</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <label className="mrep__field mrep__field--grow">
          <span>Search</span>
          <input
            type="text"
            placeholder="Name or roll number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="mrep__error"><AlertCircle size={14} /> {error}</p>}
      {note && !error && <p className="mrep__note">{note}</p>}

      {waQueue && (
        <div className="mrep__queue">
          <div>
            <strong>Sending one at a time.</strong>{" "}
            Next: {waQueue.list[waQueue.index].student.name} ({waQueue.index + 1} of {waQueue.list.length})
          </div>
          <div className="mrep__queue-actions">
            <button className="mrep__btn mrep__btn--primary" onClick={sendNextInQueue} disabled={busyId !== null}>
              {busyId !== null ? "Preparing…" : "Open next chat"}
            </button>
            <button className="mrep__btn" onClick={() => { setWaQueue(null); setNote("Queue stopped."); }}>
              Stop
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="mrep__empty">Building reports for {MONTHS.find((m) => m.value === month)?.label}…</p>
      ) : filtered.length === 0 ? (
        <p className="mrep__empty">No students match these filters.</p>
      ) : (
        <>
          <div className="mrep__bar">
            <span>{filtered.length} student{filtered.length === 1 ? "" : "s"} · {sentCount} already sent this month</span>
            {!waQueue && (
              <button className="mrep__btn mrep__btn--primary" onClick={startQueue}>
                <Send size={14} /> Send all on WhatsApp
              </button>
            )}
          </div>

          <div className="mrep__table-wrap">
            <table className="mrep__table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Group / Class</th>
                  <th>Attendance</th>
                  <th>Class Tests</th>
                  <th>Assignments</th>
                  <th>Fee Balance</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const s = r.student;
                  const sent = sentLog[s.id];
                  const busy = busyId === s.id;
                  const noNumber = !isValidWhatsAppNumber(whatsappNumberFor(s));

                  return (
                    <tr key={s.id}>
                      <td>
                        <p className="mrep__name">{s.name}</p>
                        <p className="mrep__roll">{s.roll_no}</p>
                        {sent && (
                          <p className="mrep__sent">
                            <CheckCircle2 size={11} /> Sent{" "}
                            {new Date(sent.sent_at).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}
                          </p>
                        )}
                      </td>
                      <td className="mrep__muted">{s.program}<br />{s.year_of_study}</td>
                      <td>
                        <span className={`mrep__pct ${pctTone(r.attendance.percent)}`}>
                          {pctText(r.attendance.percent)}
                        </span>
                        <span className="mrep__detail">{r.attendance.present}/{r.attendance.marked} days</span>
                      </td>
                      <td>
                        <span className={`mrep__pct ${pctTone(r.tests.percent, 50)}`}>
                          {pctText(r.tests.percent)}
                        </span>
                        <span className="mrep__detail">{r.tests.count} test{r.tests.count === 1 ? "" : "s"}</span>
                      </td>
                      <td>
                        <span className="mrep__detail mrep__detail--strong">
                          {r.assignments.submitted}/{r.assignments.set} submitted
                        </span>
                        {r.assignments.missing > 0 && (
                          <span className="mrep__detail mrep__detail--warn">{r.assignments.missing} missing</span>
                        )}
                      </td>
                      <td>
                        {r.fee.balance > 0 ? (
                          <span className="mrep__pct mrep__pct--low">
                            Rs. {r.fee.balance.toLocaleString("en-PK")}
                          </span>
                        ) : (
                          <span className="mrep__pct mrep__pct--good">Clear</span>
                        )}
                      </td>
                      <td>
                        <div className="mrep__actions">
                          <button
                            className="mrep__btn mrep__btn--sm"
                            onClick={() => download(r)}
                            disabled={busy}
                            title="Download the PDF"
                          >
                            <FileDown size={13} /> {busy ? "…" : "PDF"}
                          </button>
                          <button
                            className="mrep__btn mrep__btn--sm mrep__btn--primary"
                            onClick={() => send(r, window.open("", "_blank"))}
                            disabled={busy || !!waQueue}
                            title={noNumber ? "No WhatsApp number on file — you will be asked for one" : "Open WhatsApp with a link to her report"}
                          >
                            <Send size={13} /> {busy ? "…" : "Send"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
