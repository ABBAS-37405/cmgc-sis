import { useState, useEffect, useRef } from "react";
import { Check, UserPlus, UserMinus, Undo2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, shortGroup } from "../../lib/academics";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
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

/**
 * The warning sent to a girl who is off the attendance register: come to the
 * office, or her name is struck off.
 *
 * It is deliberately not the absence message with harder words. That one reports a
 * day; this one is the last step before her enrolment ends, so it says what has
 * already happened (she is off the register), what is being asked (come in), and
 * what follows if nobody does — in that order, with no date invented for the
 * deadline. Where she is asked to reply is honest too: this arrives from whichever
 * WhatsApp the office is signed into, so replying to it reaches the college.
 */
const buildStruckOffMessage = (studentName, rollNo) => [
  "Assalamualaikum,",
  "",
  `Your daughter ${studentName} (Roll No: ${rollNo}) has not been attending classes at CMGC, and her name has been taken off the daily attendance register.`,
  "",
  "Please contact the college office immediately — reply to this message or come to the office — and tell us whether she intends to continue her studies.",
  "",
  "If we do not hear from you, her name will be struck off the college rolls.",
  "",
  "Regards,",
  "CMGC Administration",
].join("\n");

// Her WhatsApp number first, phone only as a fallback — the two are often
// different, and a number on file may have no WhatsApp on it at all.
//
// This is the single-row path, and the prompt is why it is not what the bulk run
// uses: a modal half way through a queue strands every recipient after it. The
// queue screens for usable numbers before it starts instead.
const openChatWith = (student, message) => {
  let number = whatsappNumberFor(student);
  if (!isValidWhatsAppNumber(number)) {
    const entered = window.prompt(
      `WhatsApp number for ${student.name} is missing or invalid. Enter one (03XXXXXXXXX):`,
      number || ""
    );
    if (!entered || !entered.trim()) return false;
    number = entered.trim();
  }
  return openWhatsApp(number, message);
};

const sendAbsenceWhatsApp = (student, status, date) =>
  openChatWith(student, buildAbsenceMessage(student.name, student.roll_no, status, date));

/**
 * `adminProfile` is passed by the admin portal and left out by the teacher portal,
 * so only a super admin ever sees the two controls it gates: taking a girl out of
 * the daily register, and the tab that lists whoever is out.
 *
 * The gate is cosmetic, as everywhere else in this app. The real one is the
 * `protect_student_fields` trigger in supabase_attendance_exclusion.sql, which
 * raises if anyone but a super admin writes those columns.
 */
export default function MarkAttendance({ allowedPrograms = [], adminProfile = null }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;
  const canExclude = !!adminProfile?.is_super_admin;

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
  // "register" is the roster everyone sees; "excluded" is the super admin's list of
  // girls taken out of it.
  const [view, setView] = useState("register");
  const [excluded, setExcluded] = useState([]);
  const [excludedLoading, setExcludedLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  /*
   * Taking a girl out (or putting her back) changes `students`, which re-runs the
   * effect that loads the day's register — and that rebuilds it from the database,
   * silently throwing away whatever the admin had ticked but not yet saved. The
   * marks on screen are carried across that one reload instead of being lost.
   */
  const carryRecordsRef = useRef(null);
  // The admin confirms once and then never touches this tab again — the queue
  // walks itself as she comes back from each chat. Everything about how that
  // works lives in useWhatsAppQueue, which is the only implementation of it.
  const wa = useWhatsAppQueue();

  /*
   * The roster the filters describe: the one marked on screen and the one the
   * spreadsheet is built from are this same query with different columns.
   *
   * Girls taken out of the register are left out of both. They are still enrolled —
   * they are simply not part of the daily roll call.
   *
   * The retry is for a deploy that lands before supabase_attendance_exclusion.sql is
   * pasted into the dashboard: PostgREST answers a filter on an unknown column with
   * 42703, and this is the screen the office fills in every morning, so it falls
   * back to the whole roster rather than showing an empty class for no stated
   * reason. Returns null (rather than []) when the query itself failed, so a
   * network blip leaves the list on screen alone.
   */
  const fetchRoster = async (fields) => {
    const build = (excludeOutOfRegister) => {
      let query = supabase
        .from("students")
        .select(fields)
        .is("deleted_at", null)
        .order("program")
        .order("name");

      if (excludeOutOfRegister) query = query.is("attendance_excluded_at", null);

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

      return query;
    };

    const { data, error } = await build(true);
    if (error?.code === "42703") {
      const retry = await build(false);
      return retry.data || null;
    }
    return data || null;
  };

  const fetchStudents = async () => {
    setLoading(true);
    const data = await fetchRoster("id, name, roll_no, program, year_of_study, phone, whatsapp");
    if (data) setStudents(data);
    setLoading(false);
  };

  /*
   * The girls who are out of the register, and deliberately NOT filtered by the
   * program/year selectors above: whoever was taken out has to stay findable, and
   * hunting for her by remembering which filter she was excluded under is exactly
   * the way a girl stays out of the register for a term by accident. The list is
   * still scoped to the programs this admin may see.
   */
  const fetchExcluded = async () => {
    if (!canExclude) return;
    setExcludedLoading(true);
    let query = supabase
      .from("students")
      .select("id, name, roll_no, program, year_of_study, phone, whatsapp, attendance_excluded_at, attendance_excluded_reason")
      .is("deleted_at", null)
      .not("attendance_excluded_at", "is", null)
      .order("program")
      .order("name");

    if (isRestricted) query = query.in("program", visiblePrograms);

    const { data } = await query;
    setExcluded(data || []);
    setExcludedLoading(false);
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

    // Unsaved marks from before the roster changed win over what is in the
    // database: they are the newer answer, and the admin never asked for them to
    // be reloaded. Consumed once — a date change still reloads properly.
    const carried = carryRecordsRef.current;
    carryRecordsRef.current = null;

    const initial = {};
    students.forEach((s) => {
      if (carried && carried[s.id]) initial[s.id] = carried[s.id];
      else if (saved[s.id]) initial[s.id] = saved[s.id];
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

  // Loaded once for the tab's count, not per filter — the list ignores the filters
  // by design.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchExcluded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canExclude, allowedPrograms]);

  useEffect(() => {
    loadAttendanceForDate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, students, classesHeld]);

  // "Classes held?" is a question about this class on this date, so changing either
  // asks it again instead of carrying the last answer across. Without this, an
  // admin who marked 1st year as off and then switched to 2nd year would find the
  // 2nd year roster unmarked and no one auto-present, for no visible reason.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClassesHeld(true);
  }, [program, yearFilter, date]);

  const setStatus = (id, status) => {
    setRecords((p) => ({ ...p, [id]: status }));
    setSaved(false);
  };

  // Who the toggle and its confirmation are talking about: the roster currently on
  // screen, named the way the admin picked it.
  const yearLabel = yearFilter === "Both" ? "both years" : yearFilter;
  const programLabel = program === ALL_PROGRAMS
    ? (isRestricted ? "your programs" : "all programs")
    : program;
  const selectionLabel = `${yearLabel} · ${programLabel}`;

  /**
   * "Classes held?" answers for the class on screen, not for the college.
   *
   * A college day is rarely all-or-nothing: 2nd year sits an exam while 1st year is
   * sent home, one year comes in for practicals during holidays. This toggle used to
   * delete every attendance row for the date **across all programs and both years**,
   * so answering No while looking at 1st year silently wiped the 2nd year register
   * that had just been filled in.
   *
   * It is now scoped to exactly the students listed below it — the same
   * program/year filter the roster is built from — and says so before deleting.
   * Answering No for one year and Yes for the other is the intended way to record a
   * day when only one of them had classes.
   *
   * Nothing needs to be saved for a class that had no college: an unmarked day is
   * not an absence anywhere in this app, so leaving the register empty is the
   * accurate record. Deleting only matters when the day was already marked.
   */
  const handleClassesHeldToggle = async (held) => {
    if (held) {
      setClassesHeld(true);
      return;
    }

    const studentIds = students.map((s) => s.id);

    if (studentIds.length > 0) {
      const { count } = await supabase
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("date", date)
        .in("student_id", studentIds);

      if (count > 0) {
        const confirmCancel = window.confirm(
          `Attendance for ${date} is already marked for ${selectionLabel} ` +
          `(${count} record${count === 1 ? "" : "s"}).\n\n` +
          `If ${selectionLabel} had no classes on this date, delete those records?\n\n` +
          "Every other class keeps its attendance."
        );
        if (confirmCancel) {
          // A delete RLS refuses comes back as a plain success with no rows, so the
          // rows are asked for and an empty result is treated as a failure.
          const { data: removed, error } = await supabase
            .from("attendance")
            .delete()
            .eq("date", date)
            .in("student_id", studentIds)
            .select("id");

          if (error || !removed || removed.length === 0) {
            alert(error ? `Could not cancel the attendance: ${error.message}` : WRITE_BLOCKED_HINT);
            return;
          }
          setAlreadyMarked(false);
          setSaved(false);
        }
      }
    }

    setClassesHeld(false);
  };

  /*
   * Out of the register — not deleted, not passed out.
   *
   * A girl on long medical leave, one studying privately, one who has stopped
   * coming but whose record the office is not ready to close: left in the roster she
   * is marked Absent every day by whoever fills it in, and the percentage her
   * parents are sent collapses for a reason that has nothing to do with her.
   *
   * Nothing already recorded is touched. This stops new marks from being offered;
   * it does not rewrite the ones she has, which is why her old attendance still
   * appears on her portal and in her reports.
   *
   * One dialog, because the reason is worth having and a second box for it would
   * read as a second confirmation: OK does it, Cancel does not, and an empty reason
   * is fine.
   */
  const excludeFromAttendance = async (student) => {
    const reason = window.prompt(
      `Take ${student.name} out of the daily attendance register?\n\n` +
      "She stays enrolled and keeps every attendance mark already recorded — she simply stops " +
      "appearing here until she is added back from the Out of Attendance tab.\n\n" +
      "Reason (optional):",
      ""
    );
    if (reason === null) return;

    setBusyId(student.id);
    const { data, error } = await supabase
      .from("students")
      .update({
        attendance_excluded_at: new Date().toISOString(),
        attendance_excluded_reason: reason.trim() || null,
      })
      .eq("id", student.id)
      .select("id");
    setBusyId(null);

    if (error || !data || data.length === 0) {
      alert(error ? `Could not take her out of the register: ${error.message}` : WRITE_BLOCKED_HINT);
      return;
    }

    const rest = { ...records };
    delete rest[student.id];
    carryRecordsRef.current = rest;
    setStudents((prev) => prev.filter((s) => s.id !== student.id));
    fetchExcluded();
  };

  const restoreToAttendance = async (student) => {
    if (!window.confirm(
      `Put ${student.name} back into the daily attendance register?\n\n` +
      "She will appear in the roster again from today. The days she was out stay unmarked, " +
      "and an unmarked day is never counted as an absence."
    )) return;

    setBusyId(student.id);
    const { data, error } = await supabase
      .from("students")
      .update({ attendance_excluded_at: null, attendance_excluded_reason: null })
      .eq("id", student.id)
      .select("id");
    setBusyId(null);

    if (error || !data || data.length === 0) {
      alert(error ? `Could not put her back in the register: ${error.message}` : WRITE_BLOCKED_HINT);
      return;
    }

    setExcluded((prev) => prev.filter((s) => s.id !== student.id));
    // She belongs in the roster again, but only if she is inside the filters on
    // screen — fetchStudents decides that, not this handler.
    carryRecordsRef.current = records;
    fetchStudents();
  };

  const absentees = students.filter((s) => records[s.id] === "Absent" || records[s.id] === "Leave");

  // How many of the girls out of the register belong to the class on screen — the
  // register itself never shows them, so it says how many are missing and why.
  const excludedHere = excluded.filter((s) =>
    (program === ALL_PROGRAMS || s.program === program) &&
    (yearFilter === "Both" || s.year_of_study === yearFilter)
  );

  /*
   * The warning, sent to every parent on this list at once.
   *
   * A queue and not a loop, like every other bulk send here, and screened before it
   * starts because a prompt for a missing number half way through would strand
   * everyone after it — whoever has no usable number is named when the run
   * finishes rather than stopping it.
   *
   * Deliberately a separate button from the per-row one: this list holds girls who
   * have stopped coming and girls on leave the office already agreed to, and only
   * the office can tell them apart. The confirm says how many, and the row button
   * is there for when the answer is "her, but not her".
   */
  const warnAllStruckOff = () => {
    const entries = [];
    const skipped = [];
    excluded.forEach((s) => {
      const number = whatsappNumberFor(s);
      if (!isValidWhatsAppNumber(number)) {
        skipped.push(s);
        return;
      }
      entries.push({
        id: s.id,
        name: s.name,
        number,
        message: buildStruckOffMessage(s.name, s.roll_no),
      });
    });

    wa.start({ entries, skipped, what: "the struck-off warning", recipientNoun: "parent" });
  };

  // Each view renders its own copy of the banner, so a switch either way ends the
  // run: a queue that keeps opening chats with nothing on screen saying so is the
  // one thing that banner exists to prevent.
  const changeView = (next) => {
    if (next !== view) wa.stop();
    setView(next);
  };

  const excludedSince = (value) => {
    if (!value) return "";
    return new Date(value).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  };

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

  // Same roster as the screen, so the sheet the office writes on by hand matches
  // the one it marks here — a girl out of the register is on neither.
  const fetchStudentsForSheet = async () =>
    (await fetchRoster("id, name, roll_no, program, year_of_study")) || [];

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
          `${selectionLabel} is marked as having had no classes on this date, so nobody is auto-present.\n\n` +
          "If that is right, there is nothing to save — an unmarked day is not counted as an absence. " +
          "If some girls did attend, mark each of them first:\n\n" +
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

  // Only the super admin has a second view to switch to, so only she sees the
  // switcher at all.
  const viewTabs = canExclude && (
    <div className="mark-attendance__views" role="group" aria-label="Attendance views">
      <button
        type="button"
        onClick={() => changeView("register")}
        className={"mark-attendance__view-btn " + (view === "register" ? "mark-attendance__view-btn--active" : "")}>
        Attendance Register
      </button>
      <button
        type="button"
        onClick={() => changeView("excluded")}
        className={"mark-attendance__view-btn " + (view === "excluded" ? "mark-attendance__view-btn--active" : "")}>
        Out of Attendance ({excluded.length})
      </button>
    </div>
  );

  if (canExclude && view === "excluded") {
    return (
      <div className="mark-attendance">
        {viewTabs}
        <p className="mark-attendance__hint-line">
          These girls are still enrolled and keep every attendance mark already recorded — they are only
          left out of the daily roll call. This list covers every program you can see, not the filters on
          the register.
        </p>

        {excluded.length > 0 && (
          <>
            <div className="mark-attendance__summary">
              <button
                type="button"
                onClick={warnAllStruckOff}
                className="mark-attendance__warn-btn">
                <WhatsappIcon /> Send Struck-Off Warning to All ({excluded.length})
              </button>
            </div>
            <p className="mark-attendance__hint-line">
              That message tells her parents to contact the office immediately or her name will be struck off
              the college rolls. Send it to the girls who have simply stopped coming — for one on leave the
              office already agreed to, use the button on her own row, or nothing at all.
            </p>
            <WhatsAppQueue queue={wa.queue} onNext={wa.next} onStop={wa.stop} />
          </>
        )}

        {excludedLoading ? (
          <p className="mark-attendance__empty">Loading...</p>
        ) : excluded.length === 0 ? (
          <div className="mark-attendance__empty">
            <UserMinus size={32} />
            <p>Nobody is out of the attendance register</p>
            <p className="mark-attendance__hint">
              Use “Out of register” beside a girl on the register to take her out.
            </p>
          </div>
        ) : (
          excluded.map((s) => (
            <div key={s.id} className="mark-attendance__row">
              <div>
                <p className="mark-attendance__name">
                  {s.name}
                  <span className="mark-attendance__program-tag">{s.program}</span>
                  {s.year_of_study && <span className="mark-attendance__program-tag">{s.year_of_study}</span>}
                </p>
                <p className="mark-attendance__roll">{s.roll_no}</p>
                <p className="mark-attendance__excluded-note">
                  Out of the register since {excludedSince(s.attendance_excluded_at)}
                  {s.attendance_excluded_reason ? ` — ${s.attendance_excluded_reason}` : ""}
                </p>
              </div>
              <div className="mark-attendance__buttons">
                <button
                  type="button"
                  onClick={() => openChatWith(s, buildStruckOffMessage(s.name, s.roll_no))}
                  className="mark-attendance__warn-btn"
                  title={`Warn ${s.name}'s parents that her name will be struck off unless they contact the office`}>
                  <WhatsappIcon /> Warn Parents
                </button>
                <button
                  type="button"
                  onClick={() => restoreToAttendance(s)}
                  disabled={busyId === s.id}
                  className="mark-attendance__restore-btn">
                  <Undo2 size={14} /> {busyId === s.id ? "Adding back..." : "Add Back to Attendance"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="mark-attendance">
      {viewTabs}
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
        <span className="mark-attendance__classes-label">
          Classes held for <strong>{selectionLabel}</strong> on this date?
        </span>
        <div className="mark-attendance__classes-toggle" role="group" aria-label={`Were classes held for ${selectionLabel} on this date`}>
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

      {classesHeld && (
        <div className="mark-attendance__hint-line">
          This answers for <strong>{selectionLabel}</strong> only. If one year had classes and the other did not,
          mark the year that came in and leave the other alone — an unmarked day is never counted as an absence.
        </div>
      )}

      {!classesHeld && (
        <div className="mark-attendance__warning">
          ℹ️ No classes for <strong>{selectionLabel}</strong> on this date — nobody here is auto-present, and every
          other class keeps its attendance. Leave this roster empty, or mark each girl individually before saving.
        </div>
      )}

      {alreadyMarked && !saved && (
        <div className="mark-attendance__warning">
          ⚠️ Attendance already marked for this date — saving will overwrite it.
        </div>
      )}

      {/* The register cannot show who is missing from it, so it says so. */}
      {canExclude && excludedHere.length > 0 && (
        <div className="mark-attendance__hint-line">
          {excludedHere.length === 1
            ? `1 girl in ${selectionLabel} is out of the register and is not listed below`
            : `${excludedHere.length} girls in ${selectionLabel} are out of the register and are not listed below`}
          {" "}— open the <strong>Out of Attendance</strong> tab to put them back.
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
                {canExclude && (
                  <button
                    type="button"
                    onClick={() => excludeFromAttendance(s)}
                    disabled={busyId === s.id}
                    className="mark-attendance__exclude-btn"
                    title={`Take ${s.name} out of the daily attendance register — she stays enrolled`}>
                    <UserMinus size={14} /> Out of register
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