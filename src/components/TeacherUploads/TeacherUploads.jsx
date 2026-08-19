import { useState, useEffect } from "react";
import {
  Search, Trash2, Pencil, X, Upload, Paperclip, ExternalLink, FileText, BookOpen,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import {
  LMS_BUCKET, LMS_CATEGORIES, YEAR_OPTIONS, categoryLabel,
  programsCovered, removeMaterial, parseYouTube,
} from "../../lib/lms";
import { prepareUpload } from "../../lib/uploads";
import { pathFromPublicUrl } from "../../lib/storageCleanup";
import "./TeacherUploads.css";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

const KINDS = [
  { id: "all", label: "Everything" },
  { id: "assignment", label: "Assignments" },
  { id: "material", label: "Course Material" },
];

const NO_TEACHER = "__none__";

/**
 * Everything the teaching staff has put in front of students, in one list.
 *
 * The two screens that publish this material already exist — `AssignmentEntry`
 * and `LmsManage` — but both are organised around *setting something new*: you
 * pick a class, a subject and a group, and then you see what is there. Neither
 * can answer "what has this teacher published", and neither can change an item
 * once it is up. That is what the office actually asks for: a paper uploaded to
 * the wrong class, a due date that has to move, a title with the chapter number
 * wrong in it.
 *
 * So this is a **third view of the same two tables**, not a third way to create
 * anything. There is no "Add" button here on purpose: adding belongs on the
 * screens that know the eligibility rules (which groups study which subject),
 * and duplicating those rules is how the two would drift apart.
 *
 * **What may be edited is the content; what may not is the audience.** Subject,
 * groups and — for an assignment — the class are fixed, because they are what
 * decides whose roster the item is graded against. Moving an assignment to
 * another group after girls have submitted to it leaves their submissions
 * pointing at a roster they are no longer on. To send something to a different
 * class, delete it and set it again.
 *
 * Needs no migration: `assignments_update`/`assignments_delete` are `is_staff()`
 * and `lms_write_staff` is `for all`, which a super admin already satisfies.
 */
export default function TeacherUploads({ teachers = [] }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [teacherFilter, setTeacherFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState(null);  // { key, kind, form }
  const [file, setFile] = useState(null);
  const [dropFile, setDropFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [formError, setFormError] = useState("");

  const teacherName = (id) => teachers.find((t) => t.id === id)?.name || null;

  const load = async () => {
    setLoading(true);
    setError("");

    // Two tables, one request each — the list is merged in JS rather than asking
    // the database for a union it has no view for.
    const [assignments, materials] = await Promise.all([
      supabase.from("assignments").select("*").order("created_at", { ascending: false }),
      supabase.from("lms_materials").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
    ]);

    // Surfaced, never swallowed. A refused read comes back as zero rows, and an
    // empty list that should not be empty reads as "she has published nothing".
    if (assignments.error || materials.error) {
      setError((assignments.error || materials.error).message);
    }

    const rows = [
      ...(assignments.data || []).map((a) => ({
        key: `assignment:${a.id}`,
        kind: "assignment",
        row: a,
        title: a.title,
        subject: a.subject,
        programs: programsCovered(a),
        year: a.year_of_study,
        teacherId: a.teacher_id,
        createdAt: a.created_at,
        fileUrl: a.file_url,
        fileName: null,
        linkUrl: null,
      })),
      ...(materials.data || []).map((m) => ({
        key: `material:${m.id}`,
        kind: "material",
        row: m,
        title: m.title,
        subject: m.subject,
        programs: programsCovered(m),
        year: m.year_of_study,
        teacherId: m.teacher_id,
        createdAt: m.created_at,
        fileUrl: m.file_url,
        fileName: m.file_name,
        linkUrl: m.link_url,
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    setItems(rows);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const visible = items.filter((it) => {
    if (kindFilter !== "all" && it.kind !== kindFilter) return false;
    if (teacherFilter === NO_TEACHER && it.teacherId) return false;
    if (teacherFilter !== "all" && teacherFilter !== NO_TEACHER && it.teacherId !== teacherFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      it.title.toLowerCase().includes(q) ||
      (it.subject || "").toLowerCase().includes(q) ||
      (teacherName(it.teacherId) || "").toLowerCase().includes(q)
    );
  });

  /* ---------------------------------------------------------------- editing */

  const startEdit = (it) => {
    setFormError("");
    setFile(null);
    setDropFile(false);
    setEditing({
      key: it.key,
      kind: it.kind,
      form: it.kind === "assignment"
        ? {
            title: it.row.title || "",
            description: it.row.description || "",
            total_marks: String(it.row.total_marks ?? ""),
            start_date: it.row.start_date || "",
            due_date: it.row.due_date || "",
          }
        : {
            title: it.row.title || "",
            body: it.row.body || "",
            link_url: it.row.link_url || "",
            category: it.row.category || LMS_CATEGORIES[0].id,
            year_of_study: it.row.year_of_study || YEAR_OPTIONS[0],
          },
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setFile(null);
    setDropFile(false);
    setFormError("");
  };

  const setField = (key, value) =>
    setEditing((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }));

  /** Uploads a replacement, or returns what was already there. */
  const resolveFile = async (it) => {
    if (dropFile) return { url: null, name: null };
    if (!file) return { url: it.fileUrl, name: it.fileName };

    const bucket = it.kind === "assignment" ? "assignments" : LMS_BUCKET;
    const ready = await prepareUpload(file, it.kind === "assignment" ? "submission" : "material");
    if (ready.error) return { error: ready.error };

    const safe = ready.file.name.replace(/[^\w.-]/g, "_");
    const path = it.kind === "assignment"
      ? `questions/${Date.now()}-${safe}`
      : `${(it.subject || "material").replace(/[^\w]/g, "_")}/${Date.now()}-${safe}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, ready.file);
    if (upErr) return { error: `File upload failed: ${upErr.message}` };

    // ready.file.name, not file.name — a compressed scan is re-encoded as .jpg and
    // labelling it .png would misname the student's download.
    return {
      url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
      name: ready.file.name,
    };
  };

  /**
   * The old file, once the row safely points at the new one — the same order
   * StudentsList uses when a profile picture is replaced.
   *
   * Only for LMS. The `assignments` bucket deliberately has no delete policy (a
   * submission is a student's own work and the only copy of it), so a replaced
   * question paper is left where it is rather than failing silently; see the
   * storage cleanup section in CLAUDE.md.
   */
  const dropOldLmsFile = async (oldUrl, newUrl) => {
    if (!oldUrl || oldUrl === newUrl) return;
    const path = pathFromPublicUrl(oldUrl, LMS_BUCKET);
    if (path) await supabase.storage.from(LMS_BUCKET).remove([path]);
  };

  const saveEdit = async (it) => {
    setFormError("");
    const f = editing.form;

    if (!f.title.trim()) return setFormError("Give it a title — that is all the student sees in her list.");

    if (it.kind === "assignment") {
      const total = parseFloat(f.total_marks);
      if (!total || total <= 0) return setFormError("Total marks must be greater than 0.");
      if (!f.start_date || !f.due_date) return setFormError("Both dates are required.");
      // The database carries this as a check constraint; saying it here means she
      // is told before the save rather than by a Postgres error message.
      if (f.due_date < f.start_date) return setFormError("The due date cannot be before the start date.");
      if (!f.description.trim() && !file && (dropFile || !it.fileUrl)) {
        return setFormError("An assignment cannot be empty — type it out, attach a file, or both.");
      }
    } else if (!f.body.trim() && !f.link_url.trim() && !file && (dropFile || !it.fileUrl)) {
      return setFormError("Leave something on it — written text, a link, or a file.");
    }

    if (it.kind === "material" && f.link_url.trim() && !/^https?:\/\//i.test(f.link_url.trim())) {
      return setFormError("The link should start with http:// or https://");
    }

    setSaving(true);
    const resolved = await resolveFile(it);
    if (resolved.error) {
      setSaving(false);
      return setFormError(resolved.error);
    }

    const table = it.kind === "assignment" ? "assignments" : "lms_materials";
    const patch = it.kind === "assignment"
      ? {
          title: f.title.trim(),
          description: f.description.trim() || null,
          total_marks: parseFloat(f.total_marks),
          start_date: f.start_date,
          due_date: f.due_date,
          file_url: resolved.url,
        }
      : {
          title: f.title.trim(),
          body: f.body.trim() || null,
          link_url: f.link_url.trim() || null,
          category: f.category,
          year_of_study: f.year_of_study === "Both Years" ? null : f.year_of_study,
          file_url: resolved.url,
          file_name: resolved.name,
        };

    // .select("id") is not decoration: an update RLS refuses comes back as a plain
    // success with zero rows, so without it this screen would report "saved" for a
    // change the database threw away. See WRITE_BLOCKED_HINT.
    const { data, error: dbError } = await supabase
      .from(table).update(patch).eq("id", it.row.id).select("id");
    setSaving(false);

    if (dbError) return setFormError(dbError.message);
    if (!data || data.length === 0) return setFormError(WRITE_BLOCKED_HINT);

    if (it.kind === "material") await dropOldLmsFile(it.fileUrl, resolved.url);

    cancelEdit();
    await load();
  };

  /* --------------------------------------------------------------- deleting */

  const remove = async (it) => {
    if (it.kind === "assignment") {
      if (!window.confirm(
        `Delete "${it.title}"?\n\nEvery student's submission and marks for it go too, and that cannot be undone.`
      )) return;

      setBusyKey(it.key);
      // A delete RLS refuses returns success with no rows, exactly like an update.
      const { data, error: dbError } = await supabase
        .from("assignments").delete().eq("id", it.row.id).select("id");
      setBusyKey(null);

      if (dbError) { alert("Could not delete: " + dbError.message); return; }
      if (!data || data.length === 0) { alert(WRITE_BLOCKED_HINT); return; }
    } else {
      if (!window.confirm(`Remove "${it.title}" from the students' LMS?`)) return;

      setBusyKey(it.key);
      // Soft delete plus the file, which is what LmsManage already does — reused
      // rather than repeated, so there is one definition of removing material.
      const message = await removeMaterial(it.row.id);
      setBusyKey(null);

      if (message === "BLOCKED") { alert(WRITE_BLOCKED_HINT); return; }
      if (message) { alert("Could not remove: " + message); return; }
    }
    await load();
  };

  /* ----------------------------------------------------------------- render */

  const counts = {
    assignment: items.filter((i) => i.kind === "assignment").length,
    material: items.filter((i) => i.kind === "material").length,
  };

  return (
    <div className="tup">
      <div className="tup__head">
        <div>
          <h3>Student Uploads</h3>
          <p>
            Everything the staff has published to students — assignments and course material —
            in one list, whoever put it up. Edit what it says, or take it down.
          </p>
        </div>
        <span className="tup__count">
          {counts.assignment} assignment{counts.assignment === 1 ? "" : "s"} · {counts.material} material item{counts.material === 1 ? "" : "s"}
        </span>
      </div>

      <div className="tup__filters">
        <div className="tup__field">
          <label>Teacher</label>
          <select value={teacherFilter} onChange={(e) => { setTeacherFilter(e.target.value); cancelEdit(); }}>
            <option value="all">All teachers</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value={NO_TEACHER}>Not recorded / published by an admin</option>
          </select>
        </div>

        <div className="tup__field">
          <label>Kind</label>
          <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); cancelEdit(); }}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>

        <div className="tup__field tup__field--grow">
          <label>Search</label>
          <div className="tup__search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title, subject or teacher…"
            />
          </div>
        </div>
      </div>

      {error && <p className="tup__error">{error}</p>}

      {loading ? (
        <p className="tup__empty">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="tup__empty">
          {items.length === 0
            ? "Nothing has been published to students yet."
            : "Nothing matches these filters."}
        </p>
      ) : (
        <div className="tup__list">
          {visible.map((it) => {
            const isEditing = editing?.key === it.key;
            const youtube = parseYouTube(it.linkUrl);
            return (
              <div key={it.key} className={"tup__row " + (isEditing ? "tup__row--editing" : "")}>
                <div className="tup__row-head">
                  <div className="tup__row-main">
                    <p className="tup__row-title">
                      <span className={`tup__kind tup__kind--${it.kind}`}>
                        {it.kind === "assignment" ? <FileText size={11} /> : <BookOpen size={11} />}
                        {it.kind === "assignment" ? "Assignment" : categoryLabel(it.row.category)}
                      </span>
                      {it.title}
                    </p>
                    <p className="tup__row-meta">
                      {it.subject} · {it.programs.join(", ")} · {it.year || "Both years"} ·{" "}
                      {teacherName(it.teacherId) || <em>teacher not recorded</em>} · {fmtDate(it.createdAt)}
                    </p>
                    {it.kind === "assignment" && (
                      <p className="tup__row-meta">
                        {fmtDate(it.row.start_date)} → {fmtDate(it.row.due_date)} · out of {it.row.total_marks}
                      </p>
                    )}
                    <div className="tup__row-tags">
                      {it.fileUrl && (
                        <a className="tup__tag" href={it.fileUrl} target="_blank" rel="noopener noreferrer">
                          <Paperclip size={11} /> {it.fileName || "File"}
                        </a>
                      )}
                      {it.linkUrl && (
                        <a className="tup__tag" href={it.linkUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={11} /> {youtube ? "YouTube" : "Link"}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="tup__row-actions">
                    <button
                      onClick={() => (isEditing ? cancelEdit() : startEdit(it))}
                      className="tup__btn"
                    >
                      {isEditing ? <><X size={13} /> Cancel</> : <><Pencil size={13} /> Edit</>}
                    </button>
                    <button
                      onClick={() => remove(it)}
                      disabled={busyKey === it.key}
                      className="tup__btn tup__btn--danger"
                      title={it.kind === "assignment"
                        ? "Delete this assignment and every submission against it"
                        : "Remove this from the students' LMS"}
                    >
                      <Trash2 size={13} /> {busyKey === it.key ? "Removing…" : "Delete"}
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="tup__edit">
                    <div className="tup__edit-grid">
                      <div className="tup__field tup__field--wide">
                        <label>Title</label>
                        <input value={editing.form.title} onChange={(e) => setField("title", e.target.value)} />
                      </div>

                      {it.kind === "assignment" ? (
                        <>
                          <div className="tup__field">
                            <label>Total Marks</label>
                            <input type="number" min="1" value={editing.form.total_marks}
                              onChange={(e) => setField("total_marks", e.target.value)} />
                          </div>
                          <div className="tup__field">
                            <label>From</label>
                            <input type="date" value={editing.form.start_date}
                              onChange={(e) => setField("start_date", e.target.value)} />
                          </div>
                          <div className="tup__field">
                            <label>To (due)</label>
                            <input type="date" value={editing.form.due_date}
                              onChange={(e) => setField("due_date", e.target.value)} />
                          </div>
                          <div className="tup__field tup__field--wide">
                            <label>The assignment</label>
                            <textarea rows={5} value={editing.form.description}
                              onChange={(e) => setField("description", e.target.value)}
                              placeholder="The questions or instructions." />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="tup__field">
                            <label>Kind</label>
                            <select value={editing.form.category} onChange={(e) => setField("category", e.target.value)}>
                              {LMS_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </div>
                          <div className="tup__field">
                            <label>Class</label>
                            <select value={editing.form.year_of_study} onChange={(e) => setField("year_of_study", e.target.value)}>
                              {YEAR_OPTIONS.map((y) => <option key={y}>{y}</option>)}
                            </select>
                          </div>
                          <div className="tup__field tup__field--wide">
                            <label>Written text</label>
                            <textarea rows={4} value={editing.form.body}
                              onChange={(e) => setField("body", e.target.value)} />
                          </div>
                          <div className="tup__field tup__field--wide">
                            <label>Link</label>
                            <input value={editing.form.link_url}
                              onChange={(e) => setField("link_url", e.target.value)}
                              placeholder="https://…" />
                          </div>
                        </>
                      )}

                      <div className="tup__field tup__field--wide">
                        <label>Attached file</label>
                        {it.fileUrl && !file && !dropFile && (
                          <p className="tup__file-now">
                            <Paperclip size={12} />
                            <a href={it.fileUrl} target="_blank" rel="noopener noreferrer">
                              {it.fileName || "the file on it now"}
                            </a>
                            <button type="button" className="tup__link-btn" onClick={() => setDropFile(true)}>
                              Remove it
                            </button>
                          </p>
                        )}
                        {dropFile && (
                          <p className="tup__file-now">
                            The file will be taken off when you save.
                            <button type="button" className="tup__link-btn" onClick={() => setDropFile(false)}>Keep it</button>
                          </p>
                        )}
                        <label className="tup__file">
                          <Upload size={15} />
                          {file ? file.name : it.fileUrl ? "Choose a different file" : "Attach a file"}
                          <input type="file" hidden onChange={(e) => { setFile(e.target.files?.[0] || null); setDropFile(false); }} />
                        </label>
                        {file && (
                          <button type="button" className="tup__link-btn" onClick={() => setFile(null)}>
                            Keep the existing file instead
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="tup__fixed-note">
                      Subject, groups{it.kind === "assignment" ? " and class are" : " are"} fixed here —
                      {it.kind === "assignment"
                        ? " they decide whose roster this is graded against, and girls may already have submitted to it."
                        : " they decide which students it reaches."}{" "}
                      To send it somewhere else, delete it and set it again on the
                      {it.kind === "assignment" ? " Assignments" : " LMS"} screen.
                    </p>

                    {formError && <p className="tup__error">{formError}</p>}

                    <div className="tup__edit-actions">
                      <button onClick={() => saveEdit(it)} disabled={saving} className="tup__btn tup__btn--primary">
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                      <button onClick={cancelEdit} className="tup__btn">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
