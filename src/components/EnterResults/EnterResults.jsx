import { useState, useEffect, useMemo } from "react";
import { Check, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/adminAuth";
import { groupHasChoice } from "../../lib/academics";
import { studiedSubjects, splitOwnSubjects } from "../../lib/studentSubjects";
import { summariseTests } from "../../lib/monthlyReport";
import { EXAM_TYPES, CLASS_TEST_EXAM_TYPE } from "../../lib/exams";
import "./EnterResults.css";

const ALL_PROGRAMS = "All Programs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EXAM_SELECTION_KEY = "cmgc_admin_exam_selection";

const todayStr = () => new Date().toISOString().split("T")[0];
const currentMonthName = () => MONTHS[new Date().getMonth()];

// Built from the string's own parts, never `new Date(string)` — a test dated
// the 1st must not slide into the month before for anyone east of Greenwich.
const monthKeyOf = (dateStr) => String(dateStr || "").slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en-PK", { month: "long", year: "numeric" });
};
const fmtCtDate = (value) => {
  const [y, m, d] = String(value || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
};
const ctPctClass = (p) => {
  if (p === null || p === undefined) return "";
  if (p >= 80) return "enter-results__ct-pct--high";
  if (p >= 50) return "enter-results__ct-pct--mid";
  return "enter-results__ct-pct--low";
};

const loadStoredExamSelection = () => {
  try {
    const raw = localStorage.getItem(EXAM_SELECTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const buildExamName = (examType, examDate, examMonth) => {
  if (examType === "Monthly Test") {
    return `Monthly Test - ${examMonth} ${new Date().getFullYear()}`;
  }
  if (!examDate) return examType;
  const formattedDate = new Date(examDate).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
  return `${examType} - ${formattedDate}`;
};

export default function EnterResults({ allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  // Open on every group she was assigned rather than the first one PROGRAMS lists —
  // the same default that showed an Economics teacher one girl out of ten. The query
  // below already narrows "All Programs" to hers.
  const [program, setProgram] = useState(
    isRestricted
      ? (visiblePrograms.length > 1 ? ALL_PROGRAMS : (visiblePrograms[0] || ALL_PROGRAMS))
      : "Pre-Medical",
  );
  const [yearFilter, setYearFilter] = useState("Both");
  const storedExam = loadStoredExamSelection();
  const [examType, setExamType] = useState(storedExam?.examType || EXAM_TYPES[0]);
  const [examDate, setExamDate] = useState(storedExam?.examDate || todayStr());
  const [examMonth, setExamMonth] = useState(storedExam?.examMonth || currentMonthName());
  const examName = buildExamName(examType, examDate, examMonth);
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState({});
  const [totalMarks, setTotalMarks] = useState({});
  const [extraSubjects, setExtraSubjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Class Test mode reads what teachers already entered in ClassTestEntry
  // (class_tests / class_test_marks) rather than writing into `results` —
  // there is nothing to save here, only a roster-wide view of it.
  const [ctRows, setCtRows] = useState([]);
  const [ctChecked, setCtChecked] = useState(new Set());
  const [ctLoading, setCtLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(EXAM_SELECTION_KEY, JSON.stringify({ examType, examDate, examMonth }));
  }, [examType, examDate, examMonth]);

  // One query for the whole roster on screen, never one per student — the
  // same rule every other performance screen in the app follows.
  const fetchClassTestData = async (ids) => {
    if (ids.length === 0) {
      setCtRows([]);
      return;
    }
    setCtLoading(true);
    const { data } = await supabase
      .from("class_test_marks")
      .select("student_id, marks_obtained, is_absent, class_tests!inner(id, subject, title, test_date, total_marks)")
      .in("student_id", ids);
    setCtRows((data || []).filter((r) => r.class_tests));
    setCtLoading(false);
  };

  useEffect(() => {
    if (examType !== CLASS_TEST_EXAM_TYPE) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchClassTestData(students.map((s) => s.id));
  }, [examType, students]);

  // Every month a test was actually conducted in, newest first. Re-derived
  // whenever the roster (program/year) changes, and the checked set resets to
  // "all" with it — the same convention MarkAttendance uses for its own
  // filters: a changed scope opens showing everything until narrowed by hand.
  const ctMonths = useMemo(() => {
    const set = new Set(ctRows.map((r) => monthKeyOf(r.class_tests?.test_date)));
    return [...set].filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [ctRows]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCtChecked(new Set(ctMonths));
  }, [ctMonths]);

  const toggleCtMonth = (m) => {
    setCtChecked((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  // Rows filtered to the checked months, then only her own subjects — a mark
  // recorded against a combination she does not take is not hers to be scored
  // on, the same rule her own Class Tests tab and Student Report follow.
  const ctMarksByStudent = useMemo(() => {
    const filtered = ctRows.filter((r) => ctChecked.has(monthKeyOf(r.class_tests?.test_date)));
    const byStudent = new Map();
    filtered.forEach((r) => {
      if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
      byStudent.get(r.student_id).push(r);
    });
    const map = new Map();
    students.forEach((s) => {
      const { kept } = splitOwnSubjects(s, byStudent.get(s.id) || [], (r) => r.class_tests?.subject);
      map.set(s.id, summariseTests(kept));
    });
    return map;
  }, [ctRows, ctChecked, students]);

  const ctClassStats = useMemo(() => {
    const testIds = new Set();
    ctRows.forEach((r) => {
      if (ctChecked.has(monthKeyOf(r.class_tests?.test_date))) testIds.add(r.class_tests.id);
    });
    let obtained = 0;
    let total = 0;
    ctMarksByStudent.forEach((s) => { obtained += s.obtained; total += s.total; });
    return { testCount: testIds.size, percent: total > 0 ? (obtained / total) * 100 : null };
  }, [ctRows, ctChecked, ctMarksByStudent]);

  const ctSummary = examType === CLASS_TEST_EXAM_TYPE && selected ? ctMarksByStudent.get(selected.id) : null;

  /*
   * The marks sheet for the girl on screen.
   *
   * **Her own subjects, not her group's.** A group is not a subject list:
   * Humanities offers three combinations and only one of them takes Mathematics,
   * so offering the group's whole list put a Maths row in front of a girl who
   * has never sat it. `studiedSubjects` narrows it to the combination on her
   * record, and falls back to the group's full list when none was recorded —
   * showing more than she takes is a harmless over-answer, showing a subject she
   * does not sit is not.
   *
   * The year still narrows the compulsory half (Islamiat in 1st year, Pakistan
   * Studies in 2nd), and anything she **already carries a mark in** is unioned
   * back in. That last part is not a nicety: saving deletes this exam's rows and
   * writes back the list on screen, so a subject missing from the sheet would
   * silently discard marks entered under an older list.
   */
  const sheetSubjects = selected
    ? [...studiedSubjects(selected.program, selected.year_of_study, selected.subject_combination), ...extraSubjects]
    : [];

  // Said on screen only where the group actually offered a choice — everywhere
  // else the sheet is simply the group's list and there is nothing to explain.
  const combinationNote =
    selected && groupHasChoice(selected.program)
      ? selected.subject_combination
        ? `Her combination: ${selected.subject_combination}`
        : "No subject combination on her record, so every subject this group offers is listed. Set it from Students → Edit."
      : "";

  const fetchStudents = async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      // year_of_study travels with her because the subject list depends on it:
      // Islamiat is examined in 1st year, Pakistan Studies in 2nd.
      // subject_combination too: within FA-IT and Humanities it is the only
      // thing that says which electives are actually hers.
      .select("id, name, roll_no, program, year_of_study, subject_combination")
      .is("deleted_at", null)
      .order("program")
      .order("name");

    if (program !== ALL_PROGRAMS) {
      query = query.eq("program", program);
    } else if (isRestricted) {
      // "All Programs" means all of *hers*, never the whole college.
      query = query.in("program", visiblePrograms);
    }

    if (yearFilter !== "Both") {
      query = query.eq("year_of_study", yearFilter);
    }

    const { data } = await query;
    if (data) setStudents(data);
    setLoading(false);
    setSelected(null);
    setMarks({});
    setSaved(false);
  };

  const selectStudent = async (student) => {
    setSelected(student);
    setSaved(false);

    // Class Test mode has nothing to enter — her detail comes straight out of
    // ctMarksByStudent, already fetched for the whole roster.
    if (examType === CLASS_TEST_EXAM_TYPE) return;

    // Check existing results
    const { data } = await supabase
      .from("results")
      .select("*")
      .eq("student_id", student.id)
      .eq("exam_name", examName);

    if (data && data.length > 0) {
      const existingMarks = {};
      const existingTotal = {};
      data.forEach((r) => {
        existingMarks[r.subject] = r.marks_obtained;
        existingTotal[r.subject] = r.total_marks;
      });
      setMarks(existingMarks);
      setTotalMarks(existingTotal);
      // Any subject she already has a mark in, even one her class does not sit today —
      // saving deletes this exam's rows and writes back the list on screen, so a subject
      // missing from the sheet is a mark quietly thrown away.
      setExtraSubjects(
        [...new Set(data.map((r) => r.subject))]
          .filter((s) => !studiedSubjects(student.program, student.year_of_study, student.subject_combination).includes(s))
      );
    } else {
      setExtraSubjects([]);
      const emptyMarks = {};
      const emptyTotal = {};
      studiedSubjects(student.program, student.year_of_study, student.subject_combination).forEach((s) => {
        emptyMarks[s] = "";
        emptyTotal[s] = "100";
      });
      setMarks(emptyMarks);
      setTotalMarks(emptyTotal);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, yearFilter]);

  // Re-load marks for the currently selected student whenever the exam
  // changes, so marks typed under one exam never get saved under another.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selected) selectStudent(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examName]);

  const saveResults = async () => {
    if (!selected) return;
    setSaving(true);

    // Delete existing results for this student + exam
    await supabase.from("results").delete()
      .eq("student_id", selected.id)
      .eq("exam_name", examName);

    // Insert new results
    const rows = sheetSubjects.map((subject) => ({
      student_id: selected.id,
      exam_name: examName,
      subject,
      marks_obtained: parseFloat(marks[subject]) || 0,
      total_marks: parseFloat(totalMarks[subject]) || 100,
    }));

    const { error } = await supabase.from("results").insert(rows);
    setSaving(false);
    if (!error) setSaved(true);
  };

  const filtered = students.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.roll_no.includes(search)
  );

  const totalObtained = Object.values(marks).reduce((a, v) => a + (parseFloat(v) || 0), 0);
  const totalOf = Object.values(totalMarks).reduce((a, v) => a + (parseFloat(v) || 0), 0);
  const percentage = totalOf > 0 ? ((totalObtained / totalOf) * 100).toFixed(1) : 0;

  return (
    <div className="enter-results">
      <div className="enter-results__toolbar">
        <div className="enter-results__field">
          <label>Program</label>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            {visiblePrograms.length > 1 && <option key={ALL_PROGRAMS}>{ALL_PROGRAMS}</option>}
            {visiblePrograms.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="enter-results__field">
          <label>Exam Type</label>
          <select value={examType} onChange={(e) => setExamType(e.target.value)}>
            {EXAM_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        {examType === "Monthly Test" ? (
          <div className="enter-results__field">
            <label>Month</label>
            <select value={examMonth} onChange={(e) => setExamMonth(e.target.value)}>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        ) : examType === CLASS_TEST_EXAM_TYPE ? null : (
          <div className="enter-results__field">
            <label>Held Date</label>
            <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
        )}
      </div>

      <div className="enter-results__year-filters" role="group" aria-label="Filter by class year">
        <button onClick={() => setYearFilter("1st Year")} className={"enter-results__year-btn " + (yearFilter === "1st Year" ? "enter-results__year-btn--active" : "")}>1st Year</button>
        <button onClick={() => setYearFilter("2nd Year")} className={"enter-results__year-btn " + (yearFilter === "2nd Year" ? "enter-results__year-btn--active" : "")}>2nd Year</button>
        <button onClick={() => setYearFilter("Both")} className={"enter-results__year-btn " + (yearFilter === "Both" ? "enter-results__year-btn--active" : "")}>Both</button>
      </div>

      {examType === CLASS_TEST_EXAM_TYPE && (
        <div className="enter-results__ct-months">
          {ctLoading && ctMonths.length === 0 ? (
            <p className="enter-results__empty">Loading class tests...</p>
          ) : ctMonths.length === 0 ? (
            <p className="enter-results__empty">No class tests conducted yet for this class.</p>
          ) : (
            <>
              <div className="enter-results__ct-months-head">
                <span>Months</span>
                <div className="enter-results__ct-months-actions">
                  <button type="button" onClick={() => setCtChecked(new Set(ctMonths))}>All</button>
                  <button type="button" onClick={() => setCtChecked(new Set())}>None</button>
                </div>
              </div>
              <div className="enter-results__ct-months-list">
                {ctMonths.map((m) => (
                  <label key={m} className="enter-results__ct-month">
                    <input type="checkbox" checked={ctChecked.has(m)} onChange={() => toggleCtMonth(m)} />
                    {monthLabel(m)}
                  </label>
                ))}
              </div>
              <p className="enter-results__ct-class-stat">
                {ctClassStats.testCount} class test{ctClassStats.testCount === 1 ? "" : "s"} conducted in the selected months
                {ctClassStats.percent !== null && ` — class average ${ctClassStats.percent.toFixed(1)}%`}
              </p>
            </>
          )}
        </div>
      )}

      <div className="enter-results__layout">
        {/* Students List */}
        <div className="enter-results__students">
          <div className="enter-results__search">
            <Search size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student..." />
          </div>
          {loading ? (
            <p className="enter-results__empty">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="enter-results__empty">No students found</p>
          ) : (
            filtered.map((s) => {
              const ct = examType === CLASS_TEST_EXAM_TYPE ? ctMarksByStudent.get(s.id) : null;
              return (
                <button key={s.id} onClick={() => selectStudent(s)} className={`enter-results__student-btn ${selected?.id === s.id ? "enter-results__student-btn--active" : ""}`}>
                  <p className="enter-results__student-name">
                    {s.name}
                    {program === ALL_PROGRAMS && (
                      <span className="enter-results__program-tag">{s.program}</span>
                    )}
                  </p>
                  <p className="enter-results__student-roll">{s.roll_no}</p>
                  {ct && (
                    <p className="enter-results__ct-badge-row">
                      <span className={`enter-results__ct-pct ${ctPctClass(ct.percent)}`}>
                        {ct.percent !== null ? `${ct.percent.toFixed(0)}%` : "—"}
                      </span>
                      <span className="enter-results__ct-count">{ct.count} test{ct.count === 1 ? "" : "s"}</span>
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Marks Entry */}
        <div className="enter-results__marks">
          {!selected ? (
            <p className="enter-results__empty">
              ← Select a student to {examType === CLASS_TEST_EXAM_TYPE ? "view her class test record" : "enter marks"}
            </p>
          ) : examType === CLASS_TEST_EXAM_TYPE ? (
            !ctSummary || ctSummary.count === 0 ? (
              <p className="enter-results__empty">No class tests recorded for {selected.name} in the selected months.</p>
            ) : (
              <>
                <div className="enter-results__marks-header">
                  <div>
                    <h3>{selected.name}</h3>
                    <p>{selected.roll_no} — Class Tests</p>
                  </div>
                  <div className="enter-results__percentage">
                    <p>{ctSummary.obtained}/{ctSummary.total}</p>
                    <p>{ctSummary.percent !== null ? `${ctSummary.percent.toFixed(1)}%` : "—"}</p>
                  </div>
                </div>

                {ctSummary.subjects.map((sub) => (
                  <div key={sub.subject} className="enter-results__ct-subject">
                    <div className="enter-results__ct-subject-head">
                      <span className="enter-results__ct-subject-name">{sub.subject}</span>
                      <span className={`enter-results__ct-subject-pct ${ctPctClass(sub.percent)}`}>
                        {sub.percent !== null ? `${sub.percent.toFixed(0)}%` : "—"}
                        {sub.absent > 0 ? ` · ${sub.absent} absent` : ""}
                      </span>
                    </div>
                    <div className="enter-results__ct-tests">
                      {sub.tests.map((t, i) => (
                        <div key={`${sub.subject}-${i}`} className="enter-results__ct-test">
                          <span className="enter-results__ct-test-title">{t.title || `Test ${i + 1}`}</span>
                          <span className="enter-results__ct-test-date">{fmtCtDate(t.date)}</span>
                          <span className="enter-results__ct-test-score">
                            {t.isAbsent ? "Absent" : t.obtained === null ? "Not marked" : `${t.obtained}/${t.total} (${t.pct.toFixed(0)}%)`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )
          ) : (
            <>
              <div className="enter-results__marks-header">
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.roll_no} — {examName}</p>
                </div>
                {totalOf > 0 && (
                  <div className="enter-results__percentage">
                    <p>{totalObtained}/{totalOf}</p>
                    <p>{percentage}%</p>
                  </div>
                )}
              </div>

              {/* Why this sheet is shorter (or longer) than the group's list. */}
              {combinationNote && <p className="enter-results__combination">{combinationNote}</p>}

              <div className="enter-results__subjects">
                <div className="enter-results__subjects-header">
                  <span>Subject</span>
                  <span>Obtained</span>
                  <span>Total</span>
                </div>
                {sheetSubjects.map((subject) => (
                  <div key={subject} className="enter-results__subject-row">
                    <span>{subject}</span>
                    <input
                      type="number"
                      value={marks[subject] || ""}
                      onChange={(e) => setMarks({ ...marks, [subject]: e.target.value })}
                      placeholder="0"
                      min="0"
                    />
                    <input
                      type="number"
                      value={totalMarks[subject] || "100"}
                      onChange={(e) => setTotalMarks({ ...totalMarks, [subject]: e.target.value })}
                      placeholder="100"
                      min="0"
                    />
                  </div>
                ))}
              </div>

              <button onClick={saveResults} disabled={saving} className="enter-results__save">
                {saving ? "Saving..." : "Save Results"}
              </button>
              {saved && (
                <p className="enter-results__confirm">
                  <Check size={14} /> Results saved for {selected.name}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}