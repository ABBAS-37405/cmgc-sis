import { useState, useEffect } from "react";
import { Check, UserPlus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, shortGroup } from "../../lib/academics";
import { downloadXlsx, S, columnRef } from "../../lib/xlsx";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber } from "../../lib/whatsapp";
import WhatsAppQueue, { WhatsappIcon } from "../WhatsAppQueue/WhatsAppQueue";
import { useWhatsAppQueue } from "../WhatsAppQueue/useWhatsAppQueue";
import "./MarkAttendance.css";

const ALL_PROGRAMS = "All Programs";

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

// Her WhatsApp number first, phone only as a fallback — the two are often
// different, and a number on file may have no WhatsApp on it at all.
//
// This is the single-row button, and the prompt is why it is not what the bulk
// run uses: a modal half way through a queue strands every recipient after it.
// The queue screens for usable numbers before it starts instead.
const sendAbsenceWhatsApp = (student, status, date) => {
  let number = whatsappNumberFor(student);
  if (!isValidWhatsAppNumber(number)) {
    const entered = window.prompt(
      `WhatsApp number for ${student.name} is missing or invalid. Enter one (03XXXXXXXXX):`,
      number || ""
    );
    if (!entered || !entered.trim()) return false;
    number = entered.trim();
  }
  return openWhatsApp(number, buildAbsenceMessage(student.name, student.roll_no, status, date));
};

export default function MarkAttendance({ allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState({});
  const [program, setProgram] = useState(isRestricted ? (visiblePrograms[0] || ALL_PROGRAMS) : "Pre-Medical");
  const [yearFilter, setYearFilter] = useState("Both");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [downloadMonth, setDownloadMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyMarked, setAlreadyMarked] = useState(false);
  const [classesHeld, setClassesHeld] = useState(true);
  // The admin confirms once and then never touches this tab again — the queue
  // walks itself as she comes back from each chat. Everything about how that
  // works lives in useWhatsAppQueue, which is the only implementation of it.
  const wa = useWhatsAppQueue();

  const fetchStudents = async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      .select("id, name, roll_no, program, phone, whatsapp")
      .is("deleted_at", null)
      .order("program")
      .order("name");

    if (program !== ALL_PROGRAMS) {
      query = query.eq("program", program);
    } else if (isRestricted) {
      // "All Programs" means all of *hers*, never the whole college — a teacher
      // assigned Pre-Engineering, ICS and General Science must not see
      // Pre-Medical girls here.
      query = query.in("program", visiblePrograms);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, yearFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAttendanceForDate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, students, classesHeld]);

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

  const monthLabel = (monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
  };

  const monthOptions = () => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 12; i += 1) {
      const dt = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      options.push({ key, label: monthLabel(key) });
    }
    return options;
  };

  // The register is read column by column, so the roll number is shown as its
  // last three digits — the part that actually differs between two girls in the
  // same class. The full CMGC-YYYY-NNNNN is the same prefix for all of them and
  // would cost the width three day columns need.
  const shortRollNo = (rollNo) => {
    const digits = String(rollNo || "").replace(/\D/g, "");
    return digits ? digits.slice(-3) : String(rollNo || "");
  };

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const fetchStudentsForSheet = async () => {
    let query = supabase
      .from("students")
      .select("id, name, roll_no, program, year_of_study")
      .is("deleted_at", null)
      .order("program", { ascending: true })
      .order("name", { ascending: true });

    if (program !== ALL_PROGRAMS) {
      query = query.eq("program", program);
    } else if (allowedPrograms.length > 0) {
      query = query.in("program", visiblePrograms);
    }

    if (yearFilter !== "Both") {
      query = query.eq("year_of_study", yearFilter);
    }

    const { data } = await query;
    return data || [];
  };

  const fetchAttendanceForMonth = async (studentIds) => {
    const [year, month] = downloadMonth.split("-").map(Number);
    const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    const dayCount = new Date(year, month, 0).getDate();
    const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(dayCount).padStart(2, "0")}`;

    const { data } = await supabase
      .from("attendance")
      .select("student_id, date, status")
      .in("student_id", studentIds)
      .gte("date", dateFrom)
      .lte("date", dateTo);

    return data || [];
  };

  const buildAttendanceRows = (studentsList, attendanceData, emptySheet, daysInMonth) => {
    const attendanceMap = new Map();

    attendanceData.forEach((row) => {
      const day = Number(row.date.slice(8, 10));
      attendanceMap.set(`${row.student_id}:${day}`, row.status);
    });

    const grouped = new Map();
    const order = visiblePrograms.length > 0 ? visiblePrograms : PROGRAMS;
    order.forEach((programKey) => grouped.set(programKey, []));
    studentsList.forEach((student) => {
      if (!grouped.has(student.program)) grouped.set(student.program, []);
      grouped.get(student.program).push(student);
    });

    const rows = [];
    grouped.forEach((studentsInProgram, programKey) => {
      if (studentsInProgram.length === 0) return;
      // Banded across the whole width, otherwise the group name reads as a
      // stray grey cell in column A.
      rows.push([
        { v: programKey, s: S.BAND },
        ...Array.from({ length: daysInMonth + 5 }, () => ({ v: "", s: S.BAND })),
      ]);
      studentsInProgram.forEach((student) => {
        const dayCells = [];
        let present = 0;
        let absent = 0;
        let leave = 0;

        for (let day = 1; day <= daysInMonth; day += 1) {
          const status = attendanceMap.get(`${student.id}:${day}`);
          let value = "";
          if (!emptySheet && status) {
            value = status === "Present" ? "P" : status === "Absent" ? "A" : status === "Leave" ? "L" : "";
            if (value === "P") present += 1;
            if (value === "A") absent += 1;
            if (value === "L") leave += 1;
          }
          // Styled even when empty: a blank sheet still needs its boxes to
          // write into by hand.
          dayCells.push({ v: value, s: S.CENTER });
        }

        rows.push([
          { v: shortRollNo(student.roll_no), s: S.CENTER },
          { v: student.name, s: S.TEXT },
          { v: shortGroup(student.program), s: S.CENTER },
          ...dayCells,
          { v: emptySheet ? "" : present, s: S.CENTER },
          { v: emptySheet ? "" : absent, s: S.CENTER },
          { v: emptySheet ? "" : leave, s: S.CENTER },
        ]);
      });
      rows.push([]);
    });

    return rows;
  };

  const downloadAttendanceSheet = async (emptySheet = false) => {
    const studentsList = await fetchStudentsForSheet();

    if (studentsList.length === 0) {
      alert("No students found for the selected year/program scope.");
      return;
    }

    const attendanceData = emptySheet ? [] : await fetchAttendanceForMonth(studentsList.map((s) => s.id));
    const [year, month] = downloadMonth.split("-").map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const title = emptySheet ? "Blank Attendance Sheet" : "Attendance Sheet";
    const sheetTitle = `${title} - ${monthLabel(downloadMonth)} ${yearFilter}`;

    const headerRows = [
      [{ v: "Community Model Girls College", s: S.TITLE }],
      [{ v: sheetTitle, s: S.LABEL }],
      [`Month: ${monthLabel(downloadMonth)}`, `Year filter: ${yearFilter}`],
      [`Generated: ${new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}`],
      [],
    ];

    // Two heading rows: the date on top, its weekday underneath. Rno / Name /
    // Group are merged down through both. Sundays are tinted so a blank sheet
    // shows at a glance which columns are not working days.
    const dayNumbers = [];
    const dayLabels = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const weekday = new Date(year, month - 1, day).getDay();
      const style = weekday === 0 ? S.HEAD_OFF : S.HEAD;
      dayNumbers.push({ v: day, s: style });
      dayLabels.push({ v: DAY_NAMES[weekday], s: style });
    }

    const dateRow = [
      { v: "Rno", s: S.HEAD },
      { v: "Name", s: S.HEAD },
      { v: "Group", s: S.HEAD },
      ...dayNumbers,
      { v: "P", s: S.HEAD },
      { v: "A", s: S.HEAD },
      { v: "L", s: S.HEAD },
    ];
    const weekdayRow = [
      { v: "", s: S.HEAD },
      { v: "", s: S.HEAD },
      { v: "", s: S.HEAD },
      ...dayLabels,
      { v: "", s: S.HEAD },
      { v: "", s: S.HEAD },
      { v: "", s: S.HEAD },
    ];

    const rows = [
      ...headerRows,
      dateRow,
      weekdayRow,
      ...buildAttendanceRows(studentsList, attendanceData, emptySheet, daysInMonth),
    ];

    // Rows are 1-indexed in the file; the two heading rows are the 6th and 7th.
    const headRow = headerRows.length + 1;
    const spannedColumns = [0, 1, 2, daysInMonth + 3, daysInMonth + 4, daysInMonth + 5];
    const merges = spannedColumns.map((c) => `${columnRef(c)}${headRow}:${columnRef(c)}${headRow + 1}`);

    const columns = [
      { width: 6 },
      { width: 26 },
      { width: 8 },
      ...Array.from({ length: daysInMonth }, () => ({ width: 3.8 })),
      { width: 5 },
      { width: 5 },
      { width: 5 },
    ];

    const filename = `${title.replace(/ /g, "_")}_${downloadMonth}_${yearFilter.replace(/ /g, "_")}.xlsx`;

    await downloadXlsx(filename, {
      sheetName: monthLabel(downloadMonth),
      rows,
      columns,
      merges,
      // Below the headings, right of the Group column.
      freeze: { row: headRow + 1, col: 3 },
    });
  };

  const notifyAbsentees = () => {
    if (absentees.length === 0) {
      alert("No students are marked Absent or Leave for this date.");
      return;
    }

    // Screened here rather than inside the run: the queue must never stop on a
    // prompt, so anyone without a usable number is set aside up front and named
    // when it finishes.
    const entries = [];
    const skipped = [];
    absentees.forEach((s) => {
      const number = whatsappNumberFor(s);
      if (!isValidWhatsAppNumber(number)) {
        skipped.push(s);
        return;
      }
      entries.push({
        id: s.id,
        name: s.name,
        number,
        message: buildAbsenceMessage(s.name, s.roll_no, records[s.id], date),
      });
    });

    wa.start({ entries, skipped, what: "the absence message", recipientNoun: "parent" });
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
            {visiblePrograms.length > 1 && <option key={ALL_PROGRAMS}>{ALL_PROGRAMS}</option>}
            {visiblePrograms.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="mark-attendance__field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="mark-attendance__field">
          <label>Download month</label>
          <select value={downloadMonth} onChange={(e) => setDownloadMonth(e.target.value)}>
            {monthOptions().map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
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
          <div className="mark-attendance__download-controls">
            <button
              type="button"
              onClick={() => downloadAttendanceSheet(false)}
              className="mark-attendance__btn mark-attendance__download-btn"
            >
              Download Filled Attendance Sheet
            </button>
            <button
              type="button"
              onClick={() => downloadAttendanceSheet(true)}
              className="mark-attendance__btn mark-attendance__download-btn"
            >
              Download Blank Attendance Sheet
            </button>
          </div>

          <WhatsAppQueue queue={wa.queue} onNext={wa.next} onStop={wa.stop} />

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