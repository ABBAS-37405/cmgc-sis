import { useState, useEffect } from "react";
import { Check, UserPlus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./MarkAttendance.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];
const ALL_PROGRAMS = "All Programs";

const normalizeWhatsAppNumber = (value) => {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return `+${digits}`;
  if (digits.startsWith("0")) return `+92${digits.slice(1)}`;
  return `+${digits}`;
};

const buildAbsenceMessage = (studentName, rollNo, status, dateStr) => {
  const formattedDate = new Date(dateStr).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
  const statusText = status === "Leave" ? "on leave" : "absent";
  return [
    "Assalamualaikum,",
    "",
    `This is to inform you that your daughter ${studentName} (Roll No: ${rollNo}) is ${statusText} from CMGC today, ${formattedDate}.`,
    "",
    "Kindly ensure she is aware of and catches up on today's coursework. If this absence was unplanned or you have any concerns, please contact the college office.",
    "",
    "Regards,",
    "CMGC Administration",
  ].join("\n");
};

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.46 0 .09 5.37.09 11.95c0 2.11.55 4.09 1.51 5.81L0 24l6.4-1.68a11.86 11.86 0 0 0 5.64 1.43h.01c6.58 0 11.95-5.37 11.95-11.95 0-3.19-1.24-6.19-3.48-8.32ZM12.05 21.3h-.01a9.3 9.3 0 0 1-4.74-1.3l-.34-.2-3.53.93.94-3.44-.22-.35a9.3 9.3 0 0 1-1.43-4.99c0-5.14 4.19-9.33 9.34-9.33 2.49 0 4.83.97 6.59 2.73a9.26 9.26 0 0 1 2.73 6.6c0 5.15-4.19 9.35-9.33 9.35Zm5.34-6.98c-.29-.15-1.72-.85-1.99-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.3-.36.45-.54.15-.18.2-.31.3-.51.1-.2.05-.37-.03-.51-.08-.15-.6-1.46-.82-2-.22-.53-.44-.46-.6-.47-.16-.01-.34-.01-.52-.01-.18 0-.47.07-.72.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.13 2.86.14.18 1.86 2.84 4.5 3.87 2.65 1.03 2.65.69 3.12.64.47-.05 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.24-.16-.53-.31Z" />
    </svg>
  );
}

const sendAbsenceWhatsApp = (student, status, date) => {
  let phone = (student?.phone || "").trim();
  if (!phone) {
    const entered = window.prompt(`WhatsApp number missing for ${student.name}. Enter a number (03XXXXXXXXX):`, "");
    if (!entered || !entered.trim()) return false;
    phone = entered.trim();
  }
  const normalized = normalizeWhatsAppNumber(phone);
  const body = encodeURIComponent(buildAbsenceMessage(student.name, student.roll_no, status, date));
  const waUrl = `https://wa.me/${normalized.replace("+", "")}?text=${body}`;
  window.open(waUrl, "_blank", "noopener,noreferrer");
  return true;
};

export default function MarkAttendance({ allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({});
  const [program, setProgram] = useState(isRestricted ? (visiblePrograms[0] || ALL_PROGRAMS) : "Pre-Medical");
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
      .select("id, name, roll_no, program, phone")
      .order("program")
      .order("name");

    if (program !== ALL_PROGRAMS) {
      query = query.eq("program", program);
    }

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

  // If admin realizes a date was actually a holiday after already marking
  // attendance for it, switching "Classes Held" to No offers to wipe out
  // every attendance record for that date (across all programs), so
  // students' percentages on their portal recalculate correctly.
  const handleClassesHeldToggle = async (held) => {
    if (held) {
      setClassesHeld(true);
      return;
    }

    const { count } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("date", date);

    if (count > 0) {
      const confirmCancel = window.confirm(
        `Attendance for ${date} is already marked (${count} record${count === 1 ? "" : "s"} across all programs).\n\n` +
        "If today turned out to be a holiday, do you want to cancel (delete) all marked attendance for this date?"
      );
      if (confirmCancel) {
        await supabase.from("attendance").delete().eq("date", date);
        setAlreadyMarked(false);
        setSaved(false);
      }
    }

    setClassesHeld(false);
  };

  const absentees = students.filter((s) => records[s.id] === "Absent" || records[s.id] === "Leave");

  const notifyAbsentees = () => {
    if (absentees.length === 0) {
      alert("No students are marked Absent or Leave for this date.");
      return;
    }
    const confirmed = window.confirm(
      `This will open ${absentees.length} WhatsApp chat${absentees.length > 1 ? "s" : ""} (one per absent/leave student) with a pre-filled message for their parents. You'll need to press Send in each WhatsApp tab. Continue?`
    );
    if (!confirmed) return;
    absentees.forEach((s) => sendAbsenceWhatsApp(s, records[s.id], date));
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
            {!isRestricted && <option key={ALL_PROGRAMS}>{ALL_PROGRAMS}</option>}
            {visiblePrograms.map((p) => <option key={p}>{p}</option>)}
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
            onClick={() => handleClassesHeldToggle(true)}
            className={"mark-attendance__classes-btn mark-attendance__classes-btn--yes " + (classesHeld ? "mark-attendance__classes-btn--active" : "")}>
            Yes
          </button>
          <button
            type="button"
            onClick={() => handleClassesHeldToggle(false)}
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
            <button
              type="button"
              onClick={notifyAbsentees}
              disabled={absentees.length === 0}
              className="mark-attendance__notify-btn">
              <WhatsappIcon /> Notify Absent/Leave Parents ({absentees.length})
            </button>
          </div>

          {students.map((s) => (
            <div key={s.id} className="mark-attendance__row">
              <div>
                <p className="mark-attendance__name">
                  {s.name}
                  {program === ALL_PROGRAMS && (
                    <span className="mark-attendance__program-tag">{s.program}</span>
                  )}
                </p>
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
                {(records[s.id] === "Absent" || records[s.id] === "Leave") && (
                  <button
                    type="button"
                    onClick={() => sendAbsenceWhatsApp(s, records[s.id], date)}
                    className="mark-attendance__whatsapp-btn"
                    title={`Notify parent via WhatsApp — ${records[s.id]}`}>
                    <WhatsappIcon />
                  </button>
                )}
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