import { useState, useEffect } from "react";
import { Check, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./EnterResults.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];

const SUBJECTS = {
  "Pre-Engineering": ["Physics", "Chemistry", "Mathematics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "Pre-Medical": ["Physics", "Chemistry", "Biology", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "ICS": ["Computer Science", "Mathematics", "Physics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "General Science": ["Mathematics", "Economics", "Computer Science", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "Humanities": ["Education", "Sociology", "Civics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
};

export default function EnterResults() {
  const [program, setProgram] = useState("Pre-Medical");
  const [yearFilter, setYearFilter] = useState("Both");
  const [examName, setExamName] = useState("Mid-Term 2026");
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
      SUBJECTS[program].forEach((s) => {
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
    const rows = SUBJECTS[program].map((subject) => ({
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
            {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="enter-results__field">
          <label>Exam Name</label>
          <input value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="e.g. Mid-Term 2026" />
        </div>
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
                <p className="enter-results__student-name">{s.name}</p>
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
                {SUBJECTS[program].map((subject) => (
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