import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import "./Attendance.css";

export default function Attendance({ studentId }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (studentId) fetchAttendance();
  }, [studentId]);

  const fetchAttendance = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("attendance")
      .select("*")
      .eq("student_id", studentId)
      .order("date", { ascending: false });
    if (data) setRecords(data);
    setLoading(false);
  };

  const present = records.filter((r) => r.status === "Present").length;
  const absent = records.filter((r) => r.status === "Absent").length;
  const leave = records.filter((r) => r.status === "Leave").length;
  const percent = records.length > 0 ? Math.round((present / records.length) * 100) : 0;

  if (loading) return <div className="attendance"><p className="attendance__loading">Loading attendance...</p></div>;

  return (
    <div className="attendance">
      <div className="attendance__summary">
        <div className="attendance__stat"><p className="attendance__num attendance__num--green">{present}</p><p>Present</p></div>
        <div className="attendance__stat"><p className="attendance__num attendance__num--red">{absent}</p><p>Absent</p></div>
        <div className="attendance__stat"><p className="attendance__num attendance__num--amber">{leave}</p><p>Leave</p></div>
        <div className="attendance__stat"><p className="attendance__num attendance__num--blue">{percent}%</p><p>Overall</p></div>
      </div>

      <div className="attendance__calendar-card">
        <h3>Attendance Records</h3>
        {records.length === 0 ? (
          <p className="attendance__empty">No attendance records found</p>
        ) : (
          <div className="attendance__list">
            {records.map((r) => (
              <div key={r.id} className="attendance__row">
                <span className="attendance__date">{new Date(r.date).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className={`attendance__status attendance__status--${r.status.toLowerCase()}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}