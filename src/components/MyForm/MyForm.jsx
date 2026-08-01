import { useState, useEffect } from "react";
import { FileText, Lock, Send, Save, Clock, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  STUDENT_EDITABLE, STUDENT_READONLY, EDIT_WINDOW_HOURS,
  editableValuesFrom, editableRowFrom,
  fetchLatestRequest, windowIsOpen, submitRequest,
} from "../../lib/profileEdit";
import "./MyForm.css";

const shown = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "Yes";
  if (v === false) return "No";
  return String(v);
};

const deadlineText = (iso) =>
  new Date(iso).toLocaleString("en-PK", {
    day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
  });

export default function MyForm({ student }) {
  // Her row is re-read here rather than trusted from login state, which was
  // captured when she signed in and goes stale the moment anything changes.
  const [record, setRecord] = useState(student || null);
  const [request, setRequest] = useState(null);
  const [values, setValues] = useState(() => editableValuesFrom(student));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const load = async () => {
    if (!student?.id) { setLoading(false); return; }
    setLoading(true);
    const [{ data: fresh }, latest] = await Promise.all([
      supabase.from("students").select("*").eq("id", student.id).maybeSingle(),
      fetchLatestRequest(student.id),
    ]);
    if (fresh) {
      setRecord(fresh);
      setValues(editableValuesFrom(fresh));
    }
    setRequest(latest);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [student?.id]);

  const canEdit = windowIsOpen(request);

  const ask = async () => {
    setError("");
    if (reason.trim().length < 10) {
      setError("Please write what you need to correct, so the admin knows what to approve.");
      return;
    }
    setSaving(true);
    const message = await submitRequest(student.id, reason);
    setSaving(false);
    if (message) { setError(message); return; }
    setReason("");
    setAsking(false);
    await load();
  };

  const save = async () => {
    setError("");
    setSaving(true);
    const { data, error: dbError } = await supabase
      .from("students")
      .update(editableRowFrom(values))
      .eq("id", record.id)
      .select("id");
    setSaving(false);

    if (dbError) { setError(dbError.message); return; }
    // Zero rows and no error means the approval window closed while she was
    // typing — the database refuses silently, so it has to be checked.
    if (!data || data.length === 0) {
      setError("Your editing permission has expired. Please request approval again.");
      await load();
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
    await load();
  };

  if (loading) return <p className="myform__empty">Loading your form...</p>;
  if (!record) return <p className="myform__empty">Your record could not be loaded.</p>;

  return (
    <div className="myform">
      <div className="myform__head">
        <h2><FileText size={20} /> My Admission Form</h2>
        <p>Everything the college has on record for you.</p>
      </div>

      {/* ---- Where the request stands ---- */}
      <StatusBanner
        request={request}
        canEdit={canEdit}
        onAsk={() => { setAsking(true); setError(""); }}
      />

      {asking && (
        <div className="myform__ask">
          <label htmlFor="myform-reason">What needs correcting, and why?</label>
          <textarea
            id="myform-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. My WhatsApp number has changed, and my father's occupation is written wrong."
          />
          <div className="myform__ask-actions">
            <button onClick={ask} disabled={saving} className="myform__btn myform__btn--primary">
              <Send size={14} /> {saving ? "Sending..." : "Send to Admin"}
            </button>
            <button onClick={() => { setAsking(false); setError(""); }} className="myform__btn">Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="myform__error">{error}</p>}
      {saved && <p className="myform__saved"><CheckCircle size={14} /> Your form has been updated.</p>}

      {/* ---- Locked half ---- */}
      <section className="myform__section">
        <h3><Lock size={14} /> Enrolment &amp; Academic Record</h3>
        <p className="myform__section-note">
          These can only be changed by the college office — contact them if anything here is wrong.
        </p>
        <div className="myform__grid">
          {STUDENT_READONLY.map((f) => (
            <div key={f.key} className="myform__field">
              <span className="myform__label">{f.label}</span>
              <span className="myform__value">{shown(record[f.key])}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- The half she may correct ---- */}
      {STUDENT_EDITABLE.map((group) => (
        <section key={group.title} className="myform__section">
          <h3>{group.title}</h3>
          <div className="myform__grid">
            {group.fields.map((f) => (
              <div key={f.key} className={"myform__field " + (f.wide ? "myform__field--wide" : "")}>
                <span className="myform__label">{f.label}</span>
                {canEdit ? (
                  <FieldInput field={f} value={values[f.key]}
                    onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
                ) : (
                  <span className="myform__value">{shown(record[f.key])}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {canEdit && (
        <div className="myform__save-bar">
          <button onClick={save} disabled={saving} className="myform__btn myform__btn--primary">
            <Save size={14} /> {saving ? "Saving..." : "Save Changes"}
          </button>
          <span className="myform__save-note">
            You can save as many times as you need until {deadlineText(request.approved_until)}.
          </span>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ request, canEdit, onAsk }) {
  if (canEdit) {
    return (
      <div className="myform__banner myform__banner--open">
        <CheckCircle size={18} />
        <div>
          <strong>Editing approved.</strong>
          <span> Correct the fields below and press Save. Your permission lasts until {deadlineText(request.approved_until)}.</span>
        </div>
      </div>
    );
  }

  if (request?.status === "Pending") {
    return (
      <div className="myform__banner myform__banner--waiting">
        <Clock size={18} />
        <div>
          <strong>Your request is with the admin.</strong>
          <span> You will be able to edit as soon as it is approved. What you asked for: “{request.reason}”</span>
        </div>
      </div>
    );
  }

  const expired = request?.status === "Approved" && !canEdit;

  return (
    <div className="myform__banner myform__banner--closed">
      <div className="myform__banner-main">
        {request?.status === "Rejected" ? <XCircle size={18} /> : <Lock size={18} />}
        <div>
          {request?.status === "Rejected" ? (
            <>
              <strong>Your last request was not approved.</strong>
              {request.admin_note && <span> Admin’s note: “{request.admin_note}”</span>}
            </>
          ) : expired ? (
            <>
              <strong>Your editing permission has expired.</strong>
              <span> Request approval again if something still needs correcting.</span>
            </>
          ) : (
            <>
              <strong>This form is read-only.</strong>
              <span> To correct anything, ask the admin for permission — approval opens editing for {EDIT_WINDOW_HOURS} hours.</span>
            </>
          )}
        </div>
      </div>
      <button onClick={onAsk} className="myform__btn myform__btn--primary">
        <Send size={14} /> Request Permission to Edit
      </button>
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  if (field.type === "boolean") {
    return (
      <select className="myform__input" value={value === true ? "yes" : "no"}
        onChange={(e) => onChange(e.target.value === "yes")}>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea className="myform__input" rows={2} value={value ?? ""}
        onChange={(e) => onChange(e.target.value)} />
    );
  }
  return (
    <input
      className="myform__input"
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      placeholder={field.placeholder || ""}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
