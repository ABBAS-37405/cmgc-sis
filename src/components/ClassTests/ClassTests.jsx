import { useState, useEffect, useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./ClassTests.css";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short" }) : "";

const pctClass = (pct) => {
  if (pct === null) return "";
  if (pct >= 80) return "class-tests__score--high";
  if (pct >= 50) return "class-tests__score--mid";
  return "class-tests__score--low";
};

export default function ClassTests({ studentId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(Boolean(studentId));
  const [activeSubject, setActiveSubject] = useState("All");

  const fetchTests = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("class_test_marks")
      .select("id, marks_obtained, is_absent, remarks, class_tests(id, subject, title, test_date, total_marks)")
      .eq("student_id", studentId);

    // A mark row whose parent test was deleted is not useful to show.
    setRows((data || []).filter((r) => r.class_tests));
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (studentId) fetchTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // One group per subject, tests inside ordered oldest -> newest so "Test 1, Test 2..."
  // reads left to right. Each subject keeps its own count, so subjects with 6 tests and
  // subjects with 1 test both display correctly.
  const subjects = useMemo(() => {
    const map = new Map();

    rows.forEach((r) => {
      const t = r.class_tests;
      if (!map.has(t.subject)) map.set(t.subject, { subject: t.subject, tests: [] });
      const total = Number(t.total_marks) || 0;
      const obtained = r.is_absent || r.marks_obtained === null ? null : Number(r.marks_obtained);
      map.get(t.subject).tests.push({
        id: t.id,
        title: t.title,
        date: t.test_date,
        total,
        obtained,
        isAbsent: !!r.is_absent,
        remarks: r.remarks,
        pct: obtained !== null && total > 0 ? (obtained / total) * 100 : null,
      });
    });

    return [...map.values()]
      .map((group) => {
        group.tests.sort((a, b) => new Date(a.date) - new Date(b.date));
        const counted = group.tests.filter((t) => t.obtained !== null);
        const sumObtained = counted.reduce((a, t) => a + t.obtained, 0);
        const sumTotal = counted.reduce((a, t) => a + t.total, 0);
        return {
          ...group,
          taken: counted.length,
          absent: group.tests.filter((t) => t.isAbsent).length,
          sumObtained,
          sumTotal,
          avgPct: sumTotal > 0 ? (sumObtained / sumTotal) * 100 : null,
        };
      })
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }, [rows]);

  const shown = activeSubject === "All" ? subjects : subjects.filter((s) => s.subject === activeSubject);

  const overallObtained = subjects.reduce((a, s) => a + s.sumObtained, 0);
  const overallTotal = subjects.reduce((a, s) => a + s.sumTotal, 0);
  const overallPct = overallTotal > 0 ? (overallObtained / overallTotal) * 100 : null;
  const totalTests = subjects.reduce((a, s) => a + s.tests.length, 0);

  if (loading) {
    return (
      <div className="class-tests">
        <p className="class-tests__empty">Loading class tests...</p>
      </div>
    );
  }

  if (subjects.length === 0) {
    return (
      <div className="class-tests">
        <div className="class-tests__card class-tests__none">
          <ClipboardList size={30} />
          <p>No class tests recorded yet.</p>
          <p className="class-tests__none-hint">Your class tests will appear here subject by subject as your teachers enter them.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="class-tests">
      <div className="class-tests__summary">
        <div className="class-tests__stat">
          <p className="class-tests__stat-value">{totalTests}</p>
          <p className="class-tests__stat-label">Total Tests</p>
        </div>
        <div className="class-tests__stat">
          <p className="class-tests__stat-value">{subjects.length}</p>
          <p className="class-tests__stat-label">Subjects</p>
        </div>
        <div className="class-tests__stat">
          <p className="class-tests__stat-value">{overallObtained}/{overallTotal}</p>
          <p className="class-tests__stat-label">Marks Obtained</p>
        </div>
        <div className="class-tests__stat">
          <p className="class-tests__stat-value">{overallPct !== null ? `${overallPct.toFixed(1)}%` : "—"}</p>
          <p className="class-tests__stat-label">Overall Average</p>
        </div>
      </div>

      <div className="class-tests__filters" role="group" aria-label="Filter by subject">
        <button
          onClick={() => setActiveSubject("All")}
          className={`class-tests__filter ${activeSubject === "All" ? "class-tests__filter--active" : ""}`}
        >
          All Subjects
        </button>
        {subjects.map((s) => (
          <button
            key={s.subject}
            onClick={() => setActiveSubject(s.subject)}
            className={`class-tests__filter ${activeSubject === s.subject ? "class-tests__filter--active" : ""}`}
          >
            {s.subject} ({s.tests.length})
          </button>
        ))}
      </div>

      {shown.map((group) => (
        <div key={group.subject} className="class-tests__card">
          <div className="class-tests__subject-head">
            <div>
              <h3 className="class-tests__subject">{group.subject}</h3>
              <p className="class-tests__subject-meta">
                {group.tests.length} test{group.tests.length === 1 ? "" : "s"}
                {group.absent > 0 ? ` · ${group.absent} absent` : ""}
                {group.sumTotal > 0 ? ` · ${group.sumObtained}/${group.sumTotal}` : ""}
              </p>
            </div>
            {group.avgPct !== null && (
              <span className={`class-tests__badge ${pctClass(group.avgPct)}`}>{group.avgPct.toFixed(1)}%</span>
            )}
          </div>

          <div className="class-tests__strip">
            {group.tests.map((t, i) => (
              <div key={t.id} className="class-tests__test" title={t.remarks || undefined}>
                <p className="class-tests__test-no">Test {i + 1}</p>
                <p className="class-tests__test-title">{t.title}</p>
                <p className="class-tests__test-date">{fmtDate(t.date)}</p>
                {t.isAbsent ? (
                  <p className="class-tests__score class-tests__score--absent">Absent</p>
                ) : t.obtained === null ? (
                  <p className="class-tests__score class-tests__score--pending">Not marked</p>
                ) : (
                  <>
                    <p className={`class-tests__score ${pctClass(t.pct)}`}>{t.obtained}/{t.total}</p>
                    <p className="class-tests__test-pct">{t.pct.toFixed(0)}%</p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
