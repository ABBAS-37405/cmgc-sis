import { useState, useEffect, useCallback } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { buildStudentProgress } from "../../lib/studentProgress";
import StudentCharts from "./StudentCharts";
import "./Performance.css";

/**
 * The student's own performance, drawn.
 *
 * It is the same `buildStudentProgress` + `StudentCharts` pair the admin's
 * Student Report uses, with a roster of one — so what she sees at home is what
 * the office sees at the counter, not a second version of it that could
 * disagree. Same principle as her Reports tab generating the identical PDF her
 * parents are sent.
 *
 * `can` is `() => true` here and that is not a shortcut. The permission argument
 * exists because an *admin* is refused `attendance` and `results` by RLS unless
 * she holds those keys; a student is the `anon` role, whose select policies on
 * those tables are what her Attendance and Results tabs already run on. Nothing
 * here reaches a row she could not already open in another tab.
 */
export default function MyPerformance({ student }) {
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!student?.id) return;
    setLoading(true);
    setError("");
    try {
      setProgress(await buildStudentProgress(student, () => true));
    } catch (e) {
      setError(e.message || "Could not load your record.");
    } finally {
      setLoading(false);
    }
  }, [student]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="perf">
      <div className="perf__head">
        <div>
          <h2 className="perf__title">My Performance</h2>
          <p className="perf__sub">
            Your attendance, class tests, exams, assignments and fee — the same record the college office sees.
            Tap any bar for the exact figure, or open “Show the numbers” under a chart.
          </p>
        </div>
        <button className="perf__refresh" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "perf__spin" : ""} /> Refresh
        </button>
      </div>

      {error && <p className="perf__error"><AlertCircle size={14} /> {error}</p>}

      {loading && !progress ? (
        <p className="perf__empty">Loading your record…</p>
      ) : progress ? (
        <StudentCharts progress={progress} />
      ) : null}
    </div>
  );
}
