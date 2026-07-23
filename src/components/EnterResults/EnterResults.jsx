import { useState, useEffect } from "react";
import { Check, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./EnterResults.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];
const ALL_PROGRAMS = "All Programs";

const SUBJECTS = {
  "Pre-Engineering": ["Physics", "Chemistry", "Mathematics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "Pre-Medical": ["Physics", "Chemistry", "Biology", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "ICS": ["Computer Science", "Mathematics", "Physics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "General Science": ["Mathematics", "Economics", "Computer Science", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "Humanities": ["Education", "Sociology", "Civics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
};

const EXAM_TYPES = ["Class Test", "Monthly Test", "Bi-Monthly", "Send-Up Exam", "Pre-Board Exam"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EXAM_SELECTION_KEY = "cmgc_admin_exam_selection";

const todayStr = () => new Date().toISOString().split("T")[0];
const currentMonthName = () => MONTHS[new Date().getMonth()];

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

export default function EnterResults() {
  const [program, setProgram] = useState("Pre-Medical");
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchStudents();
  }, [program, yearFilter]);

  useEffect(() => {
    localStorage.setItem(EXAM_SELECTION_KEY, JSON.stringify({ examType, examDate, examMonth }));
  }, [examType, examDate, examMonth]);

  // Re-load marks for the currently selected student whenever the exam
  // changes, so marks typed under one exam never get saved under another.
  useEffect(() => {
    if (selected) selectStudent(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examName]);

  const fetchStudents = async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      .select("id, name, roll_no, program")
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
    setSelected(null);
    setMarks({});
    setSaved(false);
  };

  const selectStudent = async (student) => {
    setSelected(student);
    setSaved(false);

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
    } else {
      const emptyMarks = {};
      const emptyTotal = {};
      SUBJECTS[student.program].forEach((s) => {
        emptyMarks[s] = "";
        emptyTotal[s] = "100";
      });
      setMarks(emptyMarks);
      setTotalMarks(emptyTotal);
    }
  };

  const saveResults = async () => {
    if (!selected) return;
    setSaving(true);

    // Delete existing results for this student + exam
    await supabase.from("results").delete()
      .eq("student_id", selected.id)
      .eq("exam_name", examName);

    // Insert new results
    const rows = SUBJECTS[selected.program].map((subject) => ({
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
            <option key={ALL_PROGRAMS}>{ALL_PROGRAMS}</option>
            {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
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
        ) : (
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
            filtered.map((s) => (
              <button key={s.id} onClick={() => selectStudent(s)} className={`enter-results__student-btn ${selected?.id === s.id ? "enter-results__student-btn--active" : ""}`}>
                <p className="enter-results__student-name">
                  {s.name}
                  {program === ALL_PROGRAMS && (
                    <span className="enter-results__program-tag">{s.program}</span>
                  )}
                </p>
                <p className="enter-results__student-roll">{s.roll_no}</p>
              </button>
            ))
          )}
        </div>

        {/* Marks Entry */}
        <div className="enter-results__marks">
          {!selected ? (
            <p className="enter-results__empty">← Select a student to enter marks</p>
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

              <div className="enter-results__subjects">
                <div className="enter-results__subjects-header">
                  <span>Subject</span>
                  <span>Obtained</span>
                  <span>Total</span>
                </div>
                {SUBJECTS[selected.program].map((subject) => (
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