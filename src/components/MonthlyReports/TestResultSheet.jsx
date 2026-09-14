import { FileDown } from "lucide-react";
import { testPrograms } from "../../lib/testReport";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);

/**
 * The clickable grid of tests a filter narrowed down to — Test Reports narrows
 * by group/class, Subjects Report by subject. Shared so the two entry points
 * can never render a test's identity differently.
 */
export function TestList({ tests, selectedId, onSelect }) {
  return (
    <div className="mrep__tests">
      {tests.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t)}
          className={`mrep__test ${selectedId === t.id ? "mrep__test--active" : ""}`}
        >
          <span className="mrep__test-title">{t.subject} — {t.title}</span>
          <span className="mrep__test-meta">
            {testPrograms(t).join(", ")} · {t.year_of_study} · {fmtDate(t.test_date)} · out of {t.total_marks}
          </span>
        </button>
      ))}
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

/**
 * One test's result sheet — the bar, the class statistics, and the ranked
 * table — built from `buildTestReport`'s `report` shape. Both `TestReports`
 * (picked by group/class) and `SubjectReports` (picked by subject) render the
 * same report through this one component, so the sheet an admin downloads can
 * never disagree with what either screen showed on the way there.
 */
export function TestResultSheet({ report, building, onDownload }) {
  const stats = report.stats;

  return (
    <div className="mrep__sheet">
      <div className="mrep__bar">
        <span>
          <strong>{report.test.subject} — {report.test.title}</strong> · {report.groups.join(", ")} ·{" "}
          {report.test.year_of_study} · {fmtDate(report.test.test_date)}
        </span>
        <button className="mrep__btn mrep__btn--primary" onClick={onDownload} disabled={!!building}>
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
  );
}
