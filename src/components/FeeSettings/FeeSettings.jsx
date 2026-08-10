import { useState, useEffect } from "react";
import { Save, Plus, Trash2, AlertTriangle, Check, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/academics";
import {
  fetchFeePlans, findPlan, saveFeePlan, computedTotal, totalMonths,
  missingFeeRows, MONTH_NAMES, YEARS,
} from "../../lib/feePlans";
import "./FeeSettings.css";

const rs = (n) => "Rs " + Number(n || 0).toLocaleString();

export default function FeeSettings() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [year, setYear] = useState(YEARS[0]);
  const [program, setProgram] = useState(PROGRAMS[0]);

  const load = async () => {
    try {
      setPlans(await fetchFeePlans());
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const stored = findPlan(plans, year, program);

  return (
    <div className="fee-set">
      <div className="fee-set__toolbar">
        <div className="fee-set__field">
          <label>Class</label>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="fee-set__field">
          <label>Group</label>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {loadError && <p className="fee-set__error">{loadError}</p>}

      {loading ? (
        <p className="fee-set__empty">Loading fee plans...</p>
      ) : !stored ? (
        <p className="fee-set__empty">
          No fee plan saved for {year} {program} yet. Run <strong>supabase_fee_plans.sql</strong> to create the
          default plans, then reload this page.
        </p>
      ) : (
        /* Keyed on the plan being edited, so switching year or group remounts the
           editor with fresh values — a half-typed edit is never carried across. */
        <PlanEditor key={stored.id} plan={stored} year={year} program={program} onSaved={load} />
      )}

      {!loading && plans.length > 0 && <BackfillPanel plans={plans} />}
    </div>
  );
}

/**
 * Fee plans only generate a schedule at enrolment, so every student enrolled
 * before the plans existed has just her admission fee and nothing under any
 * month. This finds them and creates the charges they are missing.
 */
function BackfillPanel({ plans }) {
  const [rows, setRows] = useState(null); // null = not scanned yet
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const scan = async () => {
    setScanning(true);
    setError("");
    setDone("");
    try {
      const [{ data: students }, { data: fees }] = await Promise.all([
        supabase.from("students").select("id, name, program, year_of_study").is("deleted_at", null).order("name"),
        supabase.from("fees").select("student_id, label"),
      ]);

      const found = (students || [])
        .map((student) => {
          const existingFees = (fees || []).filter((f) => f.student_id === student.id);
          const plan = findPlan(plans, student.year_of_study || "1st Year", student.program);
          const missing = missingFeeRows({ plan, student, existingFees });
          return { student, plan, missing, amount: missing.reduce((s, r) => s + r.amount_due, 0) };
        })
        .filter((r) => r.missing.length > 0);

      setRows(found);
    } catch (err) {
      setError(err.message);
    }
    setScanning(false);
  };

  const apply = async () => {
    const totalRows = rows.reduce((s, r) => s + r.missing.length, 0);
    const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
    if (!window.confirm(
      `Create ${totalRows} fee charges totalling Rs ${totalAmount.toLocaleString()} across ${rows.length} student${rows.length === 1 ? "" : "s"}?\n\n` +
      "Charges they already have are left alone, and an admission fee already on record is never added again."
    )) return;

    setApplying(true);
    setError("");
    const { error: dbError } = await supabase.from("fees").insert(rows.flatMap((r) => r.missing));
    setApplying(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }
    setDone(`Created ${totalRows} charges for ${rows.length} student${rows.length === 1 ? "" : "s"}.`);
    await scan();
  };

  return (
    <div className="fee-set__section">
      <div className="fee-set__section-head">
        <h3 className="fee-set__heading">Missing Fee Schedules</h3>
        <button onClick={scan} disabled={scanning} className="fee-set__add">
          <RefreshCw size={14} /> {scanning ? "Checking..." : "Check Students"}
        </button>
      </div>
      <p className="fee-set__hint">
        A student only gets her schedule when she is enrolled, so anyone enrolled before these plans
        existed has just an admission fee and shows nothing under any month. This creates what they are
        missing, without touching charges they already have.
      </p>

      {error && <p className="fee-set__error">{error}</p>}
      {done && <p className="fee-set__saved"><Check size={14} /> {done}</p>}

      {rows === null ? (
        <p className="fee-set__empty">Press “Check Students” to see who is missing charges.</p>
      ) : rows.length === 0 ? (
        <p className="fee-set__empty">Every student has her full schedule — nothing to create.</p>
      ) : (
        <>
          <div className="fee-set__rows">
            <div className="fee-set__row fee-set__row--head fee-set__row--backfill">
              <span>Student</span><span>Class</span><span>Group</span><span>Missing</span><span>Amount</span>
            </div>
            {rows.map((r) => (
              <div key={r.student.id} className="fee-set__row fee-set__row--backfill">
                <span className="fee-set__bf-name">{r.student.name}</span>
                <span>{r.student.year_of_study || "—"}</span>
                <span>{r.student.program}</span>
                <span>{r.missing.length} charge{r.missing.length === 1 ? "" : "s"}</span>
                <span className="fee-set__amount">Rs {r.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>

          <div className="fee-set__actions">
            <button onClick={apply} disabled={applying} className="fee-set__save">
              <Plus size={15} /> {applying ? "Creating..." : `Create ${rows.reduce((s, r) => s + r.missing.length, 0)} Charges`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PlanEditor({ plan, year, program, onSaved }) {
  const [draft, setDraft] = useState(() => ({
    ...plan,
    installments: (plan.installments || []).map((i) => ({ ...i })),
  }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const setField = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const setInstallment = (index, key, value) => {
    setDraft((d) => ({
      ...d,
      installments: d.installments.map((inst, i) => (i === index ? { ...inst, [key]: value } : inst)),
    }));
    setSaved(false);
  };

  const addInstallment = () => {
    setDraft((d) => ({
      ...d,
      installments: [...d.installments, { label: "New Installment", months: 1, due_month: null }],
    }));
    setSaved(false);
  };

  const removeInstallment = (index) => {
    setDraft((d) => ({ ...d, installments: d.installments.filter((_, i) => i !== index) }));
    setSaved(false);
  };

  const handleSave = async () => {
    setError("");
    if (Number(draft.admission_fee) < 0 || Number(draft.monthly_fee) < 0 || Number(draft.total_fee) < 0) {
      setError("Fees cannot be negative.");
      return;
    }
    setSaving(true);
    try {
      await saveFeePlan(draft);
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const derived = computedTotal(draft);
  const months = totalMonths(draft);
  const totalMismatch = Number(draft.total_fee) !== derived;

  return (
    <>
      <div className="fee-set__section">
        <h3 className="fee-set__heading">Amounts — {year} {program}</h3>
        <div className="fee-set__amounts">
          <div className="fee-set__field">
            <label>Admission Fee (one time)</label>
            <input type="number" min="0" value={draft.admission_fee}
              onChange={(e) => setField("admission_fee", e.target.value)} />
          </div>
          <div className="fee-set__field">
            <label>Monthly Fee</label>
            <input type="number" min="0" value={draft.monthly_fee}
              onChange={(e) => setField("monthly_fee", e.target.value)} />
          </div>
          <div className="fee-set__field">
            <label>Total Fee for the Year</label>
            <input type="number" min="0" value={draft.total_fee}
              onChange={(e) => setField("total_fee", e.target.value)} />
          </div>
        </div>

        <div className={"fee-set__derived " + (totalMismatch ? "fee-set__derived--warn" : "")}>
          {totalMismatch ? <AlertTriangle size={14} /> : <Check size={14} />}
          <span>
            The schedule below adds up to <strong>{rs(derived)}</strong>
            {" "}({rs(draft.admission_fee)} admission + {months} months × {rs(draft.monthly_fee)})
            {totalMismatch
              ? ` — but Total Fee says ${rs(draft.total_fee)}. Make them match unless the difference is deliberate.`
              : " — matches the Total Fee above."}
          </span>
        </div>
      </div>

      <div className="fee-set__section">
        <div className="fee-set__section-head">
          <h3 className="fee-set__heading">Payment Schedule</h3>
          <button onClick={addInstallment} className="fee-set__add"><Plus size={14} /> Add</button>
        </div>
        <p className="fee-set__hint">
          Each row becomes one charge when a student is enrolled. <strong>Months × monthly fee</strong> is what it
          costs. Set the month to <em>At Admission</em> for a charge due a week after enrolment.
        </p>

        {draft.installments.length === 0 ? (
          <p className="fee-set__empty">No instalments — only the admission fee will be charged.</p>
        ) : (
          <div className="fee-set__rows">
            <div className="fee-set__row fee-set__row--head">
              <span>Label</span><span>Months</span><span>Due</span><span>Amount</span><span />
            </div>
            {draft.installments.map((inst, i) => (
              <div key={i} className="fee-set__row">
                <input value={inst.label || ""} onChange={(e) => setInstallment(i, "label", e.target.value)} />
                <input type="number" min="1" value={inst.months}
                  onChange={(e) => setInstallment(i, "months", Number(e.target.value))} />
                <select
                  value={inst.due_month == null ? "" : String(inst.due_month)}
                  onChange={(e) => setInstallment(i, "due_month", e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">At Admission</option>
                  {MONTH_NAMES.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                </select>
                <span className="fee-set__amount">{rs((Number(inst.months) || 0) * Number(draft.monthly_fee || 0))}</span>
                <button onClick={() => removeInstallment(i)} className="fee-set__remove" title="Remove this charge">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="fee-set__error">{error}</p>}

      <div className="fee-set__actions">
        <button onClick={handleSave} disabled={saving} className="fee-set__save">
          <Save size={15} /> {saving ? "Saving..." : "Save Fee Plan"}
        </button>
        {saved && <span className="fee-set__saved"><Check size={14} /> Saved</span>}
      </div>

      <p className="fee-set__note">
        Changes apply to students enrolled from now on. Fees already created for existing students are not
        rewritten — adjust those from the Unpaid Fee tab if needed.
      </p>
    </>
  );
}
