import { useState, useEffect } from "react";
import { FileDown, Send, RefreshCw, CheckCircle2, AlertCircle, CalendarRange, FileArchive, Files, GraduationCap } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, YEARS } from "../../lib/academics";
import { REPORTABLE_EXAM_TYPES } from "../../lib/exams";
import {
  buildMonthlyReports,
  buildReportMessage,
  defaultMonth,
  recentMonths,
  uploadReportPdf,
  logReportSent,
  fetchReportLog,
  fetchExamNames,
  normaliseSections,
  DEFAULT_SECTIONS,
  SECTION_LABELS,
  EXAM_CLASS_TESTS,
} from "../../lib/monthlyReport";
import {
  buildReportPdf,
  buildAllReportsPdf,
  buildReportsZip,
  reportFileName,
  saveBlob,
} from "../../lib/reportPdf";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber } from "../../lib/whatsapp";

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

/**
 * The roster-wide reports screen, shared by the Monthly and Exam tabs.
 *
 * The two tabs differ in exactly one thing — whether the report carries an
 * examination — so they are one component with a `mode`, not two copies of four
 * hundred lines that would drift apart the first time either is touched.
 *
 *   mode="monthly"  class tests only; no exam is ever fetched
 *   mode="exam"     a term exam picked by type and sitting; the exam section is
 *                   the point of the report, so it is not optional
 *
 * Everything else — month, group and class filters, the section ticks, the two
 * bulk downloads, the per-student PDF and the WhatsApp queue — is identical, and
 * deliberately so.
 */
export default function ReportsPane({ allowedPrograms = [], adminProfile, mode = "monthly" }) {
  const isExamMode = mode === "exam";
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [month, setMonth] = useState(defaultMonth);
  const [program, setProgram] = useState(isRestricted ? visiblePrograms[0] || ALL_PROGRAMS : ALL_PROGRAMS);
  const [yearFilter, setYearFilter] = useState("Both");
  const [search, setSearch] = useState("");

  // Exam mode only. `examType` narrows the list; `examName` is the actual sitting.
  const [examType, setExamType] = useState(REPORTABLE_EXAM_TYPES[0]);
  const [examName, setExamName] = useState("");
  const [exams, setExams] = useState([]);

  // The exam section is the whole point in exam mode, so it starts on there and
  // is absent entirely in monthly mode.
  const [sections, setSections] = useState(
    isExamMode ? DEFAULT_SECTIONS : { ...DEFAULT_SECTIONS, result: false }
  );

  const [reports, setReports] = useState([]);
  const [sentLog, setSentLog] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState("");
  // Non-empty while a bulk file is being built; also the button's label, because
  // forty reports take long enough that a silent button looks broken.
  const [bulk, setBulk] = useState("");

  // Sending is a queue, never a loop: browsers block a burst of window.open and
  // WhatsApp Web drops chats pushed at it in the same second. Each click here is
  // a real user gesture, so nothing is blocked. Same pattern as MarkAttendance.
  const [waQueue, setWaQueue] = useState(null); // { list, index }

  const examsOfType = exams.filter((e) => e.type === examType);

  /**
   * The sitting actually being reported on: the admin's pick when it still
   * belongs to the chosen type, otherwise the newest of that type.
   *
   * Derived during render rather than stored. Storing it would need an effect
   * that fires once the exam list arrives, and that effect would change
   * `activeExam` and trigger a second full load — a real double fetch, not just
   * a lint complaint.
   */
  const effectiveExamName = examsOfType.some((e) => e.name === examName)
    ? examName
    : examsOfType[0]?.name || "";

  const activeExam = isExamMode ? effectiveExamName : EXAM_CLASS_TESTS;

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

    const ids = (students || []).map((s) => s.id);

    try {
      // Both are about this roster, so they are loaded with it rather than on
      // their own effects — one fewer round trip and no half-loaded screen.
      const [log, examList] = await Promise.all([
        fetchReportLog(ids, month),
        isExamMode ? fetchExamNames(ids) : Promise.resolve([]),
      ]);
      setSentLog(log);
      setExams(examList);

      // First pass in exam mode: the sitting list has only just arrived, so
      // `activeExam` is still empty in this closure. Storing the list re-renders,
      // `effectiveExamName` resolves, and the effect below runs again with a real
      // exam. Building reports now would only throw the work away.
      if (isExamMode && !activeExam) {
        setReports([]);
        setLoading(false);
        return;
      }

      setReports(await buildMonthlyReports(students || [], month, { examName: activeExam }));
    } catch (e) {
      setError(e.message || "Could not build the reports.");
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, yearFilter, month, activeExam]);

  const toggleSection = (id) => setSections((prev) => ({ ...prev, [id]: !normaliseSections(prev)[id] }));

  /** PDF + upload, shared by download and send. */
  const generate = async (report) => {
    const blob = await buildReportPdf(report, { sections });
    return { blob, url: await uploadReportPdf(report, blob) };
  };

  const download = async (report) => {
    setBusyId(report.student.id);
    setError("");
    try {
      saveBlob(await buildReportPdf(report, { sections }), reportFileName(report));
    } catch (e) {
      setError(e.message || "Could not build the PDF.");
    }
    setBusyId(null);
  };

  /**
   * The whole filtered class, in one go, straight to the admin's computer.
   *
   * Nothing is uploaded and no WhatsApp is involved — this is the path for
   * printing, filing, or working offline. `kind` picks between one combined
   * document and a ZIP of separate files; both walk the same reports.
   */
  const downloadAll = async (kind) => {
    if (filtered.length === 0) return;
    setError("");
    setNote("");
    setBulk("Starting…");

    const onProgress = (done, total) => setBulk(`${done} of ${total}…`);
    const monthName = MONTHS.find((m) => m.value === month)?.label.replace(/\s+/g, "-") || month;
    const stem = isExamMode
      ? `CMGC-${(effectiveExamName || "exam").replace(/[^\w-]+/g, "-").replace(/-+/g, "-")}`
      : `CMGC-reports-${monthName}`;

    try {
      if (kind === "zip") {
        saveBlob(await buildReportsZip(filtered, { sections, onProgress }), `${stem}.zip`);
      } else {
        saveBlob(await buildAllReportsPdf(filtered, { sections, onProgress }), `${stem}.pdf`);
      }
      setNote(`${filtered.length} report${filtered.length === 1 ? "" : "s"} downloaded.`);
    } catch (e) {
      setError(e.message || "Could not build the download.");
    }
    setBulk("");
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
      openWhatsApp(number, buildReportMessage(report, url, sections), windowRef);
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
  const showExamColumn = isExamMode && !!effectiveExamName;
  // How many girls actually have marks for the sitting that was picked — sending
  // a "Pre-Board result" to a class where nobody has one is the mistake to catch.
  const withResult = filtered.filter((r) => r.result).length;
  const sectionsShown = isExamMode ? SECTION_LABELS : SECTION_LABELS.filter((s) => s.id !== "result");

  // In exam mode there is nothing to report until a sitting exists to report on.
  const blocked = isExamMode && !effectiveExamName;

  return (
    <div className="mrep__pane">
      <div className="mrep__filters">
        {isExamMode && (
          <>
            <label className="mrep__field">
              <span><GraduationCap size={13} /> Exam type</span>
              <select value={examType} onChange={(e) => setExamType(e.target.value)}>
                {REPORTABLE_EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>

            <label className="mrep__field mrep__field--wide">
              <span>Which one</span>
              <select
                value={effectiveExamName}
                onChange={(e) => setExamName(e.target.value)}
                disabled={examsOfType.length === 0}
              >
                {examsOfType.length === 0 ? (
                  <option value="">No {examType} recorded yet</option>
                ) : (
                  examsOfType.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)
                )}
              </select>
            </label>
          </>
        )}

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

      {isExamMode && (
        <p className="mrep__hint">
          The exam marksheet comes from the sitting picked above, whenever it was held.
          The month only governs the attendance, assignments and fee sections.
        </p>
      )}

      <div className="mrep__include">
        <span className="mrep__include-label">Include in the report</span>
        <div className="mrep__include-boxes">
          {sectionsShown.map((s) => (
            <label key={s.id} className="mrep__check">
              <input
                type="checkbox"
                checked={!!normaliseSections(sections)[s.id]}
                onChange={() => toggleSection(s.id)}
              />
              {s.id === "result" && isExamMode ? "Exam Marksheet" : s.label}
            </label>
          ))}
        </div>
        <button className="mrep__refresh" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "mrep__spin" : ""} /> Refresh
        </button>
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

      {blocked ? (
        <div className="mrep__none">
          <GraduationCap size={28} />
          <p>No {examType} has been recorded yet.</p>
          <p className="mrep__none-hint">
            Enter its marks from the Results screen first — this tab lists the sittings that already have marks against them.
          </p>
        </div>
      ) : loading ? (
        <p className="mrep__empty">Building reports for {MONTHS.find((m) => m.value === month)?.label}…</p>
      ) : filtered.length === 0 ? (
        <p className="mrep__empty">No students match these filters.</p>
      ) : (
        <>
          <div className="mrep__bar">
            <span>
              {filtered.length} student{filtered.length === 1 ? "" : "s"} · {sentCount} already sent this month
              {showExamColumn && ` · ${withResult} with marks for this exam`}
            </span>
            <div className="mrep__bar-actions">
              <button className="mrep__btn" onClick={() => downloadAll("pdf")} disabled={!!bulk}>
                <Files size={14} /> {bulk ? bulk : "Download all — one PDF"}
              </button>
              <button className="mrep__btn" onClick={() => downloadAll("zip")} disabled={!!bulk}>
                <FileArchive size={14} /> {bulk ? bulk : "Download all — ZIP"}
              </button>
              {!waQueue && (
                <button className="mrep__btn mrep__btn--primary" onClick={startQueue} disabled={!!bulk}>
                  <Send size={14} /> Send all on WhatsApp
                </button>
              )}
            </div>
          </div>

          <div className="mrep__table-wrap">
            <table className="mrep__table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Group / Class</th>
                  <th>Attendance</th>
                  <th>Class Tests</th>
                  {showExamColumn && <th>{examType}</th>}
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
                      {showExamColumn && (
                        <td>
                          {r.result ? (
                            <>
                              <span className={`mrep__pct ${pctTone(r.result.percent, 50)}`}>
                                {pctText(r.result.percent)}
                              </span>
                              <span className="mrep__detail">{r.result.obtained}/{r.result.total}</span>
                            </>
                          ) : (
                            <span className="mrep__detail">Not recorded</span>
                          )}
                        </td>
                      )}
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
