import { useState, useEffect } from "react";
import { Check, UserPlus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./MarkAttendance.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];

export default function MarkAttendance() {
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({});
  const [program, setProgram] = useState("Pre-Medical");
  const [yearFilter, setYearFilter] = useState("Both");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyMarked, setAlreadyMarked] = useState(false);
  const [classesHeld, setClassesHeld] = useState(true);

  useEffect(() => {
    fetchStudents();
  }, [program, yearFilter]);

  useEffect(() => {
    loadAttendanceForDate();
  }, [date, students, classesHeld]);

  const fetchStudents = async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      .select("id, name, roll_no")
      .eq("program", program)
      .order("name");

    if (yearFilter !== "Both") {
      query = query.eq("year_of_study", yearFilter);
    }

    const { data } = await query;
    if (data) setStudents(data);
    setLoading(false);
  };

  // Loads any attendance already saved for this date so it isn't overwritten
  // by the default; students with no saved record fall back to the
  // classesHeld default (auto-Present, or unmarked if classes weren't held).
  const loadAttendanceForDate = async () => {
    if (students.length === 0) return;
    const studentIds = students.map((s) => s.id);
    const { data } = await supabase
      .from("attendance")
      .select("student_id, status")
      .eq("date", date)
      .in("student_id", studentIds);

    const saved = {};
    (data || []).forEach((r) => { saved[r.student_id] = r.status; });

    const initial = {};
    students.forEach((s) => {
      if (saved[s.id]) initial[s.id] = saved[s.id];
      else if (classesHeld) initial[s.id] = "Present";
    });

    setRecords(initial);
    setAlreadyMarked(Object.keys(saved).length > 0);
    setSaved(false);
  };

  const setStatus = (id, status) => {
    setRecords((p) => ({ ...p, [id]: status }));
    setSaved(false);
  };

  const saveAttendance = async () => {
    if (!classesHeld) {
      const unmarked = students.filter((s) => !records[s.id]);
      if (unmarked.length > 0) {
        alert(
          "Classes are marked as not held today, so nobody is auto-present. Please mark each student individually before saving:\n\n" +
          unmarked.map((s) => "- " + s.name).join("\n")
        );
        return;
      }
    }
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

      <div className="mark-attendance__year-filters" role="group" aria-label="Filter by class year">
        <button onClick={() => setYearFilter("1st Year")} className={"mark-attendance__year-btn " + (yearFilter === "1st Year" ? "mark-attendance__year-btn--active" : "")}>1st Year</button>
        <button onClick={() => setYearFilter("2nd Year")} className={"mark-attendance__year-btn " + (yearFilter === "2nd Year" ? "mark-attendance__year-btn--active" : "")}>2nd Year</button>
        <button onClick={() => setYearFilter("Both")} className={"mark-attendance__year-btn " + (yearFilter === "Both" ? "mark-attendance__year-btn--active" : "")}>Both</button>
      </div>

      <div className="mark-attendance__classes-toggle-wrap">
        <span className="mark-attendance__classes-label">College Classes Held Today?</span>
        <div className="mark-attendance__classes-toggle" role="group" aria-label="Were classes held today">
          <button
            type="button"
            onClick={() => setClassesHeld(true)}
            className={"mark-attendance__classes-btn mark-attendance__classes-btn--yes " + (classesHeld ? "mark-attendance__classes-btn--active" : "")}>
            Yes
          </button>
          <button
            type="button"
            onClick={() => setClassesHeld(false)}
            className={"mark-attendance__classes-btn mark-attendance__classes-btn--no " + (!classesHeld ? "mark-attendance__classes-btn--active" : "")}>
            No
          </button>
        </div>
      </div>

      {!classesHeld && (
        <div className="mark-attendance__warning">
          ℹ️ Classes marked as not held — no student is auto-present. Mark each student individually before saving.
        </div>
      )}

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
            {!classesHeld && (
              <span className="mark-attendance__count mark-attendance__count--unmarked">
                Unmarked: {students.filter((s) => !records[s.id]).length}
              </span>
            )}
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