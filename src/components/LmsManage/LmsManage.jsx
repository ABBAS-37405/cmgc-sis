import { useState, useEffect } from "react";
import { Upload, Trash2, Plus, X, ExternalLink, MonitorPlay } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/academics";
import { teacherPrograms, teacherSubjectsFor } from "../../lib/teacherAuth";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import {
  LMS_BUCKET, LMS_CATEGORIES, YEAR_OPTIONS, categoryLabel,
  fetchMaterialsForStaff, removeMaterial, programsCovered, parseYouTube, isPlaylist,
} from "../../lib/lms";
import { prepareUpload } from "../../lib/uploads";
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

  const [selectedPrograms, setSelectedPrograms] = useState(() => visiblePrograms.slice(0, 1));
  const [subject, setSubject] = useState("");
  const [form, setForm] = useState(blankForm);
  const [file, setFile] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Only the subjects she teaches that the chosen groups actually offer.
  const subjectOptions = teacherSubjectsFor(teacher, selectedPrograms);
  // A stable string, so the effect below has a dependency lint can check.
  const programKey = selectedPrograms.join("|");

  const load = async () => {
    setLoading(true);
    setMaterials(await fetchMaterialsForStaff({
      programs: visiblePrograms,
      subjects: teacherSubjectsFor(teacher, visiblePrograms),
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
        return setError(
          `File upload failed: ${upErr.message}. ` +
          `Check that a public bucket named "${LMS_BUCKET}" exists in Supabase.`
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

  return (
    <div className="lmsm">
      <div className="lmsm__head">
        <div>
          <h3>Course Material</h3>
          <p>{teacher
            ? "Whatever you publish here appears in the LMS tab of every student in the chosen groups."
            : "Everything published for these groups, by you or by any teacher. Adding here works exactly as it does for a teacher."}</p>
        </div>
        <button className="lmsm__btn lmsm__btn--primary" onClick={() => { setShowForm(!showForm); setError(""); }}>
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
            return (
              <div key={m.id} className="lmsm__row">
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
                <button className="lmsm__remove" onClick={() => remove(m)} title="Remove from students' LMS">
                  <Trash2 size={15} />
                </button>
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
