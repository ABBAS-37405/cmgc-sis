import { useState, useEffect } from "react";
import { Upload, Trash2, Plus, X, Pencil, ExternalLink, MonitorPlay } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/academics";
import { teacherPrograms, teacherSubjectsFor } from "../../lib/teacherAuth";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import {
  LMS_BUCKET, LMS_CATEGORIES, LMS_ALL_SUBJECTS, YEAR_OPTIONS, categoryLabel,
  fetchMaterialsForStaff, removeMaterial, programsCovered, parseYouTube, isPlaylist,
} from "../../lib/lms";
import { prepareUpload } from "../../lib/uploads";
import { pathFromPublicUrl } from "../../lib/storageCleanup";
import "./LmsManage.css";

const ALL_PROGRAMS = "All Programs";

const when = (iso) =>
  new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });

const blankForm = () => ({
  category: LMS_CATEGORIES[0].id,
  title: "",
  body: "",
  link_url: "",
  year_of_study: YEAR_OPTIONS[0],
});

/**
 * Where staff publish material for a subject.
 *
 * Shared between the two portals, the same way `ClassTestEntry` is: pass a
 * `teacher` and it locks to her own subjects and groups; pass `teacher={null}`
 * with `allowedPrograms` and it becomes the admin's full-range view, offering
 * every subject those groups teach.
 *
 * Whoever publishes, it lands in the LMS tab of every student in the chosen
 * groups who studies that subject.
 */
export default function LmsManage({ teacher, allowedPrograms = [] }) {
  // Empty means unrestricted on both sides — the convention allowed_programs
  // and teachers.programs already share.
  const allowed = teacher ? teacherPrograms(teacher) : allowedPrograms;
  const visiblePrograms = allowed.length > 0 ? PROGRAMS.filter((p) => allowed.includes(p)) : PROGRAMS;

  // Every group she is entitled to starts ticked, exactly as in `ClassTestEntry` and
  // `AssignmentEntry`: a teacher's groups are the ones she teaches, so "all of mine" is
  // the honest default, and material published to one group out of three is how a class
  // never sees a paper scheme. An empty `programs[]` means unrestricted rather than
  // unassigned, so she is ticked into all of them too. An admin, whose visible groups are
  // nobody's in particular, keeps the pick-one default.
  const [selectedPrograms, setSelectedPrograms] = useState(() =>
    teacher ? visiblePrograms : visiblePrograms.slice(0, 1));
  const [subject, setSubject] = useState("");
  const [form, setForm] = useState(blankForm);
  const [file, setFile] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editFile, setEditFile] = useState(null);
  const [editDropFile, setEditDropFile] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Only the subjects she teaches that the chosen groups actually offer. The
  // admin (no `teacher`) also gets `LMS_ALL_SUBJECTS`, for material every
  // student needs regardless of her elective combination — a lesson plan, a
  // college-wide notice. A teacher is scoped to her own subjects, so this
  // never appears for her.
  const subjectOptions = teacher
    ? teacherSubjectsFor(teacher, selectedPrograms)
    : [...teacherSubjectsFor(teacher, selectedPrograms), LMS_ALL_SUBJECTS];
  // A stable string, so the effect below has a dependency lint can check.
  const programKey = selectedPrograms.join("|");

  const load = async () => {
    setLoading(true);
    setMaterials(await fetchMaterialsForStaff({
      programs: visiblePrograms,
      // `LMS_ALL_SUBJECTS` is not a subject any group offers, so it would
      // otherwise be filtered straight out of the list below.
      subjects: [...teacherSubjectsFor(teacher, visiblePrograms), LMS_ALL_SUBJECTS],
    }));
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the subject valid when the group selection changes underneath it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (subjectOptions.length > 0 && !subjectOptions.includes(subject)) setSubject(subjectOptions[0]);
    // Deliberately keyed on the group only: re-running when `subject` changes
    // would fight the admin's own pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programKey]);

  const toggleProgram = (program) => {
    setSelectedPrograms((prev) =>
      prev.includes(program) ? prev.filter((p) => p !== program) : [...prev, program]
    );
  };

  const publish = async () => {
    setError("");
    if (selectedPrograms.length === 0) return setError("Choose at least one group.");
    if (!subject) return setError("Choose a subject.");
    if (!form.title.trim()) return setError("Give it a title, so students know what it is.");
    if (!form.body.trim() && !form.link_url.trim() && !file) {
      return setError("Add something to it — written text, a link, or a file.");
    }
    if (form.link_url.trim() && !/^https?:\/\//i.test(form.link_url.trim())) {
      return setError("The link should start with http:// or https://");
    }

    setSaving(true);
    let fileUrl = null;
    let fileName = null;

    if (file) {
      // Notes and past papers are usually photographed pages. This is also the
      // one screen with no cap at all until now — a scanned book could take the
      // whole bucket on its own.
      const ready = await prepareUpload(file, "material");
      if (ready.error) {
        setSaving(false);
        return setError(ready.error);
      }
      const safe = ready.file.name.replace(/[^\w.-]/g, "_");
      const path = `${subject.replace(/[^\w]/g, "_")}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(LMS_BUCKET).upload(path, ready.file);
      if (upErr) {
        setSaving(false);
        // The teacher reading this cannot create a storage bucket, so a missing one
        // is not something to tell her to "check" — it is told apart from a real
        // upload failure and answered with what she can still do today.
        const missingBucket = /bucket not found/i.test(upErr.message || "");
        return setError(
          missingBucket
            ? `The college's file storage is not set up yet, so the attachment could not go up. ` +
              `Ask the office to run supabase_lms.sql in Supabase (it creates the "${LMS_BUCKET}" bucket). ` +
              `Meanwhile you can still publish this with the written text and the link — only the file is blocked.`
            : `File upload failed: ${upErr.message}`
        );
      }
      const { data } = supabase.storage.from(LMS_BUCKET).getPublicUrl(path);
      fileUrl = data?.publicUrl || null;
      // The name of what was actually stored: a compressed scan is re-encoded as
      // a .jpg, and labelling it .png would misname the student's download.
      fileName = ready.file.name;
    }

    const combined = selectedPrograms.length > 1;
    const { error: dbError } = await supabase.from("lms_materials").insert({
      // The literal for a combined item, exactly like class_tests — the real
      // coverage always lives in `programs`.
      program: combined ? ALL_PROGRAMS : selectedPrograms[0],
      programs: selectedPrograms,
      subject,
      year_of_study: form.year_of_study === "Both Years" ? null : form.year_of_study,
      category: form.category,
      title: form.title.trim(),
      body: form.body.trim() || null,
      link_url: form.link_url.trim() || null,
      file_url: fileUrl,
      file_name: fileName,
      teacher_id: teacher?.id || null,
    });
    setSaving(false);

    if (dbError) {
      // Inserts do raise on an RLS refusal, unlike updates.
      setError(dbError.code === "42501"
        ? (teacher
            ? "You are not allowed to publish for these groups. Ask the admin for the LMS right, or for these groups to be assigned to you."
            : "You are not allowed to publish for these groups. A super admin can grant you the LMS permission, or widen your allowed programs.")
        : dbError.message);
      return;
    }

    setForm(blankForm());
    setFile(null);
    setShowForm(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
    await load();
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.title}" from the students' LMS?`)) return;
    const message = await removeMaterial(item.id);
    if (message === "BLOCKED") { alert(WRITE_BLOCKED_HINT); return; }
    if (message) { alert("Could not remove: " + message); return; }
    await load();
  };

  /* -------------------------------------------------------------- editing */

  const startEdit = (item) => {
    setShowForm(false);
    setEditingId(item.id);
    setEditForm({
      title: item.title || "",
      body: item.body || "",
      link_url: item.link_url || "",
      category: item.category || LMS_CATEGORIES[0].id,
      year_of_study: item.year_of_study || YEAR_OPTIONS[0],
    });
    setEditFile(null);
    setEditDropFile(false);
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setEditFile(null);
    setEditDropFile(false);
    setEditError("");
  };

  /** Uploads a replacement file, or hands back what is already on the row. */
  const resolveEditFile = async (item) => {
    if (editDropFile) return { url: null, name: null };
    if (!editFile) return { url: item.file_url, name: item.file_name };

    const ready = await prepareUpload(editFile, "material");
    if (ready.error) return { error: ready.error };

    const safe = ready.file.name.replace(/[^\w.-]/g, "_");
    const path = `${(item.subject || "material").replace(/[^\w]/g, "_")}/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from(LMS_BUCKET).upload(path, ready.file);
    if (upErr) return { error: `File upload failed: ${upErr.message}` };

    // ready.file.name, not editFile.name — a compressed scan is re-encoded as
    // .jpg, and labelling it .png would misname the student's download.
    return {
      url: supabase.storage.from(LMS_BUCKET).getPublicUrl(path).data.publicUrl,
      name: ready.file.name,
    };
  };

  /** The old file, once the row safely points at the new one — same order StudentsList uses for a profile picture. */
  const dropOldFile = async (oldUrl, newUrl) => {
    if (!oldUrl || oldUrl === newUrl) return;
    const path = pathFromPublicUrl(oldUrl, LMS_BUCKET);
    if (path) await supabase.storage.from(LMS_BUCKET).remove([path]);
  };

  /**
   * What may change is the content; the audience does not. Subject and groups
   * decide which students this reaches and which entitlement check the write
   * has to pass (`teacher_can('lms', p)` / `admin_can_lms()`) — the same reason
   * `TeacherUploads` keeps them fixed on its own edit screen. To send this
   * somewhere else, remove it and publish again with the groups it should go to.
   */
  const saveEdit = async (item) => {
    setEditError("");
    const f = editForm;
    if (!f.title.trim()) return setEditError("Give it a title, so students know what it is.");
    if (!f.body.trim() && !f.link_url.trim() && !editFile && (editDropFile || !item.file_url)) {
      return setEditError("Leave something on it — written text, a link, or a file.");
    }
    if (f.link_url.trim() && !/^https?:\/\//i.test(f.link_url.trim())) {
      return setEditError("The link should start with http:// or https://");
    }

    setEditSaving(true);
    const resolved = await resolveEditFile(item);
    if (resolved.error) {
      setEditSaving(false);
      return setEditError(resolved.error);
    }

    // .select("id") is not decoration: an update RLS refuses comes back as a
    // plain success with zero rows, so without it this would report "saved" for
    // a change the database threw away. See WRITE_BLOCKED_HINT.
    const { data, error: dbError } = await supabase
      .from("lms_materials")
      .update({
        title: f.title.trim(),
        body: f.body.trim() || null,
        link_url: f.link_url.trim() || null,
        category: f.category,
        year_of_study: f.year_of_study === "Both Years" ? null : f.year_of_study,
        file_url: resolved.url,
        file_name: resolved.name,
      })
      .eq("id", item.id)
      .select("id");
    setEditSaving(false);

    if (dbError) return setEditError(dbError.message);
    if (!data || data.length === 0) return setEditError(WRITE_BLOCKED_HINT);

    await dropOldFile(item.file_url, resolved.url);

    cancelEdit();
    await load();
  };

  return (
    <div className="lmsm">
      <div className="lmsm__head">
        <div>
          <h3>Course Material</h3>
          <p>{teacher
            ? "Whatever you publish here appears in the LMS tab of every student in the chosen groups."
            : "Everything published for these groups, by you or by any teacher. Adding here works exactly as it does for a teacher."}</p>
        </div>
        <button className="lmsm__btn lmsm__btn--primary" onClick={() => { setShowForm(!showForm); setError(""); cancelEdit(); }}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Material</>}
        </button>
      </div>

      {saved && <p className="lmsm__saved">Published — your students can see it now.</p>}

      {showForm && (
        <div className="lmsm__form">
          <div className="lmsm__field lmsm__field--wide">
            <label>Groups this is for</label>
            <div className="lmsm__checks">
              {visiblePrograms.map((p) => (
                <label key={p} className={"lmsm__check " + (selectedPrograms.includes(p) ? "lmsm__check--on" : "")}>
                  <input type="checkbox" checked={selectedPrograms.includes(p)} onChange={() => toggleProgram(p)} />
                  {p}
                </label>
              ))}
            </div>
            <span className="lmsm__hint">Tick more than one to publish the same material to several groups.</span>
          </div>

          <div className="lmsm__field">
            <label>Subject</label>
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjectOptions.length === 0 && <option value="">No subject available</option>}
              {subjectOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="lmsm__field">
            <label>Class</label>
            <select value={form.year_of_study} onChange={(e) => setForm({ ...form, year_of_study: e.target.value })}>
              {YEAR_OPTIONS.map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>

          <div className="lmsm__field">
            <label>Kind</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {LMS_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="lmsm__hint">
              {LMS_CATEGORIES.find((c) => c.id === form.category)?.hint}
            </span>
          </div>

          <div className="lmsm__field lmsm__field--wide">
            <label>Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Chapter 3 — Chemical Bonding (recorded lecture)"
            />
          </div>

          <div className="lmsm__field lmsm__field--wide">
            <label>Write something (optional)</label>
            <textarea
              rows={4}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Notes, instructions, what to revise — anything you want the class to read."
            />
          </div>

          <div className="lmsm__field lmsm__field--wide">
            <label>Link (optional)</label>
            <input
              value={form.link_url}
              onChange={(e) => setForm({ ...form, link_url: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=... or any website"
            />
            <LinkPreview url={form.link_url} />
          </div>

          <div className="lmsm__field lmsm__field--wide">
            <label>File (optional)</label>
            <label className="lmsm__file">
              <Upload size={15} />
              {file ? file.name : "Choose a PDF, image or document"}
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} hidden />
            </label>
            {file && (
              <button className="lmsm__clear" onClick={() => setFile(null)}>Remove file</button>
            )}
          </div>

          {error && <p className="lmsm__error">{error}</p>}

          <div className="lmsm__actions">
            <button className="lmsm__btn lmsm__btn--primary" onClick={publish} disabled={saving}>
              {saving ? "Publishing..." : "Publish to Students"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="lmsm__empty">Loading...</p>
      ) : materials.length === 0 ? (
        <p className="lmsm__empty">{teacher ? "You have not published anything yet." : "Nothing has been published for these groups yet."}</p>
      ) : (
        <div className="lmsm__list">
          {materials.map((m) => {
            const youtube = parseYouTube(m.link_url);
            const isEditing = editingId === m.id;
            return (
              <div key={m.id} className={`lmsm__row ${isEditing ? "lmsm__row--editing" : ""}`}>
                <div className="lmsm__row-head">
                  <div className="lmsm__row-main">
                    <strong>{m.title}</strong>
                    <span className="lmsm__meta">
                      {m.subject} · {programsCovered(m).join(", ")} · {m.year_of_study || "Both years"} · {when(m.created_at)}
                    </span>
                    {m.body && <p className="lmsm__row-body">{m.body}</p>}
                    <div className="lmsm__row-tags">
                      <span className="lmsm__tag">{categoryLabel(m.category)}</span>
                      {youtube && (
                        <span className="lmsm__tag lmsm__tag--yt">
                          <MonitorPlay size={11} /> {isPlaylist(youtube) ? "Playlist" : "Video"}
                        </span>
                      )}
                      {m.file_url && <span className="lmsm__tag">File</span>}
                      {m.link_url && !youtube && (
                        <a className="lmsm__tag" href={m.link_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={11} /> Link
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="lmsm__row-actions">
                    <button
                      className="lmsm__icon-btn"
                      onClick={() => (isEditing ? cancelEdit() : startEdit(m))}
                      title={isEditing ? "Cancel editing" : "Edit this material"}
                    >
                      {isEditing ? <X size={15} /> : <Pencil size={15} />}
                    </button>
                    <button className="lmsm__remove" onClick={() => remove(m)} title="Remove from students' LMS">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="lmsm__edit">
                    <div className="lmsm__field lmsm__field--wide">
                      <label>Title</label>
                      <input
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      />
                    </div>

                    <div className="lmsm__field">
                      <label>Kind</label>
                      <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                        {LMS_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>

                    <div className="lmsm__field">
                      <label>Class</label>
                      <select value={editForm.year_of_study} onChange={(e) => setEditForm({ ...editForm, year_of_study: e.target.value })}>
                        {YEAR_OPTIONS.map((y) => <option key={y}>{y}</option>)}
                      </select>
                    </div>

                    <div className="lmsm__field lmsm__field--wide">
                      <label>Write something</label>
                      <textarea
                        rows={4}
                        value={editForm.body}
                        onChange={(e) => setEditForm({ ...editForm, body: e.target.value })}
                      />
                    </div>

                    <div className="lmsm__field lmsm__field--wide">
                      <label>Link</label>
                      <input
                        value={editForm.link_url}
                        onChange={(e) => setEditForm({ ...editForm, link_url: e.target.value })}
                        placeholder="https://www.youtube.com/watch?v=... or any website"
                      />
                      <LinkPreview url={editForm.link_url} />
                    </div>

                    <div className="lmsm__field lmsm__field--wide">
                      <label>File</label>
                      {m.file_url && !editFile && !editDropFile && (
                        <p className="lmsm__hint">
                          Current: {m.file_name || "the file on it now"}
                          <button type="button" className="lmsm__clear" onClick={() => setEditDropFile(true)}>Remove it</button>
                        </p>
                      )}
                      {editDropFile && (
                        <p className="lmsm__hint">
                          The file will be taken off when you save.
                          <button type="button" className="lmsm__clear" onClick={() => setEditDropFile(false)}>Keep it</button>
                        </p>
                      )}
                      <label className="lmsm__file">
                        <Upload size={15} />
                        {editFile ? editFile.name : m.file_url ? "Choose a different file" : "Attach a file"}
                        <input
                          type="file"
                          hidden
                          onChange={(e) => { setEditFile(e.target.files?.[0] || null); setEditDropFile(false); }}
                        />
                      </label>
                      {editFile && (
                        <button type="button" className="lmsm__clear" onClick={() => setEditFile(null)}>
                          Keep the existing file instead
                        </button>
                      )}
                    </div>

                    <p className="lmsm__hint lmsm__field--wide">
                      Subject and groups are fixed here — they decide which students this reaches. To send it to
                      different groups, remove it and publish again.
                    </p>

                    {editError && <p className="lmsm__error">{editError}</p>}

                    <div className="lmsm__actions">
                      <button className="lmsm__btn lmsm__btn--primary" onClick={() => saveEdit(m)} disabled={editSaving}>
                        {editSaving ? "Saving..." : "Save Changes"}
                      </button>
                      <button className="lmsm__btn" onClick={cancelEdit}>Cancel</button>
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

/** Tells her, before she publishes, how the link will behave for a student. */
function LinkPreview({ url }) {
  if (!url?.trim()) return null;
  const youtube = parseYouTube(url);
  if (!youtube) {
    return <span className="lmsm__hint">Students will get an "Open link" button.</span>;
  }
  return (
    <span className="lmsm__hint lmsm__hint--yt">
      <MonitorPlay size={12} /> YouTube {isPlaylist(youtube) ? "playlist" : "video"} recognised — students can
      play it inside the portal or open it on YouTube.
    </span>
  );
}
