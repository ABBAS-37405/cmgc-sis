import { useState, useEffect } from "react";
import { FileDown, AlertCircle, ClipboardList } from "lucide-react";
import { PROGRAMS, YEARS } from "../../lib/academics";
import { fetchTests, buildTestReport, testPrograms, testReportFileName } from "../../lib/testReport";
import { buildTestReportPdf, saveBlob } from "../../lib/reportPdf";

const ALL_PROGRAMS = "All Programs";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);

/**
 * Result sheets for a single class test.
 *
 * The other tab is one girl across a month; this one is one test across a class.
 * The PDF carries both halves — the sheet for the notice board, then a page per
 * girl to send home — so a mark can never disagree between the two.
 */
export default function TestReports({ allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [program, setProgram] = useState(ALL_PROGRAMS);
  const [year, setYear] = useState("Both");
  const [tests, setTests] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [report, setReport] = useState(null);

  const [loadingTests, setLoadingTests] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [building, setBuilding] = useState("");
  const [error, setError] = useState("");

  const loadTests = async () => {
    setLoadingTests(true);
    setError("");
    setReport(null);
    setSelectedId("");
    try {
      setTests(await fetchTests({ allowedPrograms, program, year }));
    } catch (e) {
      setError(e.message || "Could not load the tests.");
      setTests([]);
    }
    setLoadingTests(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, year]);

  const openTest = async (test) => {
    setSelectedId(test.id);
    setLoadingReport(true);
    setError("");
    try {
      setReport(await buildTestReport(test, { allowedPrograms }));
    } catch (e) {
      setError(e.message || "Could not build the result sheet.");
      setReport(null);
    }
    setLoadingReport(false);
  };

  const download = async () => {
    if (!report) return;
    setBuilding("Preparing…");
    setError("");
    try {
      const blob = await buildTestReportPdf(report, {
        onProgress: (done, total) => setBuilding(`Student page ${done} of ${total}…`),
      });
      saveBlob(blob, testReportFileName(report));
    } catch (e) {
      setError(e.message || "Could not build the PDF.");
    }
    setBuilding("");
  };

  const stats = report?.stats;

  return (
    <div className="mrep__pane">
      <div className="mrep__filters">
        <label className="mrep__field">
          <span>Group</span>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value={ALL_PROGRAMS}>{isRestricted ? "All My Groups" : ALL_PROGRAMS}</option>
            {visiblePrograms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="mrep__field">
          <span>Class</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="Both">Both</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="mrep__error"><AlertCircle size={14} /> {error}</p>}

      {loadingTests ? (
        <p className="mrep__empty">Loading tests…</p>
      ) : tests.length === 0 ? (
        <div className="mrep__none">
          <ClipboardList size={28} />
          <p>No class tests found for these filters.</p>
          <p className="mrep__none-hint">
            Tests appear here once a teacher (or an admin) has conducted one from the Class Tests screen.
          </p>
        </div>
      ) : (
        <>
          <p className="mrep__bar-label">Pick a test — {tests.length} found, newest first.</p>
          <div className="mrep__tests">
            {tests.map((t) => (
              <button
                key={t.id}
                onClick={() => openTest(t)}
                className={`mrep__test ${selectedId === t.id ? "mrep__test--active" : ""}`}
              >
                <span className="mrep__test-title">{t.subject} — {t.title}</span>
                <span className="mrep__test-meta">
                  {testPrograms(t).join(", ")} · {t.year_of_study} · {fmtDate(t.test_date)} · out of {t.total_marks}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {loadingReport && <p className="mrep__empty">Building the result sheet…</p>}

      {report && !loadingReport && (
        <div className="mrep__sheet">
          <div className="mrep__bar">
            <span>
              <strong>{report.test.subject} — {report.test.title}</strong> · {report.groups.join(", ")} ·{" "}
              {report.test.year_of_study} · {fmtDate(report.test.test_date)}
            </span>
            <button className="mrep__btn mrep__btn--primary" onClick={download} disabled={!!building}>
              <FileDown size={14} /> {building || "Download result sheet + student pages"}
            </button>
          </div>

          {report.rows.length === 0 ? (
            <p className="mrep__empty">No students found in {report.groups.join(", ")} {report.test.year_of_study}.</p>
          ) : (
            <>
              <div className="mrep__stats">
                <Stat label="Strength" value={stats.strength} />
                <Stat label="Appeared" value={stats.taken} />
                <Stat label="Absent" value={stats.absent} />
                <Stat label="Highest" value={stats.highest ?? "—"} />
                <Stat label="Lowest" value={stats.lowest ?? "—"} />
                <Stat label="Average" value={stats.average === null ? "—" : `${stats.average.toFixed(1)} (${pctText(stats.averagePercent)})`} />
                <Stat label="Passed" value={stats.taken ? `${stats.passed}/${stats.taken}` : "—"} />
              </div>

              {stats.notMarked > 0 && (
                <p className="mrep__note">
                  {stats.notMarked} student{stats.notMarked === 1 ? " has" : "s have"} no marks entered for this test yet.
                  They appear on the sheet as “Not marked”, and get no page of their own.
                </p>
              )}

              <div className="mrep__table-wrap">
                <table className="mrep__table">
                  <thead>
                    <tr>
                      <th>Pos.</th><th>Roll No.</th><th>Name</th><th>Marks</th><th>%</th><th>Grade</th><th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.rows]
                      .sort((a, b) => {
                        if (a.position && b.position) return a.position - b.position;
                        if (a.position) return -1;
                        if (b.position) return 1;
                        return (a.student.name || "").localeCompare(b.student.name || "");
                      })
                      .map((r) => {
                        const failed = r.percent !== null && r.percent < stats.passPercent;
                        return (
                          <tr key={r.student.id}>
                            <td className="mrep__muted">{r.position ?? "—"}</td>
                            <td className="mrep__muted">{r.student.roll_no}</td>
                            <td><p className="mrep__name">{r.student.name}</p></td>
                            <td>
                              {r.isAbsent ? (
                                <span className="mrep__detail">Absent</span>
                              ) : r.notMarked ? (
                                <span className="mrep__detail">Not marked</span>
                              ) : (
                                <span className="mrep__pct">{r.obtained}/{report.test.total_marks}</span>
                              )}
                            </td>
                            <td><span className={`mrep__pct ${failed ? "mrep__pct--low" : ""}`}>{pctText(r.percent)}</span></td>
                            <td><span className={`mrep__pct ${failed ? "mrep__pct--low" : "mrep__pct--good"}`}>{r.grade}</span></td>
                            <td className="mrep__muted">{r.remarks || "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="mrep__stat">
      <p className="mrep__stat-value">{value}</p>
      <p className="mrep__stat-label">{label}</p>
    </div>
  );
}
