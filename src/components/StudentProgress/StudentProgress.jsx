import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ArrowLeft, RefreshCw, AlertCircle, Search, CalendarCheck, ClipboardList,
  GraduationCap, NotebookPen, Wallet, IdCard, Lock,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, YEARS } from "../../lib/academics";
import { hasPermission } from "../../lib/adminAuth";
import { buildStudentProgress } from "../../lib/studentProgress";
import { pushStep, truncate } from "../../lib/backStack";
import StudentCharts from "../Performance/StudentCharts";
import StudentDetail from "../StudentDetail/StudentDetail";
import "./StudentProgress.css";

const ALL_PROGRAMS = "All Programs";

const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(0)}%`);
const rs = (n) => `Rs. ${Number(n || 0).toLocaleString("en-PK")}`;

/** Attendance below 75% is the figure the college acts on, so it is coloured. */
const pctTone = (p, good = 75) => {
  if (p === null || p === undefined) return "";
  if (p >= good) return "sprog__pct--good";
  if (p >= good - 25) return "sprog__pct--mid";
  return "sprog__pct--low";
};

/**
 * A plain `date` column, formatted without ever being parsed as UTC midnight —
 * which would show every 1st of the month as the last day of the one before.
 */
const fmtDate = (value) => {
  if (!value) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(value);
  return new Date(y, m - 1, d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
};

/** A real timestamp, so the string may be parsed as one. */
const fmtStamp = (value) =>
  value ? new Date(value).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * One student's complete record, on screen.
 *
 * The Reports tab exists to *send* a month's report to a parent. This tab exists
 * for the question the office is asked at the counter: pick a girl, see how she
 * has done since admission — attendance, class tests, exams, assignments and fee
 * — without opening five different screens and reading them against each other.
 *
 * It writes nothing. The only mutation reachable from here is the existing
 * StudentDetail modal, which is the same admission record the Students tab
 * edits, opened rather than re-implemented.
 *
 * Two things about the permissions:
 *
 * - The tab is gated on `students`, and that is not a preference. The roster is
 *   read through the `admin scoped write on students` policy, which is `for all`
 *   — an admin without that permission would open this to an empty college.
 * - `attendance` and `results` are gated the same way, per table. Rather than
 *   run those queries and render the zero rows RLS hands back, the section says
 *   it is not available to her. A silent 0% would be a lie about a girl who
 *   never missed a day, which is the same rule as `notMarked` never printing as
 *   0 in a test report.
 */
export default function StudentProgress({ allowedPrograms = [], adminProfile }) {
  /**
   * The scoped groups, keyed on their contents rather than the array's identity.
   *
   * `allowedProgramsFor()` builds a fresh array on every AdminPortal render, and
   * App re-renders whenever the page crosses a scroll threshold — it tracks
   * scrollY for the landing page's navbar and back-to-top button, and that effect
   * is above the early return that swaps in the portal. Keying the roster fetch
   * on the prop itself therefore reloaded the whole list mid-scroll, which blanked
   * it, collapsed the page height, bounced the scroll back to the top and crossed
   * the threshold again — the screen flickering and refusing to stay put.
   *
   * AdminPortal now memoises the array as well, so this is belt and braces. It
   * stays because the fix has to hold whoever passes the prop next.
   */
  const programsKey = allowedPrograms.join("|");
  const programs = useMemo(() => (programsKey ? programsKey.split("|") : []), [programsKey]);

  const isRestricted = programs.length > 0;
  const visiblePrograms = useMemo(
    () => (isRestricted ? PROGRAMS.filter((p) => programs.includes(p)) : PROGRAMS),
    [isRestricted, programs]
  );

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [program, setProgram] = useState(ALL_PROGRAMS);
  const [yearFilter, setYearFilter] = useState("Both");
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState(null);
  const [progress, setProgress] = useState(null);
  const [progressError, setProgressError] = useState("");
  const [progressLoading, setProgressLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // The Back button walks out of a student's record before it leaves the tab.
  const backToken = useRef(null);

  const can = useCallback((key) => hasPermission(adminProfile, key), [adminProfile]);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError("");

    let query = supabase
      .from("students")
      .select("*")
      .is("deleted_at", null)
      .order("program")
      .order("name");

    // A sub-admin's list is always her own groups, never the whole college.
    if (isRestricted) query = query.in("program", programs);

    const { data, error: dbError } = await query;
    if (dbError) setError(dbError.message);
    setStudents(data || []);
    setLoading(false);
  }, [isRestricted, programs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStudents();
  }, [fetchStudents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (program !== ALL_PROGRAMS && s.program !== program) return false;
      if (yearFilter !== "Both" && (s.year_of_study || "1st Year") !== yearFilter) return false;
      if (!q) return true;
      return (
        (s.name || "").toLowerCase().includes(q) ||
        (s.roll_no || "").toLowerCase().includes(q) ||
        (s.father_name || "").toLowerCase().includes(q)
      );
    });
  }, [students, program, yearFilter, search]);

  /**
   * The load this screen is currently waiting for.
   *
   * Bumped by every new load and by closing a student, so a slow record that
   * arrives after she has moved on is dropped instead of being painted over
   * whoever is on screen now.
   */
  const requestRef = useRef(0);

  const loadProgress = useCallback(async (student) => {
    const token = requestRef.current + 1;
    requestRef.current = token;
    setProgressLoading(true);
    setProgressError("");

    try {
      const result = await buildStudentProgress(student, can);
      if (requestRef.current === token) setProgress(result);
    } catch (e) {
      if (requestRef.current === token) setProgressError(e.message || "Could not load this student's record.");
    } finally {
      if (requestRef.current === token) setProgressLoading(false);
    }
  }, [can]);

  const clearStudent = () => {
    requestRef.current += 1; // whatever is still in flight is no longer wanted
    setSelected(null);
    setProgress(null);
    setProgressError("");
    setProgressLoading(false);
    setShowProfile(false);
  };

  // pushStep at the click, so the closure captures the screen being left — the
  // rule from CLAUDE.md. The undo sets state directly and so pushes nothing.
  const openStudent = (student) => {
    backToken.current = pushStep(clearStudent);
    setSelected(student);
  };

  // Going back in the UI collapses the step the same press would have used;
  // leaving it there would make the next Back appear to do nothing.
  const backToList = () => {
    truncate(backToken.current);
    clearStudent();
  };

  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProgress(selected);
  }, [selected, loadProgress]);

  const reloadProgress = () => {
    if (selected) loadProgress(selected);
  };

  /* ------------------------------------------------------------ the roster */

  if (!selected) {
    return (
      <div className="sprog">
        <div className="sprog__head">
          <div>
            <h2 className="sprog__title">Student Report</h2>
            <p className="sprog__sub">
              Pick a student to see her complete record — attendance, class tests, exams,
              assignments and fee position, from admission to today.
            </p>
          </div>
          <button className="sprog__refresh" onClick={fetchStudents} disabled={loading}>
            <RefreshCw size={15} className={loading ? "sprog__spin" : ""} /> Refresh
          </button>
        </div>

        <div className="sprog__filters">
          <label className="sprog__field">
            <span>Group</span>
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value={ALL_PROGRAMS}>{isRestricted ? "All My Groups" : ALL_PROGRAMS}</option>
              {visiblePrograms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <label className="sprog__field">
            <span>Class</span>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="Both">Both</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>

          <label className="sprog__field sprog__field--grow">
            <span><Search size={13} /> Search</span>
            <input
              type="text"
              placeholder="Name, roll number or father's name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        {error && <p className="sprog__error"><AlertCircle size={14} /> {error}</p>}

        {loading ? (
          <p className="sprog__empty">Loading students…</p>
        ) : filtered.length === 0 ? (
          <p className="sprog__empty">No students match these filters.</p>
        ) : (
          <>
            <p className="sprog__count">
              {filtered.length} student{filtered.length === 1 ? "" : "s"} · click one to open her record
            </p>
            <div className="sprog__cards">
              {filtered.map((s) => (
                <button key={s.id} className="sprog__card" onClick={() => openStudent(s)}>
                  {s.profile_picture_url ? (
                    <img src={s.profile_picture_url} alt={s.name} className="sprog__avatar" loading="lazy" decoding="async" />
                  ) : (
                    <div className="sprog__avatar sprog__avatar--none">{(s.name || "?").charAt(0)}</div>
                  )}
                  <div className="sprog__card-text">
                    <span className="sprog__card-name">{s.name}</span>
                    <span className="sprog__card-roll">{s.roll_no}</span>
                    <span className="sprog__card-meta">{s.program} · {s.year_of_study || "1st Year"}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------- one student */

  return (
    <div className="sprog">
      <div className="sprog__student-head">
        <button className="sprog__btn" onClick={backToList}><ArrowLeft size={14} /> All students</button>
        <div className="sprog__student-actions">
          <button className="sprog__btn" onClick={() => setShowProfile(true)}>
            <IdCard size={14} /> Profile &amp; documents
          </button>
          <button className="sprog__btn" onClick={reloadProgress} disabled={progressLoading}>
            <RefreshCw size={14} className={progressLoading ? "sprog__spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="sprog__identity">
        {selected.profile_picture_url ? (
          <img src={selected.profile_picture_url} alt={selected.name} className="sprog__avatar sprog__avatar--lg" />
        ) : (
          <div className="sprog__avatar sprog__avatar--lg sprog__avatar--none">{(selected.name || "?").charAt(0)}</div>
        )}
        <div>
          <h2 className="sprog__title">{selected.name}</h2>
          <p className="sprog__identity-meta">
            {selected.roll_no} · {selected.program} · {selected.year_of_study || "1st Year"}
          </p>
          <p className="sprog__identity-meta">
            {selected.father_name ? `d/o ${selected.father_name}` : "Father's name not on record"}
            {selected.subject_combination ? ` · ${selected.subject_combination}` : ""}
          </p>
        </div>
      </div>

      {progressError && <p className="sprog__error"><AlertCircle size={14} /> {progressError}</p>}

      {progressLoading && !progress ? (
        <p className="sprog__empty">Loading her record…</p>
      ) : !progress ? null : (
        <>
          <Summary progress={progress} />
          {/* The charts sit above the sections rather than replacing them: the
              shape of a term is easier to see drawn, and the exact figure is
              easier to read in a row. Each chart also carries its own numbers. */}
          <StudentCharts progress={progress} />
          <AttendanceSection attendance={progress.attendance} />
          <TestsSection tests={progress.tests} />
          <ExamsSection exams={progress.exams} />
          <AssignmentsSection assignments={progress.assignments} />
          <FeeSection fee={progress.fee} />
        </>
      )}

      {showProfile && (
        <StudentDetail
          student={selected}
          allowedPrograms={programs}
          onClose={() => setShowProfile(false)}
          onSaved={() => { fetchStudents(); reloadProgress(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** The five figures the office asks for first. */
function Summary({ progress }) {
  const { attendance, tests, exams, assignments, fee } = progress;
  const latestExam = exams.unavailable ? null : exams.list[0] || null;

  return (
    <div className="sprog__tiles">
      <Tile
        label="Attendance"
        value={attendance.unavailable ? "—" : pctText(attendance.percent)}
        tone={attendance.unavailable ? "" : pctTone(attendance.percent)}
        note={attendance.unavailable ? "Not available to you" : `${attendance.present}/${attendance.marked} days marked`}
      />
      <Tile
        label="Class Tests"
        value={pctText(tests.percent)}
        tone={pctTone(tests.percent, 50)}
        note={`${tests.count} test${tests.count === 1 ? "" : "s"} taken`}
      />
      <Tile
        label={latestExam ? latestExam.type || "Latest Exam" : "Exams"}
        value={latestExam ? pctText(latestExam.percent) : "—"}
        tone={latestExam ? pctTone(latestExam.percent, 50) : ""}
        note={
          exams.unavailable ? "Not available to you"
            : latestExam ? latestExam.examName
            : "No exam marks recorded"
        }
      />
      <Tile
        label="Assignments"
        value={assignments.set === 0 ? "—" : `${assignments.submitted}/${assignments.set}`}
        tone={assignments.missing > 0 ? "sprog__pct--low" : assignments.set > 0 ? "sprog__pct--good" : ""}
        note={assignments.set === 0 ? "None set for her group" : `${assignments.missing} missing · ${assignments.late} late`}
      />
      <Tile
        label="Fee Balance"
        value={fee.rows.length === 0 ? "—" : fee.balance > 0 ? rs(fee.balance) : "Clear"}
        tone={fee.balance > 0 ? "sprog__pct--low" : fee.rows.length > 0 ? "sprog__pct--good" : ""}
        note={fee.rows.length === 0 ? "No fee charged yet" : `${rs(fee.paid)} paid of ${rs(fee.due)}`}
      />
    </div>
  );
}

function Tile({ label, value, note, tone }) {
  return (
    <div className="sprog__tile">
      <span className="sprog__tile-label">{label}</span>
      <span className={`sprog__tile-value ${tone}`}>{value}</span>
      <span className="sprog__tile-note">{note}</span>
    </div>
  );
}

function Section({ icon: Icon, title, count, children }) {
  return (
    <section className="sprog__section">
      <h3 className="sprog__section-title">
        <Icon size={15} /> {title}
        {count !== undefined && <span className="sprog__section-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** What a section says when RLS would have answered it with silence. */
function Blocked({ permission }) {
  return (
    <p className="sprog__blocked">
      <Lock size={13} /> Not shown — your admin account does not have the {permission} permission,
      so these records are not readable by it. Ask a super admin to grant it.
    </p>
  );
}

function AttendanceSection({ attendance }) {
  if (attendance.unavailable) {
    return (
      <Section icon={CalendarCheck} title="Attendance">
        <Blocked permission={attendance.unavailable} />
      </Section>
    );
  }

  if (attendance.marked === 0) {
    return (
      <Section icon={CalendarCheck} title="Attendance">
        <p className="sprog__none">No attendance has been marked for her yet.</p>
      </Section>
    );
  }

  return (
    <Section icon={CalendarCheck} title="Attendance" count={`${attendance.marked} days marked`}>
      <div className="sprog__inline-stats">
        <span><strong>{attendance.present}</strong> present</span>
        <span><strong>{attendance.absent}</strong> absent</span>
        <span><strong>{attendance.leave}</strong> leave</span>
        <span className={pctTone(attendance.percent)}><strong>{pctText(attendance.percent)}</strong> overall</span>
      </div>

      <div className="sprog__table-wrap">
        <table className="sprog__table">
          <thead>
            <tr><th>Month</th><th>Present</th><th>Absent</th><th>Leave</th><th>Marked</th><th>Percentage</th></tr>
          </thead>
          <tbody>
            {attendance.byMonth.map((m) => (
              <tr key={m.month}>
                <td>{m.label}</td>
                <td>{m.present}</td>
                <td>{m.absent}</td>
                <td>{m.leave}</td>
                <td>{m.marked}</td>
                <td className={pctTone(m.percent)}><strong>{pctText(m.percent)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function TestsSection({ tests }) {
  if (tests.subjects.length === 0) {
    return (
      <Section icon={ClipboardList} title="Class Tests">
        <p className="sprog__none">No class test marks have been recorded for her.</p>
      </Section>
    );
  }

  return (
    <Section icon={ClipboardList} title="Class Tests" count={`${tests.obtained}/${tests.total} · ${pctText(tests.percent)}`}>
      <div className="sprog__subjects">
        {tests.subjects.map((s) => (
          <div key={s.subject} className="sprog__subject">
            <div className="sprog__subject-head">
              <span className="sprog__subject-name">{s.subject}</span>
              <span className={`sprog__subject-pct ${pctTone(s.percent, 50)}`}>
                {s.obtained}/{s.total} · {pctText(s.percent)}
              </span>
            </div>
            <div className="sprog__chips">
              {s.tests.map((t, i) => (
                <span key={`${t.title}-${t.date}-${i}`} className={`sprog__chip ${t.isAbsent ? "sprog__chip--absent" : ""}`}>
                  <strong>{t.isAbsent ? "Absent" : `${t.obtained}/${t.total}`}</strong>
                  {t.title} · {fmtDate(t.date)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ExamsSection({ exams }) {
  if (exams.unavailable) {
    return (
      <Section icon={GraduationCap} title="Exams">
        <Blocked permission={exams.unavailable} />
      </Section>
    );
  }

  if (exams.list.length === 0) {
    return (
      <Section icon={GraduationCap} title="Exams">
        <p className="sprog__none">No exam marks have been entered for her.</p>
      </Section>
    );
  }

  return (
    <Section icon={GraduationCap} title="Exams" count={`${exams.list.length} sitting${exams.list.length === 1 ? "" : "s"}`}>
      {exams.list.map((exam) => (
        <div key={exam.examName} className="sprog__exam">
          <div className="sprog__exam-head">
            <span className="sprog__exam-name">{exam.examName}</span>
            <span className={`sprog__subject-pct ${pctTone(exam.percent, 50)}`}>
              {exam.obtained}/{exam.total} · {pctText(exam.percent)}
            </span>
          </div>
          <p className="sprog__exam-meta">Marks entered {fmtStamp(exam.enteredAt)}</p>
          <div className="sprog__table-wrap">
            <table className="sprog__table">
              <thead><tr><th>Subject</th><th>Obtained</th><th>Total</th><th>Percentage</th></tr></thead>
              <tbody>
                {exam.subjects.map((s) => {
                  const p = s.total > 0 ? (s.obtained / s.total) * 100 : null;
                  return (
                    <tr key={s.subject}>
                      <td>{s.subject}</td>
                      <td>{s.obtained}</td>
                      <td>{s.total}</td>
                      <td className={pctTone(p, 50)}><strong>{pctText(p)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </Section>
  );
}

function AssignmentsSection({ assignments }) {
  if (assignments.set === 0) {
    return (
      <Section icon={NotebookPen} title="Assignments">
        <p className="sprog__none">No assignments have been set for her group and class.</p>
      </Section>
    );
  }

  return (
    <Section icon={NotebookPen} title="Assignments" count={`${assignments.submitted} of ${assignments.set} submitted`}>
      <div className="sprog__inline-stats">
        <span><strong>{assignments.submitted}</strong> submitted</span>
        <span className={assignments.missing > 0 ? "sprog__pct--low" : ""}><strong>{assignments.missing}</strong> missing</span>
        <span><strong>{assignments.late}</strong> late</span>
        {assignments.total > 0 && (
          <span className={pctTone(assignments.percent, 50)}>
            <strong>{assignments.obtained}/{assignments.total}</strong> marked work
          </span>
        )}
      </div>

      <div className="sprog__table-wrap">
        <table className="sprog__table">
          <thead><tr><th>Assignment</th><th>Subject</th><th>Due</th><th>Status</th><th>Marks</th></tr></thead>
          <tbody>
            {assignments.items.map((a, i) => (
              <tr key={`${a.title}-${a.dueDate}-${i}`}>
                <td>{a.title}</td>
                <td>{a.subject}</td>
                <td>{fmtDate(a.dueDate)}</td>
                <td>
                  {a.submitted ? (
                    <span className={a.late ? "sprog__pct--mid" : "sprog__pct--good"}>
                      {a.late ? "Submitted late" : "Submitted"}
                    </span>
                  ) : (
                    <span className="sprog__pct--low">Not submitted</span>
                  )}
                </td>
                {/* Ungraded is not zero: a blank marks column means nobody has
                    marked it yet, which is not the same as scoring nothing. */}
                <td>{a.marks === null ? "—" : `${a.marks}/${a.totalMarks}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function FeeSection({ fee }) {
  if (fee.rows.length === 0) {
    return (
      <Section icon={Wallet} title="Fee">
        <p className="sprog__none">No fee has been charged to her yet.</p>
      </Section>
    );
  }

  return (
    <Section icon={Wallet} title="Fee" count={fee.balance > 0 ? `${rs(fee.balance)} outstanding` : "Cleared"}>
      <div className="sprog__inline-stats">
        <span><strong>{rs(fee.due)}</strong> charged</span>
        <span><strong>{rs(fee.paid)}</strong> paid</span>
        <span className={fee.balance > 0 ? "sprog__pct--low" : "sprog__pct--good"}>
          <strong>{rs(fee.balance)}</strong> balance
        </span>
      </div>

      <div className="sprog__table-wrap">
        <table className="sprog__table">
          <thead><tr><th>Charge</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>
            {fee.rows.map((r, i) => (
              <tr key={`${r.label}-${r.dueDate}-${i}`}>
                <td>{r.label}</td>
                <td>{fmtDate(r.dueDate)}</td>
                <td>{rs(r.due)}</td>
                <td>{rs(r.paid)}</td>
                <td className={r.balance > 0 ? "sprog__pct--low" : ""}>{rs(r.balance)}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fee.payments.length > 0 && (
        <>
          <p className="sprog__sub-head">Payments received</p>
          <div className="sprog__table-wrap">
            <table className="sprog__table">
              <thead><tr><th>Date</th><th>Against</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th></tr></thead>
              <tbody>
                {fee.payments.map((p, i) => (
                  <tr key={`${p.at}-${i}`}>
                    <td>{fmtStamp(p.at)}</td>
                    <td>{p.label}</td>
                    <td>{rs(p.amount)}</td>
                    <td>
                      {p.method}
                      {p.recordedBy === "admin" && <span className="sprog__tag">office</span>}
                    </td>
                    <td>{p.reference || "—"}</td>
                    <td className={p.status === "Success" ? "sprog__pct--good" : "sprog__pct--mid"}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
