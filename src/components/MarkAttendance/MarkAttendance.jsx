import { useState, useEffect } from "react";
import { Check, UserPlus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./MarkAttendance.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];

export default function MarkAttendance() {
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({});
  const [program, setProgram] = useState("Pre-Medical");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyMarked, setAlreadyMarked] = useState(false);

  useEffect(() => {
    fetchStudents();
  }, [program]);

  useEffect(() => {
    if (students.length > 0) checkAlreadyMarked();
  }, [date, students]);

  const fetchStudents = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("students")
      .select("id, name, roll_no")
      .eq("program", program)
      .order("name");
    if (data) {
      setStudents(data);
      const initial = {};
      data.forEach((s) => initial[s.id] = "Present");
      setRecords(initial);
    }
    setLoading(false);
  };

  const checkAlreadyMarked = async () => {
    if (students.length === 0) return;
    const { data } = await supabase
      .from("attendance")
      .select("id")
      .eq("date", date)
      .eq("student_id", students[0].id);
    setAlreadyMarked(data && data.length > 0);
    setSaved(false);
  };

  const setStatus = (id, status) => {
    setRecords((p) => ({ ...p, [id]: status }));
    setSaved(false);
  };

  const saveAttendance = async () => {
    setSaving(true);
    // Pehle us date ka purana attendance delete karein
    const studentIds = students.map((s) => s.id);
    await supabase.from("attendance").delete()
      .eq("date", date)
      .in("student_id", studentIds);

    // Naya attendance insert karein
    const rows = students.map((s) => ({
      student_id: s.id,
      date,
      status: records[s.id] || "Present",
    }));

    const { error } = await supabase.from("attendance").insert(rows);
    setSaving(false);
    if (!error) {
      setSaved(true);
      setAlreadyMarked(true);
    }
  };

  return (
    <div className="mark-attendance">
      <div className="mark-attendance__toolbar">
        <div className="mark-attendance__field">
          <label>Program</label>
          <select value={program} onChange={(e) => { setProgram(e.target.value); setSaved(false); }}>
            {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="mark-attendance__field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {alreadyMarked && !saved && (
        <div className="mark-attendance__warning">
          ⚠️ Attendance already marked for this date — saving will overwrite it.
        </div>
      )}

      {loading ? (
        <p className="mark-attendance__empty">Loading students...</p>
      ) : students.length === 0 ? (
        <div className="mark-attendance__empty">
          <UserPlus size={32} />
          <p>No students found for {program}</p>
          <p className="mark-attendance__hint">Add students from Students tab first</p>
        </div>
      ) : (
        <>
          <div className="mark-attendance__summary">
            <span className="mark-attendance__count mark-attendance__count--present">
              Present: {Object.values(records).filter(v => v === "Present").length}
            </span>
            <span className="mark-attendance__count mark-attendance__count--absent">
              Absent: {Object.values(records).filter(v => v === "Absent").length}
            </span>
            <span className="mark-attendance__count mark-attendance__count--leave">
              Leave: {Object.values(records).filter(v => v === "Leave").length}
            </span>
          </div>

          {students.map((s) => (
            <div key={s.id} className="mark-attendance__row">
              <div>
                <p className="mark-attendance__name">{s.name}</p>
                <p className="mark-attendance__roll">{s.roll_no}</p>
              </div>
              <div className="mark-attendance__buttons">
                <button
                  onClick={() => setStatus(s.id, "Present")}
                  className={`mark-attendance__btn mark-attendance__btn--present ${records[s.id] === "Present" ? "mark-attendance__btn--active" : ""}`}>
                  Present
                </button>
                <button
                  onClick={() => setStatus(s.id, "Absent")}
                  className={`mark-attendance__btn mark-attendance__btn--absent ${records[s.id] === "Absent" ? "mark-attendance__btn--active" : ""}`}>
                  Absent
                </button>
                <button
                  onClick={() => setStatus(s.id, "Leave")}
                  className={`mark-attendance__btn mark-attendance__btn--leave ${records[s.id] === "Leave" ? "mark-attendance__btn--active" : ""}`}>
                  Leave
                </button>
              </div>
            </div>
          ))}

          <button onClick={saveAttendance} disabled={saving} className="mark-attendance__save">
            {saving ? "Saving..." : "Save Attendance"}
          </button>
          {saved && (
            <p className="mark-attendance__confirm">
              <Check size={14} /> Attendance saved successfully for {date}
            </p>
          )}
        </>
      )}
    </div>
  );
}