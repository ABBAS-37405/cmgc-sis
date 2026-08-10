import { useState, useEffect } from "react";
import { FileDown, ExternalLink, AlertCircle, CalendarRange, GraduationCap, ClipboardList } from "lucide-react";
import {
  buildMonthlyReports,
  defaultMonth,
  fetchExamNames,
  fetchSharedReport,
  recentMonths,
  DEFAULT_SECTIONS,
  EXAM_CLASS_TESTS,
} from "../../lib/monthlyReport";
import "./Reports.css";

const MONTHS = recentMonths(12);

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);

/** Attendance below 75% is the number the college acts on, so it is coloured. */
const pctTone = (p, good = 75) => {
  if (p === null || p === undefined) return "";
  if (p >= good) return "srep__stat-value--good";
  if (p >= good - 25) return "srep__stat-value--mid";
  return "srep__stat-value--low";
};

const when = (iso) =>
  new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });

/**
 * The report card the admin sends home, from the student's own side.
 *
 * Same builder and same renderer as the admin's Reports tab — `buildMonthlyReports`
 * and `buildReportPdf` — so what she downloads here is the document her parents
 * receive on WhatsApp, not a second version of it that could disagree. She is
 * simply a roster of one.
 *
 * She may also generate a month the office has not sent yet; the report is
 * assembled from tables she can already read tab by tab, so nothing is exposed
 * here that the portal did not already show her. When the college *has* shared a
 * month, that exact file is offered alongside — it carries whichever sections the
 * admin ticked, which is the version her parents are holding.
 */
export default function Reports({ student }) {
  // The month that just ended, same default as the admin's tab: it is the one
  // with a full record behind it, and the one the office has actually sent.
  const [month, setMonth] = useState(defaultMonth);
  // The sentinel means "class tests only, no examination" — the same thing the
  // admin's Monthly tab passes. Anything else is a real results.exam_name.
  const [examName, setExamName] = useState(EXAM_CLASS_TESTS);
  const [exams, setExams] = useState([]);

  const [report, setReport] = useState(null);
  const [shared, setShared] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isExam = examName !== EXAM_CLASS_TESTS;
  // Her own record, so every section is in. The exam sheet only exists when she
  // picked a sitting; drawing it in monthly mode would draw an empty box.
  const sections = { ...DEFAULT_SECTIONS, result: isExam };

  useEffect(() => {
    let cancelled = false;
    if (!student?.id) return;
    fetchExamNames([student.id]).then((list) => { if (!cancelled) setExams(list); });
    return () => { cancelled = true; };
  }, [student?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!student?.id) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    buildMonthlyReports([student], month, { examName })
      .then((built) => { if (!cancelled) setReport(built[0] || null); })
      .catch((e) => { if (!cancelled) setError(e.message || "Could not build your report."); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // Keyed on her id rather than the whole `student` object, which is a fresh
    // reference on every render of the portal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, month, examName]);

  // Separate from the build above because it depends only on the month — which
  // exam she is looking at does not change what the office already uploaded.
  useEffect(() => {
    let cancelled = false;
    if (!student?.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShared(null);
    fetchSharedReport(student.id, month).then((f) => { if (!cancelled) setShared(f); });
    return () => { cancelled = true; };
  }, [student?.id, month]);

  const download = async () => {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      // jsPDF and its optional deps are ~800 kB. Loading the renderer only when
      // she actually asks for the file keeps all of it out of the portal chunk
      // for every student who never opens this tab.
      const { buildReportPdf, reportFileName, saveBlob } = await import("../../lib/reportPdf");
      saveBlob(await buildReportPdf(report, { sections }), reportFileName(report));
    } catch (e) {
      setError(e.message || "Could not build the PDF.");
    }
    setBusy(false);
  };

  const monthLabel = MONTHS.find((m) => m.value === month)?.label || month;
  const nothingRecorded =
    report &&
    report.attendance.marked === 0 &&
    report.tests.count === 0 &&
    report.assignments.set === 0 &&
    !report.result;

  return (
    <div className="srep">
      <div className="srep__intro">
        <h2 className="srep__title">Performance Report</h2>
        <p className="srep__sub">
          The same report the college sends home — attendance, class tests, assignments,
          exam marks and your fee position, in one PDF you can download or print.
        </p>
      </div>

      <div className="srep__filters">
        <label className="srep__field">
          <span><CalendarRange size={13} /> Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <label className="srep__field srep__field--grow">
          <span><GraduationCap size={13} /> Report</span>
          <select value={examName} onChange={(e) => setExamName(e.target.value)}>
            <option value={EXAM_CLASS_TESTS}>Monthly report — class tests</option>
            {exams.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
          </select>
        </label>
      </div>

      {isExam && (
        <p className="srep__hint">
          The marksheet is for the exam picked above, whenever it was held. The month
          still decides the attendance, assignments and fee sections.
        </p>
      )}

      {error && <p className="srep__error"><AlertCircle size={14} /> {error}</p>}

      {shared && (
        <div className="srep__shared">
          <div>
            <p className="srep__shared-title">The college has shared a report for {monthLabel}.</p>
            <p className="srep__shared-meta">
              {shared.sharedAt ? `Prepared by the office on ${when(shared.sharedAt)}. ` : ""}
              This is the exact file sent to your parents.
            </p>
          </div>
          <a className="srep__btn" href={shared.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Open
          </a>
        </div>
      )}

      {loading ? (
        <p className="srep__empty">Building your {monthLabel} report…</p>
      ) : !report ? (
        <p className="srep__empty">Your report could not be prepared. Please try again.</p>
      ) : (
        <>
          <div className="srep__stats">
            <div className="srep__stat">
              <p className={`srep__stat-value ${pctTone(report.attendance.percent)}`}>
                {pctText(report.attendance.percent)}
              </p>
              <p className="srep__stat-label">Attendance</p>
              <p className="srep__stat-detail">{report.attendance.present}/{report.attendance.marked} days</p>
            </div>

            <div className="srep__stat">
              <p className={`srep__stat-value ${pctTone(report.tests.percent, 50)}`}>
                {pctText(report.tests.percent)}
              </p>
              <p className="srep__stat-label">Class Tests</p>
              <p className="srep__stat-detail">
                {report.tests.count} test{report.tests.count === 1 ? "" : "s"}
              </p>
            </div>

            {isExam && (
              <div className="srep__stat">
                <p className={`srep__stat-value ${pctTone(report.result?.percent, 50)}`}>
                  {pctText(report.result?.percent ?? null)}
                </p>
                <p className="srep__stat-label">Exam</p>
                <p className="srep__stat-detail">
                  {report.result ? `${report.result.obtained}/${report.result.total}` : "Not recorded"}
                </p>
              </div>
            )}

            <div className="srep__stat">
              <p className="srep__stat-value">{report.assignments.submitted}/{report.assignments.set}</p>
              <p className="srep__stat-label">Assignments</p>
              <p className="srep__stat-detail">
                {report.assignments.missing > 0 ? `${report.assignments.missing} missing` : "Nothing pending"}
              </p>
            </div>

            <div className="srep__stat">
              <p className={`srep__stat-value ${report.fee.balance > 0 ? "srep__stat-value--low" : "srep__stat-value--good"}`}>
                {report.fee.balance > 0 ? `Rs. ${report.fee.balance.toLocaleString("en-PK")}` : "Clear"}
              </p>
              <p className="srep__stat-label">Fee Balance</p>
              <p className="srep__stat-detail">Rs. {report.fee.paid.toLocaleString("en-PK")} paid</p>
            </div>
          </div>

          {nothingRecorded && (
            <p className="srep__hint">
              Nothing has been recorded for {monthLabel} yet. You can still download the
              report, or pick an earlier month above.
            </p>
          )}

          <div className="srep__download">
            <div className="srep__download-text">
              <p className="srep__download-title">
                <ClipboardList size={15} /> {isExam ? examName : `Monthly report — ${monthLabel}`}
              </p>
              <p className="srep__download-meta">
                {student?.name} · {student?.roll_no} · {student?.program}
              </p>
            </div>
            <button className="srep__btn srep__btn--primary" onClick={download} disabled={busy}>
              <FileDown size={15} /> {busy ? "Preparing…" : "Download PDF"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
