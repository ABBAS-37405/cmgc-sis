import { useState, useEffect } from "react";
import { ClipboardList, Users, CalendarCheck, FileText, NotebookPen, Search, BookOpen, Lock, Wallet } from "lucide-react";
import Sidebar from "../Sidebar/Sidebar";
import ClassTestEntry from "../ClassTestEntry/ClassTestEntry";
import AssignmentEntry from "../AssignmentEntry/AssignmentEntry";
import LmsManage from "../LmsManage/LmsManage";
import MarkAttendance from "../MarkAttendance/MarkAttendance";
import EnterResults from "../EnterResults/EnterResults";
import TeacherSalary from "../TeacherSalary/TeacherSalary";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/adminAuth";
import { hasTeacherRight, teacherPrograms, teacherSubjects } from "../../lib/teacherAuth";
import { useTabHistory } from "../../lib/backStack";
import "./TeacherPortal.css";

const ALL_PROGRAMS = "All Programs";

const NAV_ITEMS = [
  { id: "class_tests", label: "Class Tests", icon: ClipboardList },
  { id: "assignments", label: "Assignments", icon: NotebookPen },
  { id: "lms", label: "LMS", icon: BookOpen },
  { id: "view_students", label: "Students", icon: Users },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "results", label: "Results", icon: FileText },
];

/**
 * Her own pay. Deliberately NOT in NAV_ITEMS and never filtered by
 * `hasTeacherRight`: a right is something the admin grants, and a teacher's own
 * salary is not the admin's to withhold. The scoping that matters is in the
 * database — `staff_salaries_select` only returns rows where
 * `is_this_teacher(teacher_id)`, so she sees hers and nobody else's.
 */
const SALARY_ITEM = { id: "salary", label: "My Salary", icon: Wallet };

export default function TeacherPortal({ teacher, onLogout }) {
  const allowedPrograms = teacherPrograms(teacher);
  const subjects = teacherSubjects(teacher);

  const dutyItems = NAV_ITEMS.filter((it) => hasTeacherRight(teacher, it.id));
  const items = [...dutyItems, SALARY_ITEM];
  const [active, setActive] = useState(dutyItems[0]?.id || SALARY_ITEM.id);
  // Back walks the tabs she has actually visited, newest first.
  const goToTab = useTabHistory(active, setActive);

  const handleChangePassword = async () => {
    const next = window.prompt(`Set a new login password for ${teacher?.name || teacher?.email} (minimum 6 characters):`, "");
    if (next === null) return;
    const password = next.trim();
    if (password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      alert("Could not change password: " + error.message);
      return;
    }
    alert("Your password has been updated successfully.");
  };

  return (
    <div className="portal">
      <Sidebar
        items={items}
        active={active}
        setActive={goToTab}
        onLogout={onLogout}
        userLabel={`${teacher?.name || "Teacher"} (teacher)`}
      />
      <main className="portal__main">
        <div className="teacher-portal__header">
          <div>
            <h2 className="teacher-portal__name">{teacher?.name}</h2>
            <p className="teacher-portal__meta">
              {teacher?.email}
              {teacher?.qualification ? ` · ${teacher.qualification}` : ""}
            </p>
          </div>
          <div className="teacher-portal__actions">
            <button type="button" className="teacher-portal__change-password" onClick={handleChangePassword}>
              <Lock size={14} /> Change Password
            </button>
          </div>
          <div className="teacher-portal__tags">
            {subjects.length === 0 ? (
              <span className="teacher-portal__tag teacher-portal__tag--muted">All subjects</span>
            ) : (
              subjects.map((s) => <span key={s} className="teacher-portal__tag">{s}</span>)
            )}
            {allowedPrograms.length === 0 ? (
              <span className="teacher-portal__tag teacher-portal__tag--muted">All programs</span>
            ) : (
              allowedPrograms.map((p) => <span key={p} className="teacher-portal__tag">{p}</span>)
            )}
          </div>
        </div>

        {/* Salary is checked first: it is always available, so a teacher with no
            duties assigned yet still has a working portal rather than a dead end. */}
        {active === "salary" ? (
          <TeacherSalary teacher={teacher} />
        ) : dutyItems.length === 0 ? (
          <div className="teacher-portal__blocked">
            <p>No duties have been assigned to your account yet.</p>
            <p className="teacher-portal__blocked-hint">Ask the admin to give you rights from the Teachers tab.</p>
          </div>
        ) : (
          <>
            {active === "class_tests" && <ClassTestEntry teacher={teacher} allowedPrograms={allowedPrograms} />}
            {active === "assignments" && <AssignmentEntry teacher={teacher} allowedPrograms={allowedPrograms} />}
            {active === "lms" && <LmsManage teacher={teacher} />}
            {active === "view_students" && <TeacherStudents allowedPrograms={allowedPrograms} />}
            {active === "attendance" && <MarkAttendance allowedPrograms={allowedPrograms} />}
            {active === "results" && <EnterResults allowedPrograms={allowedPrograms} />}
          </>
        )}
      </main>
    </div>
  );
}

/* Read-only roster of the programs this teacher is assigned to. */
function TeacherStudents({ allowedPrograms }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  // Default to seeing everything she teaches, rather than just her first group.
  const [program, setProgram] = useState(visiblePrograms.length > 1 ? ALL_PROGRAMS : (visiblePrograms[0] || PROGRAMS[0]));
  const [yearFilter, setYearFilter] = useState("Both");
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchStudents = async () => {
    setLoading(true);
    let query = supabase
      .from("students")
      .select("id, name, roll_no, father_name, program, year_of_study")
      .is("deleted_at", null)
      .order("program")
      .order("name");

    // "All Programs" is always scoped to the groups she was assigned — a teacher
    // given Pre-Engineering, ICS and General Science never sees Pre-Medical here.
    if (program === ALL_PROGRAMS) query = query.in("program", visiblePrograms);
    else query = query.eq("program", program);

    if (yearFilter !== "Both") query = query.eq("year_of_study", yearFilter);

    const { data } = await query;
    setStudents(data || []);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, yearFilter]);

  const filtered = students.filter(
    (s) => s.name.toLowerCase().includes(search.toLowerCase()) || (s.roll_no || "").includes(search)
  );

  return (
    <div className="teacher-students">
      <div className="teacher-students__toolbar">
        <div className="teacher-students__field">
          <label>Program</label>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            {visiblePrograms.length > 1 && <option key={ALL_PROGRAMS}>{ALL_PROGRAMS}</option>}
            {visiblePrograms.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="teacher-students__search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student..." />
        </div>
      </div>

      <div className="teacher-students__year-filters" role="group" aria-label="Filter by class year">
        {["1st Year", "2nd Year", "Both"].map((y) => (
          <button
            key={y}
            onClick={() => setYearFilter(y)}
            className={"teacher-students__year-btn " + (yearFilter === y ? "teacher-students__year-btn--active" : "")}
          >
            {y}
          </button>
        ))}
        <span className="teacher-students__count">
          {filtered.length} student{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <p className="teacher-students__empty">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="teacher-students__empty">No students found in {program}.</p>
      ) : (
        <div className="teacher-students__table-wrap">
          <table className="teacher-students__table">
            <thead>
              <tr>
                <th>Roll No.</th><th>Name</th><th>Father Name</th>
                {/* Only worth a column when several groups are mixed together. */}
                {program === ALL_PROGRAMS && <th>Group</th>}
                <th>Class</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>{s.roll_no}</td>
                  <td>{s.name}</td>
                  <td>{s.father_name || "—"}</td>
                  {program === ALL_PROGRAMS && <td>{s.program}</td>}
                  <td>{s.year_of_study || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
