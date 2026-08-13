import { ChartCard, ColumnChart, BarChart, LineChart, Meter } from "../Charts/Charts";
import "../Charts/Charts.css";

const PASS_LINE = 33;      // the board's pass mark, and what a test chart is read against
const ATTENDANCE_LINE = 75; // the figure the college acts on

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);
const rs = (n) => `Rs. ${Number(n || 0).toLocaleString("en-PK")}`;

/** "2026-08" -> { label: "Aug", sublabel: "'26", full: "August 2026" } */
function monthParts(key, full) {
  const [y, m] = String(key).split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return {
    label: d.toLocaleDateString("en-PK", { month: "short" }),
    sublabel: `'${String(y).slice(2)}`,
    full: full || d.toLocaleDateString("en-PK", { month: "long", year: "numeric" }),
  };
}

/**
 * One student's performance, drawn.
 *
 * The same component serves the admin's Student Report and the girl's own
 * portal, from the same `buildStudentProgress` object — so the picture the office
 * is looking at and the picture she is looking at cannot disagree. That is the
 * same reason the student's Reports tab generates the identical PDF the admin
 * sends out rather than a second version of it.
 *
 * Every chart here plots one series, so none of them needs a legend: the title
 * says what is plotted and there is only one colour on screen. What each one does
 * carry is a table of its own numbers, because a value a reader can only get by
 * hovering is a value some readers cannot get at all.
 *
 * Nothing is invented for a missing figure. A month nobody marked is not a month
 * she was absent, an ungraded test is not a zero, and a chart with nothing behind
 * it prints the reason instead of an empty axis.
 */
export default function StudentCharts({ progress }) {
  const { attendance, tests, exams, assignments, fee } = progress;

  /* -- attendance ------------------------------------------------------- */
  // Reversed: byMonth is newest-first for the table below it, but a time axis
  // reads left to right.
  const months = attendance.unavailable ? [] : [...attendance.byMonth].slice(0, 12).reverse();
  const attendanceData = months.map((m) => {
    const parts = monthParts(m.month, m.label);
    return {
      label: parts.label,
      sublabel: parts.sublabel,
      value: m.percent ?? 0,
      // Colour is reinforcement, never the signal: the bar is visibly under a
      // labelled 75% line whether or not the reader can see the red.
      tone: m.percent !== null && m.percent < ATTENDANCE_LINE ? "critical" : "series1",
      tipValue: pctText(m.percent),
      tipNote: `${m.present} present of ${m.marked} marked`,
    };
  });

  /* -- class tests ------------------------------------------------------ */
  const testData = (tests.subjects || [])
    .filter((s) => s.percent !== null)
    .map((s) => ({
      label: s.subject,
      value: s.percent,
      valueLabel: pctText(s.percent),
      tipValue: `${s.obtained}/${s.total} (${pctText(s.percent)})`,
      tipNote: `${s.tests.length} test${s.tests.length === 1 ? "" : "s"}`,
    }));

  /* -- exams ------------------------------------------------------------ */
  const sittings = exams.unavailable ? [] : [...exams.list].filter((e) => e.percent !== null).reverse();
  const examTrend = sittings.map((e) => ({
    label: e.type || "Exam",
    value: e.percent,
    tipValue: `${e.obtained}/${e.total} (${pctText(e.percent)})`,
    tipNote: e.examName,
  }));
  // One sitting is not a trend. Show what she scored in each subject instead.
  const singleExam = sittings.length === 1 ? sittings[0] : null;
  const singleExamData = singleExam
    ? singleExam.subjects
        .filter((s) => s.total > 0)
        .map((s) => ({
          label: s.subject,
          value: (s.obtained / s.total) * 100,
          valueLabel: pctText((s.obtained / s.total) * 100),
          tipValue: `${s.obtained}/${s.total}`,
        }))
    : [];

  return (
    <div className="charts-grid">
      {!attendance.unavailable && (
        <ChartCard
          title="Attendance, month by month"
          subtitle={`The line is 75% — the figure the college acts on. ${attendance.marked} days marked in all.`}
          empty={attendanceData.length === 0}
          emptyText="No attendance has been marked for her yet."
          table={
            <table>
              <thead><tr><th>Month</th><th>Present</th><th>Marked</th><th>Percentage</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.label}</td><td>{m.present}</td><td>{m.marked}</td><td>{pctText(m.percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <ColumnChart
            data={attendanceData}
            reference={{ value: ATTENDANCE_LINE, label: "75%" }}
            label="Attendance percentage for each month"
          />
        </ChartCard>
      )}

      <ChartCard
        title="Class tests, by subject"
        subtitle={`${tests.count} test${tests.count === 1 ? "" : "s"} across ${testData.length} subject${testData.length === 1 ? "" : "s"}. An absent test is left out, never counted as zero.`}
        empty={testData.length === 0}
        emptyText="No class test marks have been recorded for her."
        table={
          <table>
            <thead><tr><th>Subject</th><th>Obtained</th><th>Total</th><th>Percentage</th></tr></thead>
            <tbody>
              {(tests.subjects || []).map((s) => (
                <tr key={s.subject}>
                  <td>{s.subject}</td><td>{s.obtained}</td><td>{s.total}</td><td>{pctText(s.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <BarChart data={testData} label="Class test percentage in each subject" />
      </ChartCard>

      {!exams.unavailable && (
        <ChartCard
          title={singleExam ? `${singleExam.type || "Exam"} — subject by subject` : "Exams, one sitting to the next"}
          subtitle={singleExam ? singleExam.examName : `${sittings.length} sittings with marks entered, oldest first.`}
          empty={sittings.length === 0}
          emptyText="No exam marks have been entered for her."
          table={
            <table>
              <thead><tr><th>Exam</th><th>Obtained</th><th>Total</th><th>Percentage</th></tr></thead>
              <tbody>
                {sittings.map((e) => (
                  <tr key={e.examName}>
                    <td>{e.examName}</td><td>{e.obtained}</td><td>{e.total}</td><td>{pctText(e.percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          {singleExam ? (
            <BarChart data={singleExamData} label="Percentage in each subject of this exam" />
          ) : (
            <LineChart
              data={examTrend}
              reference={{ value: PASS_LINE, label: "33% pass" }}
              label="Overall exam percentage across sittings"
            />
          )}
        </ChartCard>
      )}

      <div className="charts-grid charts-grid--meters">
        <Meter
          label="Fee position"
          value={fee.paid}
          max={fee.due}
          valueLabel={fee.due > 0 ? `${Math.round((fee.paid / fee.due) * 100)}%` : "—"}
          tone={fee.balance > 0 ? "critical" : "good"}
          note={fee.due > 0 ? `${rs(fee.paid)} paid of ${rs(fee.due)} · ${rs(fee.balance)} outstanding` : "No fee charged yet."}
        />
        <Meter
          label="Assignments handed in"
          value={assignments.submitted}
          max={assignments.set}
          valueLabel={assignments.set > 0 ? `${assignments.submitted}/${assignments.set}` : "—"}
          tone={assignments.missing > 0 ? "critical" : "good"}
          note={
            assignments.set === 0
              ? "None set for her group yet."
              : `${assignments.missing} missing · ${assignments.late} handed in late`
          }
        />
      </div>
    </div>
  );
}
