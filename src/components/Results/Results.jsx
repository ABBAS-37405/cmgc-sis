import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { ownSubjectsOnly } from "../../lib/studentSubjects";
import "./Results.css";

/**
 * Her exam marks sheet, one sitting at a time.
 *
 * Takes the whole student row, not her id: `results` carries a subject, and a
 * mark recorded under a subject her combination says she does not sit is left
 * out — the same rule as her Class Tests tab and her report.
 */
export default function Results({ student }) {
  const studentId = student?.id;
  const [results, setResults] = useState([]);
  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("results")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false });

    if (data) {
      const mine = ownSubjectsOnly(student, data);
      setResults(mine);
      // Built after the filter, so a sitting that was only ever marks in a
      // subject she does not study does not appear in the dropdown as an exam
      // with nothing under it.
      const uniqueExams = [...new Set(mine.map((r) => r.exam_name))];
      setExams(uniqueExams);
      if (uniqueExams.length > 0) setSelectedExam(uniqueExams[0]);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (studentId) fetchResults();
  }, [studentId, fetchResults]);

  const filtered = results.filter((r) => r.exam_name === selectedExam);
  const totalObtained = filtered.reduce((a, r) => a + (r.marks_obtained || 0), 0);
  const totalOf = filtered.reduce((a, r) => a + (r.total_marks || 0), 0);
  const percentage = totalOf > 0 ? ((totalObtained / totalOf) * 100).toFixed(1) : 0;

  if (loading) return <div className="results"><p style={{ textAlign: "center", color: "var(--subtext)", padding: "32px" }}>Loading results...</p></div>;

  return (
    <div className="results">
      {exams.length === 0 ? (
        <div className="results__card">
          <p style={{ textAlign: "center", color: "var(--subtext)", padding: "20px" }}>No results available yet</p>
        </div>
      ) : (
        <>
          <div className="results__card">
            <div className="results__header">
              <select value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)} style={{ fontSize: "14px", border: "1px solid var(--border)", borderRadius: "8px", padding: "6px 10px", background: "var(--bg)", color: "var(--text)" }}>
                {exams.map((e) => <option key={e}>{e}</option>)}
              </select>
              <span className="results__badge">📊 {percentage}%</span>
            </div>

            {filtered.map((r) => (
              <div key={r.id} className="results__row">
                <span className="results__muted">{r.subject}</span>
                <span>{r.marks_obtained} / {r.total_marks}</span>
              </div>
            ))}

            <div className="results__total">
              <span>Total</span>
              <span className="results__total-value">{totalObtained} / {totalOf} ({percentage}%)</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}