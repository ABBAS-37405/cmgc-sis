import { useState } from "react";
import { X, Save, Pencil, Upload, Eye, FileText } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, combinationsFor, formatCombination, groupHasChoice } from "../../lib/academics";
import {
  DETAIL_GROUPS, DOCUMENT_FIELDS, detailsFrom, detailsToRow, matricPercentage,
} from "../../lib/studentFields";
import { findBFormClash, describeUniqueViolation, normalizeBForm } from "../../lib/bform";
import { prepareUpload } from "../../lib/uploads";
import "./StudentDetail.css";

const YEARS = ["1st Year", "2nd Year"];

const show = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
};

/**
 * One student's full record: read-only by default, editable on demand.
 *
 * The fields come from studentFields.js rather than being written out here, so
 * the same list drives this screen and the admin's "Further Entry" form.
 */
export default function StudentDetail({ student, allowedPrograms = [], onClose, onSaved, startInEdit = false }) {
  const visiblePrograms = allowedPrograms.length > 0
    ? PROGRAMS.filter((p) => allowedPrograms.includes(p))
    : PROGRAMS;

  const [editing, setEditing] = useState(startInEdit);
  const [core, setCore] = useState({
    name: student.name || "",
    father_name: student.father_name || "",
    cnic: student.cnic || "",
    program: student.program || visiblePrograms[0] || PROGRAMS[0],
    year_of_study: student.year_of_study || "1st Year",
    phone: student.phone || "",
    roll_no: student.roll_no || "",
    password: student.password || "",
    subject_combination: student.subject_combination || "",
  });
  const [details, setDetails] = useState(() => detailsFrom(student));
  const [docs, setDocs] = useState(() => {
    const d = {};
    DOCUMENT_FIELDS.forEach((f) => { d[f.key] = student[f.key] || null; });
    return d;
  });

  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [error, setError] = useState("");

  const setDetail = (key, value) => {
    setDetails((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "matric_marks_obtained" || key === "matric_total_marks") {
        next.matric_percentage = matricPercentage(
          key === "matric_marks_obtained" ? value : next.matric_marks_obtained,
          key === "matric_total_marks" ? value : next.matric_total_marks
        );
      }
      return next;
    });
  };

  const uploadDoc = async (field, file) => {
    if (!file) return;
    setUploadingKey(field.key);
    setError("");

    // A scan is shrunk before it goes up; a PDF is only measured. The size cap
    // lives in lib/uploads.js so every screen that uploads agrees on it.
    const ready = await prepareUpload(file, "document");
    if (ready.error) {
      setUploadingKey(null);
      setError(`${field.label}: ${ready.error}`);
      return;
    }

    const safe = ready.file.name.replace(/[^\w.-]/g, "_");
    // Runs on upload, never during render — Date.now() only keeps the path unique.
    // eslint-disable-next-line react-hooks/purity
    const path = `students/${student.id}/${field.key}-${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("admission-documents").upload(path, ready.file);
    if (upErr) {
      setUploadingKey(null);
      setError(`Upload failed: ${upErr.message}`);
      return;
    }
    const url = supabase.storage.from("admission-documents").getPublicUrl(path).data.publicUrl;
    setDocs((prev) => ({ ...prev, [field.key]: url }));
    setUploadingKey(null);
  };

  const save = async () => {
    setError("");
    if (!core.name.trim()) return setError("Student name is required.");
    if (!core.roll_no.trim()) return setError("Roll number is required.");
    if (core.password && core.password.length < 6) return setError("Password must be at least 6 characters.");

    setSaving(true);
    if (core.cnic.trim()) {
      const normalizedNewCnic = normalizeBForm(core.cnic);
      const normalizedOldCnic = normalizeBForm(student.cnic);

      // Skip the clash check when the B-Form has not changed; the student may
      // already have an approved application recording the same number.
      if (normalizedNewCnic !== normalizedOldCnic) {
        const clash = await findBFormClash(core.cnic, { ignoreStudentId: student.id });
        if (clash) {
          setSaving(false);
          return setError(clash);
        }
      }
    }

    // .select() is not decoration. An update the row-level security policies
    // refuse comes back as a plain success with zero rows — no error at all —
    // so this modal used to close and report "saved" while the database had
    // ignored the whole thing. That is how an edited roll number could appear
    // to change and still leave the student unable to log in with it.
    const { data: updated, error: dbError } = await supabase
      .from("students")
      .update({
        name: core.name.trim(),
        father_name: core.father_name.trim() || null,
        cnic: core.cnic.trim() || null,
        program: core.program,
        year_of_study: core.year_of_study,
        phone: core.phone.trim() || null,
        roll_no: core.roll_no.trim(),
        password: core.password,
        subject_combination: core.subject_combination.trim() || null,
        ...detailsToRow(details),
        ...docs,
      })
      .eq("id", student.id)
      .select("id, roll_no");
    setSaving(false);

    if (dbError) {
      // Either the roll number or the B-Form can trip a unique index here.
      setError(dbError.code === "23505" ? describeUniqueViolation(dbError) : dbError.message);
      return;
    }
    if (!updated || updated.length === 0) {
      setError(
        "Nothing was saved — the database refused this change. Your admin session has most likely expired: " +
        "sign out, sign in again, and retry. (If you are a sub-admin, you can only edit students in the programs assigned to you.)"
      );
      return;
    }
    setEditing(false);
    if (onSaved) onSaved();
  };

  // The combinations this group actually offers. Humanities has three and FA-IT
  // two, so the group name does not settle which subjects she sits — and typing
  // that line by hand is what produced the wrong entries this screen exists to
  // correct. Offering the list is the only way an admin can pick the right one.
  const comboOptions = combinationsFor(core.program).map(formatCombination);
  const comboOnRecord = (core.subject_combination || "").trim();

  // A value the group does not offer is kept as an option rather than dropped.
  // Dropping it would blank the field the moment the modal opened and quietly
  // take the record with it on the next save; it is shown, marked, and left for
  // the admin to replace.
  const comboUnlisted = Boolean(comboOnRecord) && !comboOptions.includes(comboOnRecord);
  const comboChoices = [
    ...comboOptions.map((c) => ({ value: c, label: c })),
    ...(comboUnlisted ? [{ value: comboOnRecord, label: `${comboOnRecord} (on record — not offered by ${core.program})` }] : []),
  ];

  const comboHint = comboUnlisted
    ? `This is not one of ${core.program}'s combinations. Pick the right one to correct it.`
    : groupHasChoice(core.program)
      ? `${core.program} offers ${comboOptions.length} combinations — pick the one she actually studies. It decides whose class-test and marks sheets she appears on.`
      : comboOptions.length === 1
        ? `${core.program} has one combination, so every girl in the group studies these.`
        : undefined;

  // Changing the group changes what the combination may be. A group with a
  // single combination settles it, so it is filled in; a group with a choice
  // cannot be guessed, so anything the new group does not offer is cleared and
  // the admin picks. Nothing is left pointing at another group's electives.
  const changeProgram = (program) => {
    const options = combinationsFor(program).map(formatCombination);
    const current = (core.subject_combination || "").trim();
    const next = options.length === 1
      ? options[0]
      : options.includes(current) ? current : "";
    setCore({ ...core, program, subject_combination: next });
  };

  return (
    <div className="sd-overlay" onClick={onClose}>
      <div className="sd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sd-head">
          <div>
            <h3>{student.name}</h3>
            <p>{student.roll_no} · {student.program} · {student.year_of_study || "1st Year"}</p>
          </div>
          <div className="sd-head-actions">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="sd-edit-btn"><Pencil size={14} /> Edit</button>
            ) : (
              <button onClick={() => setEditing(false)} className="sd-cancel-btn">Cancel edit</button>
            )}
            <button onClick={onClose} className="sd-close"><X size={18} /></button>
          </div>
        </div>

        <div className="sd-body">
          {error && <p className="sd-error">{error}</p>}

          {/* ---- Core ---- */}
          <section className="sd-section">
            <h4>Enrolment</h4>
            <div className="sd-grid">
              <Field label="Roll Number" editing={editing} value={core.roll_no}
                hint="This is her login ID for the student portal — change it and she must sign in with the new one."
                onChange={(v) => setCore({ ...core, roll_no: v })} />
              <Field label="Student Name" editing={editing} value={core.name}
                onChange={(v) => setCore({ ...core, name: v })} />
              <Field label="Father's Name" editing={editing} value={core.father_name}
                onChange={(v) => setCore({ ...core, father_name: v })} />
              <Field label="B-Form No." editing={editing} value={core.cnic}
                onChange={(v) => setCore({ ...core, cnic: v })} />
              <Field label="Program" editing={editing} value={core.program} type="select" options={visiblePrograms}
                onChange={changeProgram} />
              <Field label="Class" editing={editing} value={core.year_of_study} type="select" options={YEARS}
                onChange={(v) => setCore({ ...core, year_of_study: v })} />
              <Field label="Phone" editing={editing} value={core.phone}
                onChange={(v) => setCore({ ...core, phone: v })} />
              <Field label="Login Password" editing={editing} value={core.password}
                hint="Stored as typed — this is what she enters on the portal."
                onChange={(v) => setCore({ ...core, password: v })} />
              <Field
                label="Subject Combination" wide type="select"
                editing={editing} value={core.subject_combination}
                options={comboChoices}
                emptyLabel="— Not recorded —"
                hint={comboHint}
                onChange={(v) => setCore({ ...core, subject_combination: v })}
              />
            </div>
          </section>

          {/* ---- Everything from studentFields.js ---- */}
          {DETAIL_GROUPS.map((group) => (
            <section key={group.title} className="sd-section">
              <h4>{group.title}</h4>
              <div className="sd-grid">
                {group.fields.map((f) => (
                  <Field
                    key={f.key}
                    label={f.label}
                    editing={editing && !f.readOnly}
                    value={details[f.key]}
                    type={f.type}
                    options={f.options}
                    placeholder={f.placeholder}
                    hint={f.hint}
                    wide={f.wide}
                    onChange={(v) => setDetail(f.key, v)}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* ---- Documents ---- */}
          <section className="sd-section">
            <h4>Documents</h4>
            <p className="sd-hint">
              Optional. Upload later at any time, or upload again to replace what is on record.
            </p>
            <div className="sd-docs">
              {DOCUMENT_FIELDS.map((f) => (
                <div key={f.key} className="sd-doc">
                  <span className="sd-doc-label">{f.label}</span>
                  {docs[f.key] ? (
                    <a href={docs[f.key]} target="_blank" rel="noopener noreferrer" className="sd-doc-view">
                      <Eye size={13} /> View
                    </a>
                  ) : (
                    <span className="sd-doc-missing"><FileText size={13} /> Not uploaded</span>
                  )}
                  {editing && (
                    <label className="sd-doc-upload">
                      <Upload size={12} />
                      {uploadingKey === f.key ? "Uploading…" : docs[f.key] ? "Replace" : "Upload"}
                      <input
                        type="file"
                        hidden
                        disabled={uploadingKey === f.key}
                        onChange={(e) => { uploadDoc(f, e.target.files[0]); e.target.value = ""; }}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        {editing && (
          <div className="sd-footer">
            <button onClick={save} disabled={saving} className="sd-save">
              <Save size={15} /> {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One label + value, rendered as text or as an input depending on `editing`. */
function Field({ label, value, editing, onChange, type = "text", options, placeholder, hint, wide, emptyLabel = "— Select —" }) {
  return (
    <div className={"sd-field " + (wide ? "sd-field--wide" : "")}>
      <label>{label}</label>
      {!editing ? (
        <p className="sd-value">{show(value)}</p>
      ) : type === "select" ? (
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{emptyLabel}</option>
          {/* An option may be a plain string or { value, label } — the second form
              is what lets a combination be shown under a label that says it is
              not one this group offers, without changing what gets saved. */}
          {(options || []).map((o) => (
            typeof o === "string"
              ? <option key={o}>{o}</option>
              : <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : type === "boolean" ? (
        <label className="sd-check">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          Yes
        </label>
      ) : type === "textarea" ? (
        <textarea rows={2} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <span className="sd-field-hint">{hint}</span>}
    </div>
  );
}
