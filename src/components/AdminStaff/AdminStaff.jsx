import { useState, useMemo } from "react";
import { Plus, Trash2, Save, X, Phone, Briefcase, UserMinus, Undo2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import { STAFF_DEPARTMENTS, STAFF_DESIGNATIONS, departmentFor } from "../../lib/staff";
import { EMPLOYMENT_TYPES, employmentTypeOf, employmentTypeSlug, isPerDayType, formatMoney } from "../../lib/payroll";
import "./AdminStaff.css";

const emptyForm = {
  name: "",
  father_name: "",
  cnic: "",
  designation: "",
  department: "",
  phone: "",
  whatsapp: "",
  address: "",
  emergency_contact: "",
  employment_type: "Regular",
  monthly_salary: "",
  per_day_salary: "",
  joining_date: "",
  is_active: true,
  notes: "",
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

// Today as "YYYY-MM-DD" in local time — toISOString would slip a day near midnight.
const todayISO = () => new Date().toLocaleDateString("en-CA");

/**
 * The non-teaching register: accounts, office, security, maintenance, transport.
 *
 * Nobody here has a login, so unlike the Teachers tab there is no server round
 * trip and no Supabase Auth — these are plain inserts and updates gated by the
 * `staff` RLS policies. `onChanged` tells the parent to refetch, because the
 * payroll screen next door is built from the same list.
 */
export default function AdminStaff({ staff = [], loading = false, onChanged }) {
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [department, setDepartment] = useState("All");

  // Regular and Fix Pay are both the monthly shape; only Visiting is per day.
  const isVisiting = isPerDayType(form.employment_type);

  // Null `left_date` is the active register; a date is those who have gone.
  const activeStaff = useMemo(() => staff.filter((s) => !s.left_date), [staff]);
  const leftStaff = useMemo(() => staff.filter((s) => s.left_date), [staff]);

  const departments = useMemo(() => {
    const used = new Set(activeStaff.map((s) => s.department).filter(Boolean));
    return ["All", ...STAFF_DEPARTMENTS.filter((d) => used.has(d))];
  }, [activeStaff]);

  const visible = useMemo(
    () => (department === "All" ? activeStaff : activeStaff.filter((s) => s.department === department)),
    [activeStaff, department]
  );

  const resetForm = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
  };

  const startEdit = (s) => {
    setEditing(s);
    setError("");
    setForm({
      name: s.name || "",
      father_name: s.father_name || "",
      cnic: s.cnic || "",
      designation: s.designation || "",
      department: s.department || "",
      phone: s.phone || "",
      whatsapp: s.whatsapp || "",
      address: s.address || "",
      emergency_contact: s.emergency_contact || "",
      employment_type: employmentTypeOf(s),
      monthly_salary: s.monthly_salary != null ? String(s.monthly_salary) : "",
      per_day_salary: s.per_day_salary != null ? String(s.per_day_salary) : "",
      joining_date: s.joining_date || "",
      is_active: s.is_active !== false,
      notes: s.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Picking a suggested title fills the department in, but never overwrites one
  // the admin typed for a title of their own.
  const onDesignationChange = (value) => {
    const suggested = departmentFor(value);
    setForm((f) => ({ ...f, designation: value, department: suggested || f.department }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Name is required.");
    if (!form.designation.trim()) return setError("Designation is required (e.g. Accountant, Security Guard, Peon).");

    // Same rule as the teacher form: without a rate the salary screen has nothing
    // to work from, and Rs 0 sitting silently on the sheet is worse than a block.
    const rate = Number(isVisiting ? form.per_day_salary : form.monthly_salary);
    if (!Number.isFinite(rate) || rate <= 0) {
      return setError(
        isVisiting
          ? "Enter the per-day salary for a Visiting employee."
          : `Enter the monthly salary for a ${form.employment_type} employee.`
      );
    }

    const payload = {
      name: form.name.trim(),
      father_name: form.father_name.trim() || null,
      cnic: form.cnic.trim() || null,
      designation: form.designation.trim(),
      department: form.department || null,
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      address: form.address.trim() || null,
      emergency_contact: form.emergency_contact.trim() || null,
      employment_type: form.employment_type,
      // Only the rate that belongs to the chosen type is kept — leaving the other
      // populated reads as if they are on two pay shapes at once.
      monthly_salary: isVisiting ? null : rate,
      per_day_salary: isVisiting ? rate : null,
      joining_date: form.joining_date || null,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    try {
      const query = editing
        ? supabase.from("staff").update(payload).eq("id", editing.id)
        : supabase.from("staff").insert(payload);

      const { data, error: dbError } = await query.select("id");
      if (dbError) throw new Error(dbError.message);
      // A refused update comes back as success with zero rows, never as an error.
      if (!data || data.length === 0) throw new Error(WRITE_BLOCKED_HINT);

      resetForm();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Off the active register and the payroll sheet, but nothing is deleted: the
  // record, attendance and salary history all stay where they are.
  const handleMarkLeft = async (s) => {
    if (!window.confirm(
      `Mark ${s.name} (${s.designation}) as left? They move to the Left Staff list and ` +
      `come off the attendance and salary register.\n\n` +
      `Nothing is deleted — their record and history stay, and Rejoin brings them back.`
    )) return;
    const { data, error: dbError } = await supabase
      .from("staff")
      .update({ left_date: todayISO(), is_active: false })
      .eq("id", s.id)
      .select("id");
    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);
    if (editing?.id === s.id) resetForm();
    if (onChanged) await onChanged();
  };

  const handleRejoin = async (s) => {
    const { data, error: dbError } = await supabase
      .from("staff")
      .update({ left_date: null, is_active: true })
      .eq("id", s.id)
      .select("id");
    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);
    if (onChanged) await onChanged();
  };

  const handleDelete = async (s) => {
    if (!window.confirm(
      `Remove ${s.name} (${s.designation})? Their attendance and salary records go with them.\n\n` +
      `To keep the history instead, edit them and untick "Currently employed".`
    )) return;

    const { data, error: dbError } = await supabase.from("staff").delete().eq("id", s.id).select("id");
    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);

    if (editing?.id === s.id) resetForm();
    if (onChanged) await onChanged();
  };

  return (
    <>
      <div className="staff__section">
        <h3 className="staff__heading">{editing ? `Edit ${editing.name}` : "Add Non-Teaching Staff"}</h3>
        <p className="staff__intro">
          Accounts, office, security, maintenance and transport — guards, peons, drivers and
          sweepers all belong here, not on the Teachers list. They have no portal login; this
          register exists so their attendance and salary run through the same sheet.
        </p>

        <form onSubmit={handleSubmit} className="staff__form">
          <div className="staff__form-row">
            <div className="staff__field">
              <label>Full Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Muhammad Aslam" />
            </div>
            <div className="staff__field">
              <label>Father / Husband Name</label>
              <input value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} />
            </div>
            <div className="staff__field">
              <label>CNIC</label>
              <input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} placeholder="35202-1234567-1" />
            </div>
          </div>

          <div className="staff__form-row">
            <div className="staff__field">
              <label>Designation *</label>
              {/* A datalist, not a select: every college invents a job title sooner
                  or later, and a fixed list would be the first thing to need a change. */}
              <input
                list="staff-designations"
                value={form.designation}
                onChange={(e) => onDesignationChange(e.target.value)}
                placeholder="e.g. Security Guard"
              />
              <datalist id="staff-designations">
                {STAFF_DESIGNATIONS.map((d) => <option key={d.title} value={d.title} />)}
              </datalist>
            </div>
            <div className="staff__field">
              <label>Department</label>
              <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">— Select —</option>
                {STAFF_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="staff__field">
              <label>Joining Date</label>
              <input type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
            </div>
          </div>

          <div className="staff__form-row">
            <div className="staff__field">
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XXXXXXXXX" />
            </div>
            <div className="staff__field">
              <label>WhatsApp (for salary slips)</label>
              <input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="Leave blank to use the phone"
              />
            </div>
            <div className="staff__field">
              <label>Emergency Contact</label>
              <input value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} placeholder="Name and number" />
            </div>
          </div>

          <div className="staff__form-row">
            <div className="staff__field">
              <label>Employment Status *</label>
              <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {isVisiting ? (
              <div className="staff__field">
                <label>Per Day Salary (Rs) *</label>
                <input
                  type="number" min="0" step="any"
                  value={form.per_day_salary}
                  onChange={(e) => setForm({ ...form, per_day_salary: e.target.value })}
                  placeholder="e.g. 900"
                />
              </div>
            ) : (
              <div className="staff__field">
                <label>Monthly Salary (Rs) *</label>
                <input
                  type="number" min="0" step="any"
                  value={form.monthly_salary}
                  onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
                  placeholder="e.g. 25000"
                />
              </div>
            )}
            <div className="staff__field">
              <label>Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>

          <div className="staff__field">
            <label>Notes</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything worth recording — duty timings, shift, agreement" />
          </div>

          <p className="staff__hint">
            {isVisiting
              ? "Visiting / daily wage: paid for the days actually worked. Holidays and absences are simply unpaid, so nothing is deducted."
              : "Regular / Fix Pay: full monthly salary. The first leave or absence each month is free; after that one day's pay (salary ÷ that month's working days) is deducted per day. Holidays never deduct. Fix Pay is priced exactly like Regular — it records the contract, not a different salary rule."}
          </p>

          <label className="staff__toggle">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Currently employed
          </label>

          {error && <p className="staff__error">{error}</p>}

          <div className="staff__form-actions">
            <button type="submit" disabled={saving} className="staff__submit">
              {editing ? <Save size={15} /> : <Plus size={15} />}
              {saving ? "Saving..." : editing ? "Save Changes" : "Add Staff Member"}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="staff__cancel">
                <X size={14} /> Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="staff__section">
        <div className="staff__list-head">
          <h3 className="staff__heading">Non-Teaching Staff ({visible.length})</h3>
          {departments.length > 2 && (
            <div className="staff__filters" role="group" aria-label="Filter by department">
              {departments.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepartment(d)}
                  className={`staff__filter ${department === d ? "staff__filter--active" : ""}`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <p className="staff__empty">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="staff__empty">
            {activeStaff.length === 0
              ? "No non-teaching staff added yet."
              : `Nobody in ${department} yet.`}
          </p>
        ) : (
          <div className="staff__list">
            {visible.map((s) => (
              <div key={s.id} className="staff__card">
                <div className="staff__card-info">
                  <p className="staff__name">
                    {s.name}
                    <span className="staff__tag staff__tag--role">
                      <Briefcase size={11} /> {s.designation}
                    </span>
                    <span className={`staff__tag staff__tag--${employmentTypeSlug(employmentTypeOf(s))}`}>
                      {employmentTypeOf(s)}
                    </span>
                    <span className="staff__tag">
                      {isPerDayType(employmentTypeOf(s))
                        ? `${formatMoney(s.per_day_salary)} / day`
                        : `${formatMoney(s.monthly_salary)} / month`}
                    </span>
                    {s.is_active === false && <span className="staff__tag staff__tag--off">No longer employed</span>}
                  </p>
                  <p className="staff__meta">
                    {s.department || "No department"}
                    {s.father_name ? ` · s/o ${s.father_name}` : ""}
                    {s.cnic ? ` · ${s.cnic}` : ""}
                    {s.joining_date ? ` · joined ${fmtDate(s.joining_date)}` : ""}
                  </p>
                  {(s.phone || s.whatsapp || s.emergency_contact) && (
                    <p className="staff__meta">
                      <Phone size={11} className="staff__meta-icon" />
                      {s.phone || "—"}
                      {s.whatsapp && s.whatsapp !== s.phone ? ` · WhatsApp ${s.whatsapp}` : ""}
                      {s.emergency_contact ? ` · emergency: ${s.emergency_contact}` : ""}
                    </p>
                  )}
                  {s.notes && <p className="staff__meta staff__meta--note">📝 {s.notes}</p>}
                </div>
                <div className="staff__card-actions">
                  <button type="button" onClick={() => startEdit(s)} className="staff__edit-btn">Edit</button>
                  <button
                    type="button"
                    onClick={() => handleMarkLeft(s)}
                    className="staff__left-btn"
                    title={`Move ${s.name} to the Left Staff list`}
                  >
                    <UserMinus size={13} /> Left
                  </button>
                  <button type="button" onClick={() => handleDelete(s)} className="staff__delete-btn">
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {leftStaff.length > 0 && (
        <div className="staff__section">
          <h3 className="staff__heading">Left Staff ({leftStaff.length})</h3>
          <div className="staff__list">
            {leftStaff.map((s) => (
              <div key={s.id} className="staff__card staff__card--left">
                <div className="staff__card-info">
                  <p className="staff__name">
                    {s.name}
                    <span className="staff__tag staff__tag--role">
                      <Briefcase size={11} /> {s.designation}
                    </span>
                    <span className="staff__tag staff__tag--off">Left {fmtDate(s.left_date)}</span>
                  </p>
                  <p className="staff__meta">
                    {s.department || "No department"}
                    {s.phone ? ` · ${s.phone}` : ""}
                    {s.joining_date ? ` · joined ${fmtDate(s.joining_date)}` : ""}
                  </p>
                </div>
                <div className="staff__card-actions">
                  <button type="button" onClick={() => handleRejoin(s)} className="staff__edit-btn">
                    <Undo2 size={13} /> Rejoin
                  </button>
                  <button type="button" onClick={() => handleDelete(s)} className="staff__delete-btn">
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
