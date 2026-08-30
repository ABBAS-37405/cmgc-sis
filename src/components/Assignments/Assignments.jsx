import { useState, useEffect } from "react";
import { FileText, Upload, Paperclip, CheckCircle, Clock, AlertTriangle, Hand } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { prepareUpload } from "../../lib/uploads";
import { ownSubjectsOnly } from "../../lib/studentSubjects";
import "./Assignments.css";

const todayStr = () => new Date().toISOString().split("T")[0];

const fmt = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

const daysLeft = (due, today) => Math.ceil((new Date(due) - new Date(today)) / 864e5);

export default function Assignments({ student }) {
  const [rows, setRows] = useState([]);
  const [subs, setSubs] = useState({}); // assignment_id -> submission
  const [loading, setLoading] = useState(Boolean(student?.id));
  const [uploadingId, setUploadingId] = useState(null);
  const [markingId, setMarkingId] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  // Fixed for the session: calling new Date() while rendering makes the render
  // impure and the list re-evaluate against a moving target.
  const [today] = useState(todayStr);

  const fetchAssignments = async () => {
    setLoading(true);
    setError("");

    // Assignments set for her group and class. `programs` carries every group an
    // assignment covers, so a combined one reaches her too.
    const { data: list, error: dbError } = await supabase
      .from("assignments")
      .select("*")
      .contains("programs", [student.program])
      .eq("year_of_study", student.year_of_study || "1st Year")
      .lte("start_date", today)
      .order("due_date", { ascending: false });

    if (dbError) {
      setError(dbError.message);
      setLoading(false);
      return;
    }

    const { data: mine } = await supabase
      .from("assignment_submissions")
      .select("*")
      .eq("student_id", student.id);

    const byAssignment = {};
    (mine || []).forEach((s) => { byAssignment[s.assignment_id] = s; });

    // The query is per group and class; a group holds more than one elective
    // combination, so Economics homework set for FA-IT reaches a girl in it who
    // takes Sociology instead. Her own subjects only — `unknown` still passes.
    setRows(ownSubjectsOnly(student, list || []));
    setSubs(byAssignment);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (student?.id) fetchAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  const upload = async (assignment, file) => {
    if (!file) return;
    setUploadingId(assignment.id);
    setError("");

    // Most submissions are photographs of handwritten pages, which is the case
    // this saves the most on. A PDF is passed through and only measured.
    const ready = await prepareUpload(file, "submission");
    if (ready.error) {
      setUploadingId(null);
      setError(ready.error);
      return;
    }

    const safe = ready.file.name.replace(/[^\w.-]/g, "_");
    // Runs on upload, never during render — Date.now() only keeps the path unique.
    // eslint-disable-next-line react-hooks/purity
    const path = `submissions/${assignment.id}/${student.id}-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("assignments").upload(path, ready.file);
    if (upErr) {
      setUploadingId(null);
      setError("Upload failed: " + upErr.message);
      return;
    }
    const fileUrl = supabase.storage.from("assignments").getPublicUrl(path).data.publicUrl;

    const existing = subs[assignment.id];
    const { error: dbError } = await supabase
      .from("assignment_submissions")
      .upsert(
        {
          assignment_id: assignment.id,
          student_id: student.id,
          file_url: fileUrl,
          submitted_at: new Date().toISOString(),
          // Re-uploading after grading clears the old mark: the teacher is
          // looking at different work now.
          marks_obtained: existing?.marks_obtained ?? null,
          remarks: existing?.remarks ?? null,
          graded_at: existing?.graded_at ?? null,
        },
        { onConflict: "assignment_id,student_id" }
      );

    setUploadingId(null);
    if (dbError) {
      setError("Could not save your submission: " + dbError.message);
      return;
    }
    await fetchAssignments();
  };

  // The other way of handing in: she showed the teacher her work on paper in
  // class. The flag lives on the same row as an upload, so doing both is fine.
  const toggleInClass = async (assignment) => {
    const existing = subs[assignment.id];
    const next = !existing?.submitted_in_class;
    setMarkingId(assignment.id);
    setError("");

    const { error: dbError } = await supabase
      .from("assignment_submissions")
      .upsert(
        {
          assignment_id: assignment.id,
          student_id: student.id,
          submitted_in_class: next,
          file_url: existing?.file_url ?? null,
          submitted_at: existing?.submitted_at ?? null,
          marks_obtained: existing?.marks_obtained ?? null,
          remarks: existing?.remarks ?? null,
          graded_at: existing?.graded_at ?? null,
        },
        { onConflict: "assignment_id,student_id" }
      );

    setMarkingId(null);
    if (dbError) {
      setError("Could not save: " + dbError.message);
      return;
    }
    await fetchAssignments();
  };

  if (loading) {
    return <div className="asg"><p className="asg__empty">Loading assignments...</p></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="asg">
        <div className="asg__card asg__none">
          <FileText size={30} />
          <p>No assignments yet.</p>
          <p className="asg__none-hint">Assignments set by your teachers will appear here.</p>
        </div>
      </div>
    );
  }

  const handedIn = (sub) => Boolean(sub?.file_url || sub?.submitted_in_class);
  const pendingCount = rows.filter((a) => !handedIn(subs[a.id]) && a.due_date >= today).length;
  const gradedCount = rows.filter((a) => subs[a.id]?.marks_obtained != null).length;

  return (
    <div className="asg">
      {error && <p className="asg__error">{error}</p>}

      <div className="asg__summary">
        <div className="asg__stat">
          <p className="asg__stat-value">{rows.length}</p>
          <p className="asg__stat-label">Total</p>
        </div>
        <div className="asg__stat">
          <p className="asg__stat-value">{pendingCount}</p>
          <p className="asg__stat-label">To Submit</p>
        </div>
        <div className="asg__stat">
          <p className="asg__stat-value">{gradedCount}</p>
          <p className="asg__stat-label">Graded</p>
        </div>
      </div>

      {rows.map((a) => {
        const sub = subs[a.id];
        const submitted = handedIn(sub);
        const overdue = a.due_date < today;
        const left = daysLeft(a.due_date, today);
        const graded = sub?.marks_obtained != null;
        const open = openId === a.id;

        return (
          <div key={a.id} className="asg__card">
            <div className="asg__head">
              <div>
                <h3 className="asg__title">{a.title}</h3>
                <p className="asg__meta">{a.subject} · out of {a.total_marks} marks</p>
              </div>
              {graded ? (
                <span className="asg__badge asg__badge--graded">
                  <CheckCircle size={12} /> {sub.marks_obtained}/{a.total_marks}
                </span>
              ) : sub?.file_url ? (
                <span className="asg__badge asg__badge--submitted"><CheckCircle size={12} /> Submitted</span>
              ) : sub?.submitted_in_class ? (
                <span className="asg__badge asg__badge--submitted"><Hand size={12} /> By hand in class</span>
              ) : overdue ? (
                <span className="asg__badge asg__badge--overdue"><AlertTriangle size={12} /> Overdue</span>
              ) : (
                <span className="asg__badge asg__badge--due">
                  <Clock size={12} /> {left === 0 ? "Due today" : `${left} day${left === 1 ? "" : "s"} left`}
                </span>
              )}
            </div>

            <p className="asg__dates">Given {fmt(a.start_date)} · Due {fmt(a.due_date)}</p>

            {(a.description || a.file_url) && (
              <>
                <button className="asg__toggle" onClick={() => setOpenId(open ? null : a.id)}>
                  {open ? "Hide the assignment" : "Read the assignment"}
                </button>
                {open && (
                  <div className="asg__brief">
                    {a.description && <p className="asg__brief-text">{a.description}</p>}
                    {a.file_url && (
                      <a href={a.file_url} target="_blank" rel="noopener noreferrer" className="asg__file-link">
                        <Paperclip size={13} /> Open the assignment file
                      </a>
                    )}
                  </div>
                )}
              </>
            )}

            {sub?.remarks && (
              <p className="asg__remarks"><strong>Teacher's note:</strong> {sub.remarks}</p>
            )}

            <div className="asg__actions">
              {sub?.file_url && (
                <a href={sub.file_url} target="_blank" rel="noopener noreferrer" className="asg__my-file">
                  <Paperclip size={13} /> Your submitted work
                </a>
              )}
              <label className={"asg__upload " + (uploadingId === a.id ? "asg__upload--busy" : "")}>
                <Upload size={14} />
                {uploadingId === a.id
                  ? "Uploading…"
                  : sub?.file_url
                    ? "Replace my work"
                    : "Upload my work"}
                <input
                  type="file"
                  hidden
                  disabled={uploadingId === a.id}
                  onChange={(e) => { upload(a, e.target.files[0]); e.target.value = ""; }}
                />
              </label>
              <button
                type="button"
                disabled={markingId === a.id}
                onClick={() => toggleInClass(a)}
                className={"asg__inclass " + (sub?.submitted_in_class ? "asg__inclass--on" : "")}
              >
                <Hand size={14} />
                {markingId === a.id
                  ? "Saving…"
                  : sub?.submitted_in_class
                    ? "Handed in by hand in class ✓"
                    : "I handed it in by hand in class"}
              </button>
              {overdue && !submitted && (
                <span className="asg__late-note">The due date has passed — it will be marked late.</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
