import { useState, useEffect, useMemo, useCallback } from "react";
import { AlertCircle, RefreshCw, CalendarRange } from "lucide-react";
import { PROGRAMS, YEARS } from "../../lib/academics";
import { buildClassPerformance, PERIODS } from "../../lib/classPerformance";
import { ChartCard, ColumnChart, BarChart } from "../Charts/Charts";
import "./Performance.css";
import "../Charts/Charts.css";

const ALL_PROGRAMS = "All Programs";
const PASS_LINE = 33;

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);

/** A count axis wants whole, round ticks — 0/2/4/6, never 0/1.75/3.5. */
const niceMax = (max) => Math.max(4, Math.ceil(max / 4) * 4);

/** "2026-08-12" -> "12 Aug", built from the parts so nothing is parsed as UTC. */
const shortDate = (value) => {
  const [y, m, d] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
};

/**
 * Class test performance across a class — the counterpart to Student Report.
 *
 * One component, two audiences, and the only difference is who it is scoped to:
 *
 *   teacher={her}   the tests she conducted, in her groups. Her own screen.
 *   teacher={null}  every test in the admin's allowed groups, plus the breakdown
 *                   by teacher that only makes sense when there is more than one.
 *
 * Same arrangement as ClassTestEntry and LmsManage, and for the same reason: two
 * copies of this would drift apart the first time either was touched.
 *
 * On the by-teacher chart: it is the average of the tests each teacher recorded,
 * and it is labelled as exactly that. A class of repeaters and a class of top
 * students do not produce comparable numbers, so the chart is a prompt to go and
 * look — never a score. The subtitle says so on screen rather than only here.
 */
export default function ClassPerformance({ teacher = null, allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const programsKey = allowedPrograms.join("|");
  // Keyed on contents, not identity: the parent rebuilds this array on render.
  const scope = useMemo(() => (programsKey ? programsKey.split("|") : []), [programsKey]);
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => scope.includes(p)) : PROGRAMS;

  const [program, setProgram] = useState(ALL_PROGRAMS);
  const [year, setYear] = useState("Both");
  const [period, setPeriod] = useState("6");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const months = PERIODS.find((p) => p.id === period)?.months ?? null;
      setData(await buildClassPerformance({
        programs: scope,
        teacherId: teacher?.id || null,
        program: program === ALL_PROGRAMS ? null : program,
        year: year === "Both" ? null : year,
        months,
      }));
    } catch (e) {
      setError(e.message || "Could not load class performance.");
    } finally {
      setLoading(false);
    }
  }, [scope, teacher, program, year, period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const stats = data?.stats;
  // The most recent dozen: past that the axis labels collide, and the table
  // under the chart still carries every one of them.
  const recentTests = (data?.tests || []).filter((t) => t.percent !== null).slice(-12);

  const testData = recentTests.map((t) => ({
    label: t.subject.length > 8 ? `${t.subject.slice(0, 7)}…` : t.subject,
    sublabel: shortDate(t.date),
    value: t.percent,
    tone: t.percent < PASS_LINE ? "critical" : "series1",
    tipValue: `Class average ${pctText(t.percent)}`,
    tipNote: `${t.subject} · ${t.title} · ${t.marked} marked`,
  }));

  const subjectData = (data?.subjects || []).map((s) => ({
    label: s.name,
    value: s.percent,
    valueLabel: pctText(s.percent),
    tipValue: `Class average ${pctText(s.percent)}`,
    tipNote: `${s.tests} test${s.tests === 1 ? "" : "s"} · ${s.marks} marks`,
  }));

  const teacherData = (data?.byTeacher || []).map((t) => ({
    label: t.name,
    value: t.percent,
    valueLabel: pctText(t.percent),
    tipValue: `Class average ${pctText(t.percent)}`,
    tipNote: `${t.tests} test${t.tests === 1 ? "" : "s"} · ${t.marks} marks`,
  }));

  const gradeData = (data?.grades || []).map((g) => ({
    label: g.grade,
    value: g.count,
    tone: g.grade === "F" ? "critical" : "series1",
    tipValue: `${g.count} mark${g.count === 1 ? "" : "s"}`,
  }));
  const gradeMax = niceMax(Math.max(...gradeData.map((g) => g.value), 1));

  return (
    <div className="perf">
      <div className="perf__head">
        <div>
          <h2 className="perf__title">{teacher ? "My Class Performance" : "Class Performance"}</h2>
          <p className="perf__sub">
            {teacher
              ? "How your classes have done in the tests you conducted — subject by subject and test by test."
              : "How the college has done in its class tests — by subject, by test and by teacher."}{" "}
            An absent girl is left out of every average here, never counted as a zero.
          </p>
        </div>
        <button className="perf__refresh" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "perf__spin" : ""} /> Refresh
        </button>
      </div>

      <div className="perf__filters">
        <label className="perf__field">
          <span>Group</span>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value={ALL_PROGRAMS}>{isRestricted ? "All My Groups" : ALL_PROGRAMS}</option>
            {visiblePrograms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label className="perf__field">
          <span>Class</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="Both">Both</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <label className="perf__field">
          <span><CalendarRange size={13} /> Period</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="perf__error"><AlertCircle size={14} /> {error}</p>}

      {loading && !data ? (
        <p className="perf__empty">Loading class performance…</p>
      ) : !stats || stats.testCount === 0 ? (
        <p className="perf__empty">No class tests were conducted in this period.</p>
      ) : (
        <>
          <div className="perf__tiles">
            <Tile label="Tests conducted" value={stats.testCount}
              note={stats.unmarkedTests > 0 ? `${stats.unmarkedTests} still unmarked` : "All of them marked"} />
            <Tile label="Class average" value={pctText(stats.percent)} note={`across ${stats.marks} marks recorded`} />
            <Tile label="Pass rate" value={pctText(stats.passPercent)} note={`at the ${stats.passMark}% board pass mark`} />
            <Tile label="Girls marked" value={stats.students}
              note={stats.absent > 0 ? `${stats.absent} absences recorded` : "No absences recorded"} />
          </div>

          <div className="charts-grid">
            <ChartCard
              title="Every test, in the order it was taken"
              subtitle={`Class average in each test. The last ${recentTests.length} of ${stats.testCount}; the table has them all.`}
              empty={testData.length === 0}
              emptyText="No test has been marked yet in this period."
              table={
                <table>
                  <thead><tr><th>Date</th><th>Subject</th><th>Test</th><th>Marked</th><th>Average</th></tr></thead>
                  <tbody>
                    {(data.tests || []).map((t) => (
                      <tr key={t.id}>
                        <td>{shortDate(t.date)}</td><td>{t.subject}</td><td>{t.title}</td>
                        <td>{t.marked}</td><td>{pctText(t.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ColumnChart data={testData} reference={{ value: PASS_LINE, label: "33% pass" }} label="Class average in each test" />
            </ChartCard>

            <ChartCard
              title="Subjects, strongest first"
              subtitle="Weighted by marks, so a test sat by four girls cannot move a subject as much as one sat by forty."
              empty={subjectData.length === 0}
              emptyText="Nothing marked yet."
              table={
                <table>
                  <thead><tr><th>Subject</th><th>Tests</th><th>Marks</th><th>Average</th></tr></thead>
                  <tbody>
                    {(data.subjects || []).map((s) => (
                      <tr key={s.name}><td>{s.name}</td><td>{s.tests}</td><td>{s.marks}</td><td>{pctText(s.percent)}</td></tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <BarChart data={subjectData} label="Class average in each subject" />
            </ChartCard>

            <ChartCard
              title="How the marks are spread"
              subtitle="Every mark in this period, in the board's grade bands."
              empty={stats.marks === 0}
              emptyText="Nothing marked yet."
              table={
                <table>
                  <thead><tr><th>Grade</th><th>Marks</th><th>Share</th></tr></thead>
                  <tbody>
                    {(data.grades || []).map((g) => (
                      <tr key={g.grade}>
                        <td>{g.grade}</td><td>{g.count}</td>
                        <td>{stats.marks > 0 ? `${Math.round((g.count / stats.marks) * 100)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ColumnChart data={gradeData} max={gradeMax} suffix="" label="Number of marks in each grade band" />
            </ChartCard>

            {/* Only worth drawing when there is more than one person on it. */}
            {!teacher && teacherData.length > 1 && (
              <ChartCard
                title="By teacher"
                subtitle="The average of the tests each teacher recorded. Classes differ, so read this as where to look — not as a score."
                empty={teacherData.length === 0}
                emptyText="No marked tests in this period."
                table={
                  <table>
                    <thead><tr><th>Teacher</th><th>Tests</th><th>Marks</th><th>Average</th></tr></thead>
                    <tbody>
                      {(data.byTeacher || []).map((t) => (
                        <tr key={t.name}><td>{t.name}</td><td>{t.tests}</td><td>{t.marks}</td><td>{pctText(t.percent)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <BarChart data={teacherData} label="Class average by teacher" nameWidth={130} />
              </ChartCard>
            )}
          </div>

          <p className="perf__note">
            Everything here is class tests. Term exams live in Results, and the report a parent
            receives is built in Reports — this screen is for spotting where to look first.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="perf__tile">
      <span className="perf__tile-label">{label}</span>
      <span className="perf__tile-value">{value}</span>
      <span className="perf__tile-note">{note}</span>
    </div>
  );
}
