import { useState, useEffect } from "react";
import { Check, Plus, Trash2, ClipboardList, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/adminAuth";
import { YEARS, subjectsFor, subjectsForPrograms } from "../../lib/academics";
import { splitBySubject } from "../../lib/studentSubjects";
import { teacherSubjectsFor } from "../../lib/teacherAuth";
import RosterNote from "../RosterNote/RosterNote";
import "./ClassTestEntry.css";

const todayStr = () => new Date().toISOString().split("T")[0];

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

// Summary written to class_tests.program, which is a single non-null text column. The
// authoritative list is always class_tests.programs — read that, not this.
const programSummary = (list) => {
  if (list.length === 0) return "—";
  if (list.length === 1) return list[0];
  if (list.length === PROGRAMS.length) return "All Programs";
  return "Multiple Programs";
};

// The groups a saved test actually covered, tolerating rows written before `programs`.
const testPrograms = (test) =>
  Array.isArray(test?.programs) && test.programs.length > 0 ? test.programs : [test?.program].filter(Boolean);

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Shared class-test entry screen.
 *
 * `teacher` non-null  -> teacher portal: subjects/programs are locked to what she teaches
 *                        and every test she creates is stamped with her id.
 * `teacher` null      -> admin portal: full program range, and the teacher who conducted
 *                        the test is picked from `teacherOptions`.
 */
export default function ClassTestEntry({ teacher = null, allowedPrograms = [], teacherOptions = null }) {
  const isRestricted = allowedPrograms.length > 0;
  // Only what the admin allowed. Everything below narrows this further; nothing widens it.
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [year, setYear] = useState(YEARS[0]);

  // Subjects are offered across every allowed program, so the subject choice is never
  // limited by which groups happen to be ticked right now. The class does narrow it,
  // though: Islamiat is a 1st-year paper and Pakistan Studies a 2nd-year one.
  const availableSubjects = teacher
    ? teacherSubjectsFor(teacher, visiblePrograms, year)
    : subjectsForPrograms(visiblePrograms, year);

  const [subjectChoice, setSubject] = useState(availableSubjects[0] || "");
  const subject = availableSubjects.includes(subjectChoice) ? subjectChoice : (availableSubjects[0] || "");

  // Every group she was assigned starts ticked, not just the first one. A teacher is
  // scoped to her groups precisely because those are the ones she teaches, so "all of
  // mine" is the honest default — the same reasoning as the Students roster defaulting
  // to All Programs rather than her first group.
  //
  // Defaulting to `visiblePrograms[0]` alone is what hid most of a subject teacher's
  // class: Economics is studied in General Science, FA-IT and Humanities, PROGRAMS puts
  // General Science first, and General Science has one girl in it. Her tests were
  // created against that single group and the other two groups' students never
  // appeared — and because the list below filters on `.overlaps("programs", selected)`,
  // a test she had made for another group vanished from her own screen too.
  //
  // Nothing is widened by this: `eligiblePrograms` still drops any group that does not
  // study the chosen subject, and an unrestricted admin (six groups, none of them
  // particularly hers) keeps the pick-one default.
  const [picked, setPicked] = useState(() =>
    isRestricted ? visiblePrograms : visiblePrograms.slice(0, 1));

  // Being assigned to a group does not mean that group studies the subject: a Mathematics
  // teacher may be assigned Pre-Medical, whose curriculum is Biology and has no
  // Mathematics at all. Such groups are shown but disabled, and dropped from the
  // selection, so their students can never land in a marks list for a subject they do
  // not study.
  const eligiblePrograms = subject ? visiblePrograms.filter((p) => subjectsFor(p, year).includes(subject)) : visiblePrograms;
  const ineligiblePrograms = visiblePrograms.filter((p) => !eligiblePrograms.includes(p));
  const selected = picked.filter((p) => eligiblePrograms.includes(p));

  const [tests, setTests] = useState([]);
  const [activeTest, setActiveTest] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newTest, setNewTest] = useState({ title: "", test_date: todayStr(), total_marks: "10", teacher_id: "" });

  const [students, setStudents] = useState([]);
  /*
   * Who was left off this sheet, and who is on it only because we could not
   * tell. Said on screen rather than left silent: a teacher who knows the class
   * has forty girls and counts thirty-one needs to see why, and a girl with no
   * combination recorded is a record to fix, not a row to wonder about.
   */
  const [rosterSplit, setRosterSplit] = useState({ notTaking: 0, unknown: [] });
  const [marks, setMarks] = useState({});
  const [absents, setAbsents] = useState({});
  const [search, setSearch] = useState("");

  const [loadingTests, setLoadingTests] = useState(false);
  const [loadingMarks, setLoadingMarks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const fetchTests = async () => {
    if (!subject || selected.length === 0) {
      setTests([]);
      return;
    }
    setLoadingTests(true);
    let query = supabase
      .from("class_tests")
      .select("*")
      .eq("year_of_study", year)
      .eq("subject", subject)
      // Any test involving at least one ticked group, so a combined test stays reachable
      // from each of the groups it covers.
      .overlaps("programs", selected)
      .order("test_date", { ascending: false });

    // A teacher only ever sees her own tests; admin sees everyone's.
    if (teacher) query = query.eq("teacher_id", teacher.id);

    const { data, error: dbError } = await query;
    setLoadingTests(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setTests(data || []);
    setActiveTest(null);
    setCreating(false);
    setSaved(false);
  };

  useEffect(() => {
    // Loading the list for the chosen filters is the point of this effect; the
    // spinner it raises first is deliberate, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join("|"), year, subject]);

  const fetchStudentsAndMarks = async (test) => {
    setLoadingMarks(true);
    setSaved(false);

    const { data: studentRows } = await supabase
      .from("students")
      // subject_combination travels with her because a group is not the answer:
      // Humanities offers three combinations, and only one of them takes
      // Mathematics. Without it every Humanities girl lands on a Maths sheet.
      .select("id, name, roll_no, program, year_of_study, subject_combination")
      .is("deleted_at", null)
      .in("program", testPrograms(test))
      .eq("year_of_study", test.year_of_study)
      .order("program")
      .order("name");

    // Only the girls who actually sit this subject. Whoever has no combination
    // on record is kept and flagged rather than dropped — see subjectStatusFor.
    const split = splitBySubject(studentRows || [], test.subject);
    const roster = split.taking;
    setStudents(roster);
    setRosterSplit({ notTaking: split.notTaking.length, unknown: split.unknown });

    const nextMarks = {};
    const nextAbsents = {};

    if (test.id) {
      const { data: markRows } = await supabase
        .from("class_test_marks")
        .select("student_id, marks_obtained, is_absent")
        .eq("class_test_id", test.id);

      (markRows || []).forEach((m) => {
        nextMarks[m.student_id] = m.marks_obtained ?? "";
        nextAbsents[m.student_id] = !!m.is_absent;
      });
    }

    roster.forEach((s) => {
      if (nextMarks[s.id] === undefined) nextMarks[s.id] = "";
      if (nextAbsents[s.id] === undefined) nextAbsents[s.id] = false;
    });

    setMarks(nextMarks);
    setAbsents(nextAbsents);
    setLoadingMarks(false);
  };

  const openTest = (test) => {
    setError("");
    setCreating(false);
    setActiveTest(test);
    fetchStudentsAndMarks(test);
  };

  const startNewTest = () => {
    setError("");
    setActiveTest(null);
    setCreating(true);
    setSaved(false);
    setNewTest({
      title: `Test ${tests.length + 1}`,
      test_date: todayStr(),
      total_marks: "10",
      teacher_id: teacher ? teacher.id : "",
    });
  };

  const createTest = async () => {
    setError("");
    if (!newTest.title.trim()) return setError("Test title is required");
    if (!subject) return setError("Pick a subject first");
    if (selected.length === 0) return setError("Tick at least one group this test is for");
    const total = parseFloat(newTest.total_marks);
    if (!total || total <= 0) return setError("Total marks must be greater than 0");

    setSaving(true);
    const { data, error: dbError } = await supabase
      .from("class_tests")
      .insert({
        teacher_id: teacher ? teacher.id : newTest.teacher_id || null,
        subject,
        program: programSummary(selected),
        programs: selected,
        year_of_study: year,
        title: newTest.title.trim(),
        test_date: newTest.test_date,
        total_marks: total,
      })
      .select()
      .single();
    setSaving(false);

    if (dbError) {
      setError("Could not create test: " + dbError.message);
      return;
    }
    setTests((prev) => [data, ...prev]);
    setCreating(false);
    openTest(data);
  };

  const saveMarks = async () => {
    if (!activeTest) return;
    setError("");
    setSaving(true);

    const rows = students.map((s) => ({
      class_test_id: activeTest.id,
      student_id: s.id,
      is_absent: !!absents[s.id],
      marks_obtained: absents[s.id] ? null : (marks[s.id] === "" ? null : parseFloat(marks[s.id])),
    }));

    // Relies on the unique (class_test_id, student_id) constraint, so re-saving a test
    // updates the existing marks instead of inserting duplicates.
    const { error: dbError } = await supabase
      .from("class_test_marks")
      .upsert(rows, { onConflict: "class_test_id,student_id" });

    setSaving(false);
    if (dbError) {
      setError("Could not save marks: " + dbError.message);
      return;
    }
    setSaved(true);
  };

  const deleteTest = async (test) => {
    if (!window.confirm(`Delete "${test.title}" (${test.subject})? All marks entered for this test will be removed too.`)) return;
    const { error: dbError } = await supabase.from("class_tests").delete().eq("id", test.id);
    if (dbError) {
      setError("Could not delete test: " + dbError.message);
      return;
    }
    setTests((prev) => prev.filter((t) => t.id !== test.id));
    if (activeTest?.id === test.id) setActiveTest(null);
  };

  const filteredStudents = students.filter(
    (s) => s.name.toLowerCase().includes(search.toLowerCase()) || (s.roll_no || "").includes(search)
  );

  // A test spanning groups mixes them in one list, so each row is tagged with its group.
  const isCombined = testPrograms(activeTest).length > 1;

  const marked = students.filter((s) => absents[s.id] || (marks[s.id] !== "" && marks[s.id] !== null && marks[s.id] !== undefined));
  const scored = students.filter((s) => !absents[s.id] && marks[s.id] !== "" && marks[s.id] !== null && marks[s.id] !== undefined);
  const avg =
    scored.length > 0 && activeTest
      ? ((scored.reduce((a, s) => a + (parseFloat(marks[s.id]) || 0), 0) / (scored.length * Number(activeTest.total_marks))) * 100).toFixed(1)
      : null;

  return (
    <div className="cte">
      <div className="cte__toolbar">
        <div className="cte__field">
          <label>Class</label>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="cte__field">
          <label>Subject</label>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {availableSubjects.length === 0 && <option value="">No subject assigned</option>}
            {availableSubjects.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="cte__groups">
        <div className="cte__groups-head">
          <span className="cte__groups-label">
            Groups for this test
            {selected.length > 1 && <em> — one combined test for {selected.length} groups</em>}
          </span>
          {eligiblePrograms.length > 1 && (
            <div className="cte__groups-actions">
              <button type="button" onClick={() => setPicked(eligiblePrograms)} className="cte__link-btn">Select all</button>
              <button type="button" onClick={() => setPicked([])} className="cte__link-btn">Clear</button>
            </div>
          )}
        </div>

        <div className="cte__chip-row">
          {visiblePrograms.map((p) => {
            const disabled = !eligiblePrograms.includes(p);
            const on = selected.includes(p);
            return (
              <button
                type="button"
                key={p}
                disabled={disabled}
                onClick={() => setPicked((prev) => toggleValue(prev, p))}
                title={disabled ? `${p} does not study ${subject}` : undefined}
                className={"cte__chip " + (on ? "cte__chip--active " : "") + (disabled ? "cte__chip--disabled" : "")}
              >
                <span className="cte__chip-box">{on ? <Check size={11} strokeWidth={4} /> : null}</span>
                {p}
              </button>
            );
          })}
        </div>

        {ineligiblePrograms.length > 0 && subject && (
          <p className="cte__groups-note">
            {ineligiblePrograms.join(", ")} {ineligiblePrograms.length === 1 ? "is" : "are"} greyed out —
            {ineligiblePrograms.length === 1 ? " that group does" : " those groups do"} not study {subject}.
          </p>
        )}
        {selected.length === 0 && eligiblePrograms.length > 0 && (
          <p className="cte__groups-note">Tick at least one group to see or create tests.</p>
        )}
      </div>

      {availableSubjects.length === 0 && (
        <p className="cte__warning">
          You are not assigned any subject yet. Ask the admin to update your subjects in the Teachers tab.
        </p>
      )}

      {error && <p className="cte__error">{error}</p>}

      <div className="cte__layout">
        {/* Tests for the selected subject / class / groups */}
        <div className="cte__tests">
          <div className="cte__tests-header">
            <h4>{subject || "—"} Tests</h4>
            <button onClick={startNewTest} disabled={!subject || selected.length === 0} className="cte__new-btn">
              <Plus size={14} /> New
            </button>
          </div>

          {loadingTests ? (
            <p className="cte__empty">Loading...</p>
          ) : selected.length === 0 ? (
            <p className="cte__empty">No group ticked.</p>
          ) : tests.length === 0 ? (
            <p className="cte__empty">No tests yet for {subject || "this subject"}. Press “New” to add the first one.</p>
          ) : (
            tests.map((t) => (
              <div key={t.id} className={`cte__test-item ${activeTest?.id === t.id ? "cte__test-item--active" : ""}`}>
                <button onClick={() => openTest(t)} className="cte__test-btn">
                  <p className="cte__test-title">{t.title}</p>
                  <p className="cte__test-meta">{fmtDate(t.test_date)} · out of {t.total_marks}</p>
                  <p className="cte__test-meta">{testPrograms(t).join(", ")}</p>
                </button>
                <button onClick={() => deleteTest(t)} className="cte__test-delete" title="Delete this test">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Marks grid / new-test form */}
        <div className="cte__marks">
          {creating ? (
            <div className="cte__create">
              <h4>New {subject} Test — {year}</h4>
              <p className="cte__create-scope">For: {selected.join(", ")}</p>
              <div className="cte__create-grid">
                <div className="cte__field">
                  <label>Test Title *</label>
                  <input
                    value={newTest.title}
                    onChange={(e) => setNewTest({ ...newTest, title: e.target.value })}
                    placeholder="e.g. Test 1 — Chapter 3"
                  />
                </div>
                <div className="cte__field">
                  <label>Test Date</label>
                  <input type="date" value={newTest.test_date} onChange={(e) => setNewTest({ ...newTest, test_date: e.target.value })} />
                </div>
                <div className="cte__field">
                  <label>Total Marks *</label>
                  <input type="number" min="1" value={newTest.total_marks} onChange={(e) => setNewTest({ ...newTest, total_marks: e.target.value })} />
                </div>
                {!teacher && teacherOptions && (
                  <div className="cte__field">
                    <label>Conducted By</label>
                    <select value={newTest.teacher_id} onChange={(e) => setNewTest({ ...newTest, teacher_id: e.target.value })}>
                      <option value="">— Not specified —</option>
                      {teacherOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="cte__create-actions">
                <button onClick={createTest} disabled={saving} className="cte__save">
                  {saving ? "Creating..." : "Create Test & Enter Marks"}
                </button>
                <button onClick={() => setCreating(false)} className="cte__cancel">Cancel</button>
              </div>
            </div>
          ) : !activeTest ? (
            <div className="cte__placeholder">
              <ClipboardList size={30} />
              <p>Select a test to enter marks, or create a new one.</p>
            </div>
          ) : (
            <>
              <div className="cte__marks-header">
                <div>
                  <h4>{activeTest.title}</h4>
                  <p>{activeTest.subject} · {testPrograms(activeTest).join(", ")} {activeTest.year_of_study} · {fmtDate(activeTest.test_date)} · out of {activeTest.total_marks}</p>
                </div>
                <div className="cte__stats">
                  <span>{marked.length}/{students.length} marked</span>
                  {avg !== null && <span className="cte__avg">Avg {avg}%</span>}
                </div>
              </div>

              <RosterNote subject={activeTest.subject} split={rosterSplit} />

              {loadingMarks ? (
                <p className="cte__empty">Loading students...</p>
              ) : students.length === 0 ? (
                <p className="cte__empty">
                  Nobody in {testPrograms(activeTest).join(", ")} {activeTest.year_of_study} studies{" "}
                  {activeTest.subject}
                  {rosterSplit.notTaking > 0
                    ? ` — all ${rosterSplit.notTaking} of them take a different combination.`
                    : "."}
                </p>
              ) : (
                <>
                  <div className="cte__search">
                    <Search size={14} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student..." />
                  </div>

                  <div className="cte__grid-head">
                    <span>Student</span>
                    <span>Marks</span>
                    <span>Absent</span>
                  </div>

                  {filteredStudents.map((s) => (
                    <div key={s.id} className="cte__grid-row">
                      <div>
                        <p className="cte__student-name">
                          {s.name}
                          {isCombined && <span className="cte__program-tag">{s.program}</span>}
                          {rosterSplit.unknown.some((u) => u.id === s.id) && (
                            <span
                              className="cte__unknown-tag"
                              title="No subject combination on her record, so we cannot tell whether she takes this subject. Set it from Students - Edit."
                            >
                              combination not set
                            </span>
                          )}
                        </p>
                        <p className="cte__student-roll">{s.roll_no}</p>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={activeTest.total_marks}
                        value={absents[s.id] ? "" : (marks[s.id] ?? "")}
                        disabled={absents[s.id]}
                        onChange={(e) => { setMarks({ ...marks, [s.id]: e.target.value }); setSaved(false); }}
                        placeholder={`/ ${activeTest.total_marks}`}
                        className="cte__mark-input"
                      />
                      <button
                        onClick={() => { setAbsents({ ...absents, [s.id]: !absents[s.id] }); setSaved(false); }}
                        className={`cte__absent-btn ${absents[s.id] ? "cte__absent-btn--active" : ""}`}
                      >
                        {absents[s.id] ? "Absent" : "—"}
                      </button>
                    </div>
                  ))}

                  <button onClick={saveMarks} disabled={saving} className="cte__save">
                    {saving ? "Saving..." : "Save Marks"}
                  </button>
                  {saved && <p className="cte__confirm"><Check size={14} /> Marks saved for {activeTest.title}</p>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
