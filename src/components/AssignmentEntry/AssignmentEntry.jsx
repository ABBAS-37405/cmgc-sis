import { useState, useEffect } from "react";
import { Check, Plus, Trash2, FileText, Search, Upload, Eye, Paperclip, Hand } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/adminAuth";
import { YEARS, subjectsFor, subjectsForPrograms } from "../../lib/academics";
import { splitBySubject } from "../../lib/studentSubjects";
import { teacherSubjectsFor } from "../../lib/teacherAuth";
import { prepareUpload } from "../../lib/uploads";
import RosterNote from "../RosterNote/RosterNote";
import "./AssignmentEntry.css";

const todayStr = () => new Date().toISOString().split("T")[0];
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().split("T")[0];

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

const programSummary = (list) => {
  if (list.length === 0) return "—";
  if (list.length === 1) return list[0];
  if (list.length === PROGRAMS.length) return "All Programs";
  return "Multiple Programs";
};

const assignmentPrograms = (a) =>
  Array.isArray(a?.programs) && a.programs.length > 0 ? a.programs : [a?.program].filter(Boolean);

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Open / Closed tells the teacher at a glance whether students can still submit.
const windowState = (a) => {
  const today = todayStr();
  if (today < a.start_date) return { label: "Scheduled", cls: "scheduled" };
  if (today > a.due_date) return { label: "Closed", cls: "closed" };
  return { label: "Open", cls: "open" };
};

/**
 * Shared assignment screen.
 *
 * `teacher` non-null -> teacher portal: locked to her subjects and groups.
 * `teacher` null     -> admin portal: full range, teacher picked from `teacherOptions`.
 */
export default function AssignmentEntry({ teacher = null, allowedPrograms = [], teacherOptions = null }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [year, setYear] = useState(YEARS[0]);

  // The class narrows the compulsory half of the list: Islamiat is a 1st-year paper
  // and Pakistan Studies a 2nd-year one.
  const availableSubjects = teacher
    ? teacherSubjectsFor(teacher, visiblePrograms, year)
    : subjectsForPrograms(visiblePrograms, year);

  const [subjectChoice, setSubject] = useState(availableSubjects[0] || "");
  const subject = availableSubjects.includes(subjectChoice) ? subjectChoice : (availableSubjects[0] || "");

  // All of her groups start ticked, not just the first — see the same default in
  // ClassTestEntry. An Economics teacher assigned General Science, FA-IT and Humanities
  // was silently set to General Science alone (PROGRAMS order), so an assignment reached
  // one girl and the rest of her class never saw it. `eligiblePrograms` still drops any
  // group that does not study the subject; an unrestricted admin keeps pick-one.
  const [picked, setPicked] = useState(() =>
    isRestricted ? visiblePrograms : visiblePrograms.slice(0, 1));

  // A group that does not study the subject cannot be set this assignment.
  const eligiblePrograms = subject ? visiblePrograms.filter((p) => subjectsFor(p, year).includes(subject)) : visiblePrograms;
  const ineligiblePrograms = visiblePrograms.filter((p) => !eligiblePrograms.includes(p));
  const selected = picked.filter((p) => eligiblePrograms.includes(p));

  const [assignments, setAssignments] = useState([]);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", total_marks: "10",
    start_date: todayStr(), due_date: addDays(7), teacher_id: "",
  });
  const [file, setFile] = useState(null);

  const [students, setStudents] = useState([]);
  // Who this subject leaves off the sheet, and who is on it only because her
  // combination was never recorded. See RosterNote.
  const [rosterSplit, setRosterSplit] = useState({ notTaking: 0, unknown: [] });
  const [subs, setSubs] = useState({});   // student_id -> submission row
  const [marks, setMarks] = useState({}); // student_id -> typed marks
  const [remarks, setRemarks] = useState({});
  const [inClass, setInClass] = useState({}); // student_id -> handed in on paper
  const [search, setSearch] = useState("");

  const [loadingList, setLoadingList] = useState(false);
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const fetchAssignments = async () => {
    if (!subject || selected.length === 0) {
      setAssignments([]);
      return;
    }
    setLoadingList(true);
    let query = supabase
      .from("assignments")
      .select("*")
      .eq("year_of_study", year)
      .eq("subject", subject)
      .overlaps("programs", selected)
      .order("due_date", { ascending: false });

    if (teacher) query = query.eq("teacher_id", teacher.id);

    const { data, error: dbError } = await query;
    setLoadingList(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setAssignments(data || []);
    setActive(null);
    setCreating(false);
    setSaved(false);
  };

  useEffect(() => {
    // Loading the list for the chosen filters is the point of this effect; the
    // spinner it raises first is deliberate, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join("|"), year, subject]);

  const openAssignment = async (a) => {
    setError("");
    setCreating(false);
    setActive(a);
    setLoadingGrades(true);
    setSaved(false);

    const [{ data: roster }, { data: rows }] = await Promise.all([
      supabase
        .from("students")
        // subject_combination travels with her: a group is not a subject list,
        // and only one of Humanities' three combinations takes Mathematics.
        .select("id, name, roll_no, program, year_of_study, subject_combination")
        .is("deleted_at", null)
        .in("program", assignmentPrograms(a))
        .eq("year_of_study", a.year_of_study)
        .order("program")
        .order("name"),
      supabase.from("assignment_submissions").select("*").eq("assignment_id", a.id),
    ]);

    const byStudent = {};
    const m = {};
    const r = {};
    const h = {};
    (rows || []).forEach((row) => {
      byStudent[row.student_id] = row;
      m[row.student_id] = row.marks_obtained ?? "";
      r[row.student_id] = row.remarks ?? "";
      h[row.student_id] = Boolean(row.submitted_in_class);
    });
    // Only the girls who actually study this subject. Whoever has no combination
    // on record stays and is flagged rather than dropped — see subjectStatusFor.
    const split = splitBySubject(roster || [], a.subject);
    split.taking.forEach((s) => {
      if (m[s.id] === undefined) m[s.id] = "";
      if (r[s.id] === undefined) r[s.id] = "";
      if (h[s.id] === undefined) h[s.id] = false;
    });

    setStudents(split.taking);
    setRosterSplit({ notTaking: split.notTaking.length, unknown: split.unknown });
    setSubs(byStudent);
    setMarks(m);
    setRemarks(r);
    setInClass(h);
    setLoadingGrades(false);
  };

  const startNew = () => {
    setError("");
    setActive(null);
    setCreating(true);
    setSaved(false);
    setFile(null);
    setForm({
      title: "", description: "", total_marks: "10",
      start_date: todayStr(), due_date: addDays(7),
      teacher_id: teacher ? teacher.id : "",
    });
  };

  const createAssignment = async () => {
    setError("");
    if (!form.title.trim()) return setError("Assignment title is required");
    if (!subject) return setError("Pick a subject first");
    if (selected.length === 0) return setError("Tick at least one group");
    if (!form.description.trim() && !file) {
      return setError("Type the assignment, upload a file, or do both — it cannot be empty");
    }
    const total = parseFloat(form.total_marks);
    if (!total || total <= 0) return setError("Total marks must be greater than 0");
    if (form.due_date < form.start_date) return setError("The due date cannot be before the start date");

    setSaving(true);

    let fileUrl = null;
    if (file) {
      // One question paper is read by the whole class, so this is the upload
      // whose size is paid for most often on the way back out.
      const ready = await prepareUpload(file, "submission");
      if (ready.error) {
        setSaving(false);
        setError(ready.error);
        return;
      }
      const path = `questions/${Date.now()}-${ready.file.name.replace(/[^\w.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("assignments").upload(path, ready.file);
      if (upErr) {
        setSaving(false);
        setError("File upload failed: " + upErr.message);
        return;
      }
      fileUrl = supabase.storage.from("assignments").getPublicUrl(path).data.publicUrl;
    }

    const { data, error: dbError } = await supabase
      .from("assignments")
      .insert({
        teacher_id: teacher ? teacher.id : form.teacher_id || null,
        subject,
        program: programSummary(selected),
        programs: selected,
        year_of_study: year,
        title: form.title.trim(),
        description: form.description.trim() || null,
        file_url: fileUrl,
        total_marks: total,
        start_date: form.start_date,
        due_date: form.due_date,
      })
      .select()
      .single();
    setSaving(false);

    if (dbError) {
      setError("Could not create assignment: " + dbError.message);
      return;
    }
    setAssignments((prev) => [data, ...prev]);
    setCreating(false);
    openAssignment(data);
  };

  const saveMarks = async () => {
    if (!active) return;
    setError("");
    setSaving(true);

    // Only students who have a mark, a remark, or a hand-in get a row: an
    // ungraded girl who handed in nothing should not gain an empty submission
    // record.
    const rows = students
      .filter((s) => marks[s.id] !== "" || (remarks[s.id] || "").trim() || inClass[s.id] || subs[s.id])
      .map((s) => ({
        assignment_id: active.id,
        student_id: s.id,
        file_url: subs[s.id]?.file_url ?? null,
        submitted_at: subs[s.id]?.submitted_at ?? null,
        submitted_in_class: Boolean(inClass[s.id]),
        marks_obtained: marks[s.id] === "" ? null : parseFloat(marks[s.id]),
        remarks: (remarks[s.id] || "").trim() || null,
        graded_at: marks[s.id] === "" ? null : new Date().toISOString(),
      }));

    if (rows.length === 0) {
      setSaving(false);
      setSaved(true);
      return;
    }

    const { error: dbError } = await supabase
      .from("assignment_submissions")
      .upsert(rows, { onConflict: "assignment_id,student_id" });
    setSaving(false);

    if (dbError) {
      setError("Could not save marks: " + dbError.message);
      return;
    }
    setSaved(true);
    openAssignment(active);
  };

  const deleteAssignment = async (a) => {
    if (!window.confirm(`Delete "${a.title}"? Every student's submission and marks for it will go too.`)) return;
    const { error: dbError } = await supabase.from("assignments").delete().eq("id", a.id);
    if (dbError) {
      setError("Could not delete: " + dbError.message);
      return;
    }
    setAssignments((prev) => prev.filter((x) => x.id !== a.id));
    if (active?.id === a.id) setActive(null);
  };

  const filteredStudents = students.filter(
    (s) => s.name.toLowerCase().includes(search.toLowerCase()) || (s.roll_no || "").includes(search)
  );

  const isCombined = assignmentPrograms(active).length > 1;
  const submittedCount = students.filter((s) => subs[s.id]?.file_url || inClass[s.id]).length;
  const gradedCount = students.filter((s) => marks[s.id] !== "" && marks[s.id] != null).length;

  return (
    <div className="asn">
      <div className="asn__toolbar">
        <div className="asn__field">
          <label>Class</label>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="asn__field">
          <label>Subject</label>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {availableSubjects.length === 0 && <option value="">No subject assigned</option>}
            {availableSubjects.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="asn__groups">
        <div className="asn__groups-head">
          <span className="asn__groups-label">
            Groups for this assignment
            {selected.length > 1 && <em> — one assignment for {selected.length} groups</em>}
          </span>
          {eligiblePrograms.length > 1 && (
            <div className="asn__groups-actions">
              <button type="button" onClick={() => setPicked(eligiblePrograms)} className="asn__link-btn">Select all</button>
              <button type="button" onClick={() => setPicked([])} className="asn__link-btn">Clear</button>
            </div>
          )}
        </div>
        <div className="asn__chip-row">
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
                className={"asn__chip " + (on ? "asn__chip--active " : "") + (disabled ? "asn__chip--disabled" : "")}
              >
                <span className="asn__chip-box">{on ? <Check size={11} strokeWidth={4} /> : null}</span>
                {p}
              </button>
            );
          })}
        </div>
        {ineligiblePrograms.length > 0 && subject && (
          <p className="asn__groups-note">
            {ineligiblePrograms.join(", ")} {ineligiblePrograms.length === 1 ? "is" : "are"} greyed out —
            {ineligiblePrograms.length === 1 ? " that group does" : " those groups do"} not study {subject}.
          </p>
        )}
      </div>

      {error && <p className="asn__error">{error}</p>}

      <div className="asn__layout">
        <div className="asn__list">
          <div className="asn__list-head">
            <h4>{subject || "—"} Assignments</h4>
            <button onClick={startNew} disabled={!subject || selected.length === 0} className="asn__new-btn">
              <Plus size={14} /> New
            </button>
          </div>

          {loadingList ? (
            <p className="asn__empty">Loading...</p>
          ) : selected.length === 0 ? (
            <p className="asn__empty">No group ticked.</p>
          ) : assignments.length === 0 ? (
            <p className="asn__empty">No assignments yet for {subject || "this subject"}.</p>
          ) : (
            assignments.map((a) => {
              const w = windowState(a);
              return (
                <div key={a.id} className={`asn__item ${active?.id === a.id ? "asn__item--active" : ""}`}>
                  <button onClick={() => openAssignment(a)} className="asn__item-btn">
                    <p className="asn__item-title">
                      {a.title}
                      <span className={`asn__state asn__state--${w.cls}`}>{w.label}</span>
                    </p>
                    <p className="asn__item-meta">{fmtDate(a.start_date)} → {fmtDate(a.due_date)} · out of {a.total_marks}</p>
                    <p className="asn__item-meta">
                      {assignmentPrograms(a).join(", ")}
                      {a.file_url && <> · <Paperclip size={11} /> file</>}
                    </p>
                  </button>
                  <button onClick={() => deleteAssignment(a)} className="asn__item-delete" title="Delete this assignment">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="asn__panel">
          {creating ? (
            <div className="asn__create">
              <h4>New {subject} Assignment — {year}</h4>
              <p className="asn__scope">For: {selected.join(", ")}</p>

              <div className="asn__create-grid">
                <div className="asn__field asn__field--wide">
                  <label>Title *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Chapter 4 — Exercise Questions"
                  />
                </div>
                <div className="asn__field">
                  <label>Total Marks *</label>
                  <input type="number" min="1" value={form.total_marks}
                    onChange={(e) => setForm({ ...form, total_marks: e.target.value })} />
                </div>
                <div className="asn__field">
                  <label>From *</label>
                  <input type="date" value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="asn__field">
                  <label>To (due) *</label>
                  <input type="date" value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                </div>
                {!teacher && teacherOptions && (
                  <div className="asn__field">
                    <label>Set By</label>
                    <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
                      <option value="">— Not specified —</option>
                      {teacherOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="asn__field">
                <label>Type the assignment</label>
                <textarea
                  rows={6}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Write the questions or instructions here…"
                />
              </div>

              <div className="asn__field">
                <label>…or upload a file (PDF, Word, image)</label>
                <label className="asn__file-drop">
                  <Upload size={16} />
                  <span>{file ? file.name : "Click to choose a file"}</span>
                  <input type="file" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
                </label>
                {file && (
                  <button type="button" onClick={() => setFile(null)} className="asn__link-btn">Remove file</button>
                )}
              </div>

              <p className="asn__hint">You can do both — type instructions and attach the question paper.</p>

              <div className="asn__create-actions">
                <button onClick={createAssignment} disabled={saving} className="asn__save">
                  {saving ? "Creating..." : "Create Assignment"}
                </button>
                <button onClick={() => setCreating(false)} className="asn__cancel">Cancel</button>
              </div>
            </div>
          ) : !active ? (
            <div className="asn__placeholder">
              <FileText size={30} />
              <p>Select an assignment to grade it, or create a new one.</p>
            </div>
          ) : (
            <>
              <div className="asn__panel-head">
                <div>
                  <h4>{active.title}</h4>
                  <p>
                    {active.subject} · {assignmentPrograms(active).join(", ")} {active.year_of_study} ·{" "}
                    {fmtDate(active.start_date)} → {fmtDate(active.due_date)} · out of {active.total_marks}
                  </p>
                </div>
                <div className="asn__stats">
                  <span>{submittedCount}/{students.length} submitted</span>
                  <span className="asn__graded">{gradedCount} graded</span>
                </div>
              </div>

              {(active.description || active.file_url) && (
                <div className="asn__brief">
                  {active.description && <p className="asn__brief-text">{active.description}</p>}
                  {active.file_url && (
                    <a href={active.file_url} target="_blank" rel="noopener noreferrer" className="asn__brief-file">
                      <Paperclip size={13} /> Open the assignment file
                    </a>
                  )}
                </div>
              )}

              <RosterNote subject={active.subject} split={rosterSplit} />

              {loadingGrades ? (
                <p className="asn__empty">Loading students...</p>
              ) : students.length === 0 ? (
                <p className="asn__empty">
                  Nobody in {assignmentPrograms(active).join(", ")} {active.year_of_study} studies{" "}
                  {active.subject}
                  {rosterSplit.notTaking > 0
                    ? ` — all ${rosterSplit.notTaking} of them take a different combination.`
                    : "."}
                </p>
              ) : (
                <>
                  <div className="asn__search">
                    <Search size={14} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student..." />
                  </div>

                  <div className="asn__grid-head">
                    <span>Student</span><span>Submission</span><span>Marks</span><span>Remarks</span>
                  </div>

                  {filteredStudents.map((s) => {
                    const sub = subs[s.id];
                    const late = sub?.submitted_at && sub.submitted_at.slice(0, 10) > active.due_date;
                    return (
                      <div key={s.id} className="asn__grid-row">
                        <div>
                          <p className="asn__student-name">
                            {s.name}
                            {isCombined && <span className="asn__program-tag">{s.program}</span>}
                          </p>
                          <p className="asn__student-roll">{s.roll_no}</p>
                        </div>

                        <div className="asn__sub-cell">
                          {/* A View button only for work actually uploaded. Work
                              handed in on paper is recorded by the tick below —
                              either the student ticked it on her portal or the
                              teacher ticks it here, and marks apply either way. */}
                          {sub?.file_url ? (
                            <>
                              <a href={sub.file_url} target="_blank" rel="noopener noreferrer" className="asn__view-btn">
                                <Eye size={13} /> View
                              </a>
                              {late && <span className="asn__late">late</span>}
                            </>
                          ) : (
                            <span className="asn__no-sub">Not uploaded</span>
                          )}
                          <button
                            type="button"
                            onClick={() => { setInClass({ ...inClass, [s.id]: !inClass[s.id] }); setSaved(false); }}
                            className={"asn__hand " + (inClass[s.id] ? "asn__hand--on" : "")}
                            title={inClass[s.id] ? "Handed in by hand in class — click to undo" : "Mark as handed in by hand in class"}
                          >
                            <Hand size={12} /> {inClass[s.id] ? "By hand in class" : "By hand?"}
                          </button>
                        </div>

                        <input
                          type="number"
                          min="0"
                          max={active.total_marks}
                          value={marks[s.id] ?? ""}
                          onChange={(e) => { setMarks({ ...marks, [s.id]: e.target.value }); setSaved(false); }}
                          placeholder={`/ ${active.total_marks}`}
                          className="asn__mark-input"
                        />

                        <input
                          value={remarks[s.id] ?? ""}
                          onChange={(e) => { setRemarks({ ...remarks, [s.id]: e.target.value }); setSaved(false); }}
                          placeholder="Optional feedback"
                          className="asn__remark-input"
                        />
                      </div>
                    );
                  })}

                  <button onClick={saveMarks} disabled={saving} className="asn__save">
                    {saving ? "Saving..." : "Save Marks"}
                  </button>
                  {saved && <p className="asn__confirm"><Check size={14} /> Marks saved for {active.title}</p>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
