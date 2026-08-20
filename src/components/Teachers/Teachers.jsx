import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Save, X, Eye, EyeOff, KeyRound, BookOpen, ClipboardList, FileText, BarChart3, Users, Wallet, HardHat, Copy, FolderOpen, UserMinus, Undo2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import { ALL_SUBJECTS } from "../../lib/academics";
import { TEACHER_RIGHTS, createTeacherLogin, resetTeacherPassword, deleteTeacher, fetchTeacherPasswords } from "../../lib/teacherAuth";
import { EMPLOYMENT_TYPES, employmentTypeOf, formatMoney } from "../../lib/payroll";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber } from "../../lib/whatsapp";
import WhatsappIcon from "../WhatsappIcon/WhatsappIcon";
import ClassTestEntry from "../ClassTestEntry/ClassTestEntry";
import AssignmentEntry from "../AssignmentEntry/AssignmentEntry";
import AdminStaff from "../AdminStaff/AdminStaff";
import StaffPayroll from "../StaffPayroll/StaffPayroll";
import TeacherUploads from "../TeacherUploads/TeacherUploads";
import "./Teachers.css";

const emptyForm = {
  name: "",
  qualification: "",
  phone: "",
  whatsapp: "",
  email: "",
  password: "",
  employment_type: "Regular",
  monthly_salary: "",
  per_day_salary: "",
  joining_date: "",
  subjects: [],
  programs: [],
  rights: ["class_tests"],
  is_active: true,
};

/**
 * Her login details, with the password only when there is one to quote.
 *
 * Sending must never depend on knowing the password, because knowing it is the one
 * thing this screen cannot arrange — her login is a Supabase Auth account and only a
 * hash of it exists. When it is not known the message carries the email and points
 * her at the office, which is true and costs nobody her working password.
 */
const buildTeacherCredentialsMessage = (name, email, password) =>
  [
    `Assalamualaikum ${name},`,
    "",
    "Your CMGC teacher portal login is ready.",
    "",
    `Login Email: ${email}`,
    ...(password
      ? [`Password: ${password}`]
      : ["Password: the one issued to you by the college office."]),
    "",
    "Open the college website, press Portal Login and sign in with these details.",
    ...(password
      ? []
      : ["If you have forgotten your password, tell the office and a new one will be set for you."]),
    "Please keep this message to yourself.",
    "Thank you.",
  ].join("\n");

// A readable throwaway password to offer when the admin is setting one: two short
// words and three digits beats a random string she has to read out over the phone
// when WhatsApp does not arrive.
const SUGGEST_WORDS = ["cmgc", "class", "school", "study", "teach"];
function suggestPassword() {
  const word = SUGGEST_WORDS[Math.floor(Math.random() * SUGGEST_WORDS.length)];
  return `${word}${Math.floor(100 + Math.random() * 900)}`;
}

// `superOnly` is the one thing that varies: Student Uploads can edit and delete
// anything any teacher has published, so it is not a screen a sub-admin holding the
// `teachers` permission should reach.
const SUB_TABS = [
  { id: "list", label: "Teachers", icon: Users },
  { id: "staff", label: "Admin Staff", icon: HardHat },
  { id: "payroll", label: "Attendance & Salary", icon: Wallet },
  { id: "tests", label: "Class Tests", icon: ClipboardList },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "uploads", label: "Student Uploads", icon: FolderOpen, superOnly: true },
  { id: "report", label: "Report", icon: BarChart3 },
];

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

// Today as "YYYY-MM-DD" in local time — toISOString would slip a day near midnight.
const todayISO = () => new Date().toLocaleDateString("en-CA");

export default function Teachers({ allowedPrograms = [], adminProfile = null }) {
  const [tab, setTab] = useState("list");
  const [teachers, setTeachers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);

  // Passwords set during this visit to the screen, by teacher id.
  //
  // Supabase Auth keeps only a hash, so a password that has already been set can
  // never be read back out of it. This map is what an admin typed a moment ago, and
  // it is what lets "Add Teacher" be followed by "send her the details" without
  // immediately resetting the password she just chose. Memory only — a reload
  // forgets it. Every admin who can manage teachers has this much.
  const [knownPasswords, setKnownPasswords] = useState({});
  const rememberPassword = (id, password) =>
    setKnownPasswords((prev) => ({ ...prev, [id]: password }));

  // The vault: what server.js recorded each time a password was set, so it survives
  // a reload. Only a super admin's select policy matches it, so only a super admin
  // asks for it — see supabase_teacher_password_vault.sql. What it cannot do is
  // recover history: a login created before that migration ran has no row, and
  // `passwordFor` says "not recorded" rather than pretending it is blank.
  const isSuperAdmin = Boolean(adminProfile?.is_super_admin);
  const [vaultPasswords, setVaultPasswords] = useState({});
  // Starts true so nothing accuses the database before the first read comes back.
  const [vaultReady, setVaultReady] = useState(true);
  const [revealed, setRevealed] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  // The in-session value wins: it is what was typed on this screen a moment ago, so
  // it is at worst as fresh as the vault and never staler.
  const passwordFor = (t) => knownPasswords[t.id] || vaultPasswords[t.id] || null;

  const loadVault = async () => {
    if (!isSuperAdmin) return;
    const { ready, passwords } = await fetchTeacherPasswords();
    setVaultPasswords(passwords);
    setVaultReady(ready);
  };

  const copyPassword = async (t) => {
    const password = passwordFor(t);
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopiedId(t.id);
      window.setTimeout(() => setCopiedId((id) => (id === t.id ? null : id)), 1500);
    } catch {
      window.prompt(`Copy ${t.name}'s password:`, password);
    }
  };

  // Null `left_date` is the active roster; a date is the register of those gone.
  const activeTeachers = teachers.filter((t) => !t.left_date);
  const leftTeachers = teachers.filter((t) => t.left_date);

  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  // A restored tab is validated, never trusted — the same rule AdminPortal follows
  // for a permission withdrawn since the session was stored. Without this, `tab`
  // could sit on a screen that no longer renders and leave a blank panel.
  const visibleSubTabs = SUB_TABS.filter((s) => !s.superOnly || isSuperAdmin);
  const activeTab = visibleSubTabs.some((s) => s.id === tab) ? tab : "list";

  // When editing a teacher who already has a login, email/password are managed through
  // Supabase Auth on the server, not through this form.
  const hasLogin = Boolean(editing?.user_id);

  const fetchTeachers = async () => {
    setLoading(true);
    const { data, error: dbError } = await supabase.from("teachers").select("*").order("name");
    if (dbError) setError(dbError.message);
    setTeachers(data || []);
    setLoading(false);
  };

  // The non-teaching register. Loaded here rather than inside AdminStaff because
  // the payroll tab next door is built from the same list.
  const fetchStaff = async () => {
    setStaffLoading(true);
    const { data, error: dbError } = await supabase
      .from("staff")
      .select("*")
      .order("department")
      .order("name");
    if (dbError) setError(dbError.message);
    setStaff(data || []);
    setStaffLoading(false);
  };

  // Mount only: the three lists are re-fetched by the actions that change them, and
  // adminProfile does not change while the tab is open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTeachers();
    fetchStaff();
    loadVault();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setEditing(null);
    setForm(emptyForm);
    setError("");
  };

  const startEdit = (t) => {
    setEditing(t);
    setError("");
    setForm({
      name: t.name || "",
      qualification: t.qualification || "",
      phone: t.phone || "",
      whatsapp: t.whatsapp || "",
      email: t.email || "",
      password: "",
      employment_type: employmentTypeOf(t),
      monthly_salary: t.monthly_salary != null ? String(t.monthly_salary) : "",
      per_day_salary: t.per_day_salary != null ? String(t.per_day_salary) : "",
      joining_date: t.joining_date || "",
      subjects: Array.isArray(t.subjects) ? t.subjects : [],
      programs: Array.isArray(t.programs) ? t.programs : [],
      rights: Array.isArray(t.rights) ? t.rights : [],
      is_active: t.is_active !== false,
    });
    setTab("list");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Teacher name is required.");
    if (form.subjects.length === 0) return setError("Select at least one subject this teacher teaches.");

    // A pay rate is required, not optional: the salary screen has no way to guess
    // one, and a teacher silently sitting at Rs 0 is worse than a blocked save.
    const isVisiting = form.employment_type === "Visiting";
    const rate = Number(isVisiting ? form.per_day_salary : form.monthly_salary);
    if (!Number.isFinite(rate) || rate <= 0) {
      return setError(
        isVisiting
          ? "Enter the per-day salary for a Visiting teacher."
          : "Enter the monthly salary for a Regular teacher."
      );
    }

    const needsLogin = !editing || !hasLogin;
    if (needsLogin) {
      if (!form.email.trim()) return setError("Login email is required.");
      if (!form.password.trim()) return setError("Login password is required.");
      if (form.password.trim().length < 6) return setError("Password must be at least 6 characters.");
    }

    // Only the rate that belongs to the chosen type is kept — leaving the other one
    // populated makes the Teachers list read as if she is on two pay shapes at once.
    const pay = {
      employment_type: form.employment_type,
      monthly_salary: isVisiting ? null : rate,
      per_day_salary: isVisiting ? rate : null,
      joining_date: form.joining_date || null,
      whatsapp: form.whatsapp.trim() || null,
    };

    setSaving(true);
    try {
      if (needsLogin) {
        // Creates the Supabase Auth user (and the teachers row, unless we are attaching a
        // login to a record that already exists) through the server's service-role key.
        const created = await createTeacherLogin({
          teacherId: editing?.id,
          email: form.email.trim(),
          password: form.password.trim(),
          name: form.name.trim(),
          qualification: form.qualification.trim(),
          phone: form.phone.trim(),
          subjects: form.subjects,
          programs: form.programs,
          rights: form.rights,
          ...pay,
        });
        // The route answers with the row it wrote, so the password she just typed can be
        // held against the right teacher and sent from her card without a reset.
        if (created?.teacher?.id) rememberPassword(created.teacher.id, form.password.trim());
        // A `warning` on the response means the vault could not be written. Same
        // reasoning as handleResetPassword: the login exists and works, so this is
        // not raised here — reloading the vault raises the strip above the list.
        await loadVault();
      } else {
        const { error: dbError } = await supabase
          .from("teachers")
          .update({
            name: form.name.trim(),
            qualification: form.qualification.trim() || null,
            phone: form.phone.trim() || null,
            subjects: form.subjects,
            programs: form.programs,
            rights: form.rights,
            is_active: form.is_active,
            subject: form.subjects[0] || null,
            ...pay,
          })
          .eq("id", editing.id);
        if (dbError) throw new Error(dbError.message);
      }
      resetForm();
      await fetchTeachers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (t) => {
    // This is the one button that changes a password, so this is the one place that
    // asks for one. A suggestion is offered because the admin usually just wants a
    // working password to hand over, not to invent one.
    const next = window.prompt(
      `Set a new login password for ${t.name} (minimum 6 characters).\n\n` +
      `Her current password stops working. Nothing else about her record changes.`,
      suggestPassword()
    );
    if (next === null) return;
    if (next.trim().length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    try {
      await resetTeacherPassword(t.id, next.trim());
      rememberPassword(t.id, next.trim());
      // The route also answers with a `warning` when it could not file the password
      // in the vault. It is deliberately not shown here: the reset itself succeeded,
      // and an alert that says "done" and "failed" in the same breath is read as a
      // broken button. Reloading the vault raises the strip above the list instead,
      // which says it once, in the place that can do something about it.
      await loadVault();
      alert(
        `Password updated. ${t.name} can now sign in with ${t.email} and the new password. ` +
        "Use the WhatsApp button on her card to send it to her."
      );
    } catch (err) {
      alert("Could not update password: " + err.message);
    }
  };

  /**
   * Send a teacher her own login details on WhatsApp.
   *
   * Sending changes nothing. It opens a chat and nothing else — no password is set
   * here and none is asked for, because a teacher who already has a working login
   * must not lose it just because the office wanted to message her the email.
   *
   * Her password is not readable out of Supabase Auth, so the message quotes one only
   * when this screen knows it — set here a moment ago, or recorded in the vault a
   * super admin can read. Otherwise it names the office as where her password came
   * from. Setting a password still lives behind "Reset Password", which is the button
   * that says it is going to do that.
   */
  const handleSendCredentials = (t) => {
    if (!t.user_id) {
      alert(`${t.name} has no login yet, so there is nothing to send. Use "Create Login" on her card first.`);
      return;
    }
    if (!t.email) {
      alert(`${t.name} has a login but no email on her record, so the message would have no username in it.`);
      return;
    }

    // Her WhatsApp, falling back to her phone — the same rule as everywhere else.
    let number = whatsappNumberFor(t);
    if (!isValidWhatsAppNumber(number)) {
      const entered = window.prompt(
        `WhatsApp number for ${t.name} is missing or invalid. Enter one (03XXXXXXXXX):`,
        ""
      );
      if (entered === null) return;
      number = entered.trim();
      if (!isValidWhatsAppNumber(number)) {
        alert("That does not look like a Pakistani mobile number, so nothing was sent.");
        return;
      }
    }

    // Nothing is awaited between here and the chat, so no window has to be reserved
    // against the popup blocker — this is all still inside the click.
    const opened = openWhatsApp(
      number,
      buildTeacherCredentialsMessage(t.name, t.email, passwordFor(t))
    );
    if (!opened) alert("Could not open WhatsApp. Please check the number and try again.");
  };

  // Off the active roster and the payroll register, but nothing is deleted: her
  // record, attendance, salary and class-test history all stay where they are.
  // Her login goes with her — a working password for someone who no longer works
  // here is not a courtesy worth keeping.
  const handleMarkLeft = async (t) => {
    if (!window.confirm(
      `Mark ${t.name} as left? She moves to the Left Teachers list and comes off the ` +
      `attendance and salary register.${t.user_id ? " Her portal login is disabled." : ""}\n\n` +
      `Nothing is deleted — her record and history stay, and Rejoin brings her back.`
    )) return;
    const { data, error: dbError } = await supabase
      .from("teachers")
      .update({ left_date: todayISO(), is_active: false })
      .eq("id", t.id)
      .select("id");
    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);
    if (editing?.id === t.id) resetForm();
    await fetchTeachers();
  };

  const handleRejoin = async (t) => {
    const { data, error: dbError } = await supabase
      .from("teachers")
      .update({ left_date: null, is_active: true })
      .eq("id", t.id)
      .select("id");
    if (dbError) return setError(dbError.message);
    if (!data || data.length === 0) return setError(WRITE_BLOCKED_HINT);
    await fetchTeachers();
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Remove ${t.name}? Their login will be deleted. Their class tests stay in the records but will no longer show a teacher name.`)) return;
    try {
      await deleteTeacher(t.id);
      if (editing?.id === t.id) resetForm();
      await fetchTeachers();
    } catch (err) {
      alert("Could not remove teacher: " + err.message);
    }
  };

  return (
    <div className="teachers">
      <div className="teachers__tabs" role="group" aria-label="Teachers sections">
        {visibleSubTabs.map((s) => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`teachers__tab ${activeTab === s.id ? "teachers__tab--active" : ""}`}
          >
            <s.icon size={15} /> {s.label}
          </button>
        ))}
      </div>

      {activeTab === "list" && (
        <>
          <div className="teachers__section">
            <h3 className="teachers__heading">
              {!editing ? "Add a New Teacher" : hasLogin ? `Edit ${editing.name}` : `Create Login for ${editing.name}`}
            </h3>
            <form onSubmit={handleSubmit} className="teachers__form">
              <div className="teachers__form-row">
                <div className="teachers__field">
                  <label>Full Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ayesha Khan" />
                </div>
                <div className="teachers__field">
                  <label>Qualification</label>
                  <input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="e.g. M.Sc Physics" />
                </div>
                <div className="teachers__field">
                  <label>Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="03XXXXXXXXX" />
                </div>
              </div>

              <div className="teachers__form-row">
                <div className="teachers__field">
                  <label>WhatsApp (for salary slips)</label>
                  <input
                    value={form.whatsapp}
                    onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                    placeholder="Leave blank to use the phone above"
                  />
                </div>
                <div className="teachers__field">
                  <label>Joining Date</label>
                  <input type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
                </div>
                <div className="teachers__field">
                  <label>Employment Status *</label>
                  <select
                    value={form.employment_type}
                    onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                  >
                    {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Only the rate that applies is shown — a Regular teacher has no per-day
                  rate to enter, and a Visiting one has no monthly salary. */}
              <div className="teachers__form-row">
                {form.employment_type === "Visiting" ? (
                  <div className="teachers__field">
                    <label>Per Day Salary (Rs) *</label>
                    <input
                      type="number" min="0" step="any"
                      value={form.per_day_salary}
                      onChange={(e) => setForm({ ...form, per_day_salary: e.target.value })}
                      placeholder="e.g. 1500"
                    />
                  </div>
                ) : (
                  <div className="teachers__field">
                    <label>Monthly Salary (Rs) *</label>
                    <input
                      type="number" min="0" step="any"
                      value={form.monthly_salary}
                      onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
                      placeholder="e.g. 35000"
                    />
                  </div>
                )}
                <div className="teachers__field teachers__pay-note">
                  <label>&nbsp;</label>
                  <p className="teachers__hint">
                    {form.employment_type === "Visiting"
                      ? "Paid for the days she actually taught — holidays and absences are simply unpaid, so nothing is deducted."
                      : `Full monthly salary. The first leave or absence each month is free; after that one day's pay (salary ÷ that month's working days) is deducted per day. Holidays never deduct.`}
                  </p>
                </div>
              </div>

              <div className="teachers__form-row">
                <div className="teachers__field">
                  <label>Login Email {hasLogin ? "" : "*"}</label>
                  <input
                    type="email"
                    value={form.email}
                    disabled={hasLogin}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="teacher@example.com"
                  />
                </div>
                <div className="teachers__field">
                  <label>Login Password {hasLogin ? "" : "*"}</label>
                  <div className="teachers__password-wrap">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      disabled={hasLogin}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder={hasLogin ? "Use “Reset Password” below" : "Min 6 characters"}
                    />
                    {!hasLogin && (
                      <button type="button" onClick={() => setShowPassword((s) => !s)} className="teachers__eye">
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {hasLogin && (
                <p className="teachers__hint">
                  Email and password belong to this teacher’s Supabase Auth login, exactly like a sub-admin’s.
                  Use <strong>Reset Password</strong> on her card below to change it.
                </p>
              )}

              <div className="teachers__field-label">Subjects Taught *</div>
              <div className="teachers__chip-row">
                {ALL_SUBJECTS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setForm((f) => ({ ...f, subjects: toggleValue(f.subjects, s) }))}
                    className={"teachers__chip " + (form.subjects.includes(s) ? "teachers__chip--active" : "")}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="teachers__field-label">Classes / Programs (none selected = all programs)</div>
              <div className="teachers__chip-row">
                {visiblePrograms.map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setForm((f) => ({ ...f, programs: toggleValue(f.programs, p) }))}
                    className={"teachers__chip " + (form.programs.includes(p) ? "teachers__chip--active" : "")}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="teachers__field-label">Duties / Rights in the Teacher Portal</div>
              <div className="teachers__chip-row">
                {TEACHER_RIGHTS.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => setForm((f) => ({ ...f, rights: toggleValue(f.rights, r.id) }))}
                    className={"teachers__chip " + (form.rights.includes(r.id) ? "teachers__chip--active" : "")}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {editing && hasLogin && (
                <label className="teachers__active-toggle">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  Login active
                </label>
              )}

              {error && <p className="teachers__error">{error}</p>}

              <div className="teachers__form-actions">
                <button type="submit" disabled={saving} className="teachers__submit">
                  {editing ? <Save size={15} /> : <Plus size={15} />}
                  {saving ? "Saving..." : !editing ? "Add Teacher" : hasLogin ? "Save Changes" : "Create Login"}
                </button>
                {editing && (
                  <button type="button" onClick={resetForm} className="teachers__cancel">
                    <X size={14} /> Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="teachers__section">
            <h3 className="teachers__heading">Teaching Staff ({activeTeachers.length})</h3>

            {/* Said once, here, rather than on every reset. The office cannot run
                SQL from this screen, but it is the person who reports it. */}
            {isSuperAdmin && !vaultReady && (
              <p className="teachers__vault-warning">
                <KeyRound size={13} />
                <span>
                  Passwords are not being recorded yet — <code>supabase_teacher_password_vault.sql</code> has
                  not been run in Supabase. Reset Password still works and the teacher can sign in with the
                  new one, but nothing is kept for you to look up afterwards. Run that file once and every
                  password set from then on will show on her card.
                </span>
              </p>
            )}
            {loading ? (
              <p className="teachers__empty">Loading...</p>
            ) : activeTeachers.length === 0 ? (
              <p className="teachers__empty">No teachers added yet.</p>
            ) : (
              <div className="teachers__list">
                {activeTeachers.map((t) => (
                  <div key={t.id} className="teachers__card">
                    <div className="teachers__card-info">
                      <p className="teachers__name">
                        {t.name}
                        <span className={`teachers__tag teachers__tag--${employmentTypeOf(t).toLowerCase()}`}>
                          {employmentTypeOf(t)}
                        </span>
                        <span className="teachers__tag teachers__tag--pay">
                          {employmentTypeOf(t) === "Visiting"
                            ? `${formatMoney(t.per_day_salary)} / day`
                            : `${formatMoney(t.monthly_salary)} / month`}
                        </span>
                        {!t.user_id && <span className="teachers__tag teachers__tag--off">No login</span>}
                        {t.user_id && t.is_active === false && <span className="teachers__tag teachers__tag--off">Login disabled</span>}
                      </p>
                      <p className="teachers__meta">
                        {t.email || "no login email"}
                        {t.qualification ? ` · ${t.qualification}` : ""}
                        {t.phone ? ` · ${t.phone}` : ""}
                        {t.joining_date ? ` · joined ${fmtDate(t.joining_date)}` : ""}
                      </p>

                      {/* Her portal password, super admin only. Hidden until asked for,
                          because these cards are read in an office with a counter in
                          front of them. "Not recorded" is the honest answer for a login
                          set before the vault existed — Auth cannot be asked. */}
                      {isSuperAdmin && t.user_id && (
                        <p className="teachers__password-line">
                          <KeyRound size={12} />
                          {passwordFor(t) ? (
                            <>
                              <code>{revealed[t.id] ? passwordFor(t) : "••••••••"}</code>
                              <button
                                type="button"
                                onClick={() => setRevealed((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
                                className="teachers__password-toggle"
                                title={revealed[t.id] ? "Hide password" : `Show ${t.name}'s password`}
                              >
                                {revealed[t.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyPassword(t)}
                                className="teachers__password-toggle"
                                title="Copy password"
                              >
                                <Copy size={13} />
                              </button>
                              {copiedId === t.id && <span className="teachers__password-copied">Copied</span>}
                            </>
                          ) : (
                            <span className="teachers__password-missing">
                              {vaultReady
                                ? "Password not recorded — it was set before this was kept, and Supabase " +
                                  "Auth cannot be asked for it. Use Reset Password to set a new one."
                                : "Password not recorded, and resetting it will not record one either " +
                                  "until the file named above has been run."}
                            </span>
                          )}
                        </p>
                      )}

                      <div className="teachers__tags">
                        <BookOpen size={12} className="teachers__tags-icon" />
                        {(t.subjects || []).length === 0 ? (
                          <span className="teachers__tag teachers__tag--muted">No subject assigned</span>
                        ) : (
                          (t.subjects || []).map((s) => <span key={s} className="teachers__tag">{s}</span>)
                        )}
                      </div>
                      <div className="teachers__tags">
                        {(t.programs || []).length === 0 ? (
                          <span className="teachers__tag teachers__tag--muted">All programs</span>
                        ) : (
                          (t.programs || []).map((p) => <span key={p} className="teachers__tag">{p}</span>)
                        )}
                      </div>
                      <div className="teachers__tags">
                        {(t.rights || []).length === 0 ? (
                          <span className="teachers__tag teachers__tag--muted">No portal rights</span>
                        ) : (
                          (t.rights || []).map((r) => (
                            <span key={r} className="teachers__tag teachers__tag--right">
                              {TEACHER_RIGHTS.find((x) => x.id === r)?.label || r}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="teachers__card-actions">
                      <button onClick={() => startEdit(t)} className="teachers__edit-btn">
                        {t.user_id ? "Edit" : "Create Login"}
                      </button>
                      {t.user_id && (
                        <button onClick={() => handleResetPassword(t)} className="teachers__edit-btn">
                          <KeyRound size={13} /> Reset Password
                        </button>
                      )}
                      {t.user_id && (
                        <button
                          onClick={() => handleSendCredentials(t)}
                          className="teachers__wa-btn"
                          title={
                            knownPasswords[t.id]
                              ? `Send ${t.name} her login email and password on WhatsApp`
                              : `Send ${t.name} her login email on WhatsApp. Her password is not stored, so it is not included — use Reset Password first if she needs one.`
                          }
                          aria-label={`Send login details to ${t.name} on WhatsApp`}
                        >
                          <WhatsappIcon /> Send Login
                        </button>
                      )}
                      <button
                        onClick={() => handleMarkLeft(t)}
                        className="teachers__left-btn"
                        title={`Move ${t.name} to the Left Teachers list`}
                      >
                        <UserMinus size={13} /> Left
                      </button>
                      <button onClick={() => handleDelete(t)} className="teachers__delete-btn">
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {leftTeachers.length > 0 && (
            <div className="teachers__section">
              <h3 className="teachers__heading">Left Teachers ({leftTeachers.length})</h3>
              <div className="teachers__list">
                {leftTeachers.map((t) => (
                  <div key={t.id} className="teachers__card teachers__card--left">
                    <div className="teachers__card-info">
                      <p className="teachers__name">
                        {t.name}
                        <span className="teachers__tag teachers__tag--off">
                          Left {fmtDate(t.left_date)}
                        </span>
                      </p>
                      <p className="teachers__meta">
                        {t.email || "no login email"}
                        {t.qualification ? ` · ${t.qualification}` : ""}
                        {t.phone ? ` · ${t.phone}` : ""}
                        {t.joining_date ? ` · joined ${fmtDate(t.joining_date)}` : ""}
                      </p>
                    </div>
                    <div className="teachers__card-actions">
                      <button onClick={() => handleRejoin(t)} className="teachers__edit-btn">
                        <Undo2 size={13} /> Rejoin
                      </button>
                      <button onClick={() => handleDelete(t)} className="teachers__delete-btn">
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "staff" && (
        <AdminStaff staff={staff} loading={staffLoading} onChanged={fetchStaff} />
      )}

      {activeTab === "payroll" && <StaffPayroll teachers={teachers} staff={staff} />}

      {activeTab === "tests" && (
        <ClassTestEntry teacher={null} allowedPrograms={allowedPrograms} teacherOptions={teachers} />
      )}

      {activeTab === "assignments" && (
        <AssignmentEntry teacher={null} allowedPrograms={allowedPrograms} teacherOptions={teachers} />
      )}

      {/* Super admin only — the tab is filtered out of `visibleSubTabs` for anyone
          else, and `activeTab` can never land here without it. */}
      {activeTab === "uploads" && <TeacherUploads teachers={teachers} />}

      {activeTab === "report" && <TeacherReport teachers={teachers} />}
    </div>
  );
}

/* ---------- Report: one teacher's class test activity ---------- */

function TeacherReport({ teachers }) {
  const [teacherId, setTeacherId] = useState("");
  const [tests, setTests] = useState([]);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadReport = async (id) => {
    setLoading(true);
    const { data: testRows } = await supabase
      .from("class_tests")
      .select("*")
      .eq("teacher_id", id)
      .order("test_date", { ascending: false });

    const list = testRows || [];
    setTests(list);

    if (list.length === 0) {
      setMarks([]);
      setLoading(false);
      return;
    }

    const { data: markRows } = await supabase
      .from("class_test_marks")
      .select("class_test_id, student_id, marks_obtained, is_absent")
      .in("class_test_id", list.map((t) => t.id));

    setMarks(markRows || []);
    setLoading(false);
  };

  // Nothing is rendered from `tests`/`marks` while no teacher is picked, so they are
  // only refreshed on the async path — never cleared synchronously in the effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (teacherId) loadReport(teacherId);
  }, [teacherId]);

  // Per-test aggregates, plus the overall and per-subject rollups built from them.
  const perTest = useMemo(() => {
    return tests.map((t) => {
      const rows = marks.filter((m) => m.class_test_id === t.id);
      const present = rows.filter((m) => !m.is_absent && m.marks_obtained !== null);
      const scores = present.map((m) => Number(m.marks_obtained));
      const total = Number(t.total_marks) || 0;
      const avgPct = scores.length > 0 && total > 0
        ? (scores.reduce((a, v) => a + v, 0) / (scores.length * total)) * 100
        : null;
      return {
        test: t,
        marked: rows.length,
        absent: rows.filter((m) => m.is_absent).length,
        avgPct,
        highest: scores.length ? Math.max(...scores) : null,
        lowest: scores.length ? Math.min(...scores) : null,
      };
    });
  }, [tests, marks]);

  const bySubject = useMemo(() => {
    const map = new Map();
    perTest.forEach((row) => {
      const key = row.test.subject;
      if (!map.has(key)) map.set(key, { subject: key, tests: 0, pctSum: 0, pctCount: 0 });
      const entry = map.get(key);
      entry.tests += 1;
      if (row.avgPct !== null) {
        entry.pctSum += row.avgPct;
        entry.pctCount += 1;
      }
    });
    return [...map.values()].map((e) => ({
      ...e,
      avgPct: e.pctCount > 0 ? e.pctSum / e.pctCount : null,
    }));
  }, [perTest]);

  const overallPcts = perTest.filter((r) => r.avgPct !== null).map((r) => r.avgPct);
  const overallAvg = overallPcts.length > 0 ? overallPcts.reduce((a, v) => a + v, 0) / overallPcts.length : null;
  const totalMarked = perTest.reduce((a, r) => a + r.marked, 0);

  const selected = teachers.find((t) => t.id === teacherId);

  return (
    <div className="teachers__section">
      <h3 className="teachers__heading">Class Test Report</h3>

      <div className="teachers__field teachers__report-picker">
        <label>Teacher</label>
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">— Select a teacher —</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.email ? ` (${t.email})` : ""}</option>)}
        </select>
      </div>

      {!teacherId ? (
        <p className="teachers__empty">Pick a teacher to see the class tests she has conducted.</p>
      ) : loading ? (
        <p className="teachers__empty">Loading report...</p>
      ) : tests.length === 0 ? (
        <p className="teachers__empty">{selected?.name} has not conducted any class test yet.</p>
      ) : (
        <>
          <div className="teachers__stat-row">
            <div className="teachers__stat">
              <p className="teachers__stat-value">{tests.length}</p>
              <p className="teachers__stat-label">Tests Conducted</p>
            </div>
            <div className="teachers__stat">
              <p className="teachers__stat-value">{bySubject.length}</p>
              <p className="teachers__stat-label">Subjects</p>
            </div>
            <div className="teachers__stat">
              <p className="teachers__stat-value">{totalMarked}</p>
              <p className="teachers__stat-label">Entries Marked</p>
            </div>
            <div className="teachers__stat">
              <p className="teachers__stat-value">{overallAvg !== null ? `${overallAvg.toFixed(1)}%` : "—"}</p>
              <p className="teachers__stat-label">Overall Class Average</p>
            </div>
          </div>

          <div className="teachers__field-label">Subject-wise</div>
          <div className="teachers__tags">
            {bySubject.map((s) => (
              <span key={s.subject} className="teachers__tag teachers__tag--right">
                {s.subject}: {s.tests} test{s.tests === 1 ? "" : "s"}
                {s.avgPct !== null ? ` · avg ${s.avgPct.toFixed(1)}%` : ""}
              </span>
            ))}
          </div>

          <div className="teachers__table-wrap">
            <table className="teachers__table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Subject</th>
                  <th>Class</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Marked</th>
                  <th>Absent</th>
                  <th>Avg</th>
                  <th>High</th>
                  <th>Low</th>
                </tr>
              </thead>
              <tbody>
                {perTest.map((r) => (
                  <tr key={r.test.id}>
                    <td>{r.test.title}</td>
                    <td>{r.test.subject}</td>
                    <td>{r.test.program} {r.test.year_of_study}</td>
                    <td>{fmtDate(r.test.test_date)}</td>
                    <td>{r.test.total_marks}</td>
                    <td>{r.marked}</td>
                    <td>{r.absent}</td>
                    <td>{r.avgPct !== null ? `${r.avgPct.toFixed(1)}%` : "—"}</td>
                    <td>{r.highest ?? "—"}</td>
                    <td>{r.lowest ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
