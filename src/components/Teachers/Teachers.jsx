import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Save, X, Eye, EyeOff, KeyRound, BookOpen, ClipboardList, FileText, BarChart3, Users, Wallet, HardHat } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS } from "../../lib/adminAuth";
import { ALL_SUBJECTS } from "../../lib/academics";
import { TEACHER_RIGHTS, createTeacherLogin, resetTeacherPassword, deleteTeacher } from "../../lib/teacherAuth";
import { EMPLOYMENT_TYPES, employmentTypeOf, formatMoney } from "../../lib/payroll";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber, isDemoMode } from "../../lib/whatsapp";
import WhatsappIcon from "../WhatsappIcon/WhatsappIcon";
import ClassTestEntry from "../ClassTestEntry/ClassTestEntry";
import AssignmentEntry from "../AssignmentEntry/AssignmentEntry";
import AdminStaff from "../AdminStaff/AdminStaff";
import StaffPayroll from "../StaffPayroll/StaffPayroll";
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

const buildTeacherCredentialsMessage = (name, email, password) =>
  [
    `Assalamualaikum ${name},`,
    "",
    "Your CMGC teacher portal login is ready.",
    "",
    `Login Email: ${email}`,
    `Password: ${password}`,
    "",
    "Open the college website, press Portal Login and sign in with these details.",
    "Please keep this message to yourself.",
    "Thank you.",
  ].join("\n");

// A readable throwaway password for the "she has no password we can quote" case:
// two short words and three digits beats a random string an admin has to read out
// over the phone when WhatsApp does not arrive.
const SUGGEST_WORDS = ["cmgc", "class", "school", "study", "teach"];
function suggestPassword() {
  const word = SUGGEST_WORDS[Math.floor(Math.random() * SUGGEST_WORDS.length)];
  return `${word}${Math.floor(100 + Math.random() * 900)}`;
}

const SUB_TABS = [
  { id: "list", label: "Teachers", icon: Users },
  { id: "staff", label: "Admin Staff", icon: HardHat },
  { id: "payroll", label: "Attendance & Salary", icon: Wallet },
  { id: "tests", label: "Class Tests", icon: ClipboardList },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "report", label: "Report", icon: BarChart3 },
];

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function Teachers({ allowedPrograms = [] }) {
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
  // Nothing stores a teacher's password — Supabase Auth keeps a hash and the
  // `teachers` table has no password column at all, which is exactly the point of
  // her having a real login rather than the plaintext one a student gets. So the
  // only password the portal can ever quote back is one the admin has just typed,
  // and remembering it here is what lets "Add Teacher" be followed by "send her the
  // details" without immediately resetting the password she just chose. Memory
  // only: a reload forgets them, and the send flow then offers to set a new one.
  const [knownPasswords, setKnownPasswords] = useState({});
  const rememberPassword = (id, password) =>
    setKnownPasswords((prev) => ({ ...prev, [id]: password }));

  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTeachers();
    fetchStaff();
  }, []);

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
    const next = window.prompt(`Set a new login password for ${t.name} (minimum 6 characters):`, "");
    if (next === null) return;
    if (next.trim().length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    try {
      await resetTeacherPassword(t.id, next.trim());
      rememberPassword(t.id, next.trim());
      alert(`Password updated. ${t.name} can now sign in with ${t.email} and the new password. Use the WhatsApp button on her card to send it to her.`);
    } catch (err) {
      alert("Could not update password: " + err.message);
    }
  };

  /**
   * Send a teacher her own login details on WhatsApp.
   *
   * Unlike a student's, her password is not on her row — Supabase Auth holds only a
   * hash, so there is nothing to look up. Two paths follow from that:
   *
   *  - the admin set a password on this screen a moment ago, so it is in
   *    `knownPasswords` and can simply be sent;
   *  - it is not, in which case the only way to state a password in the message is
   *    to set one. That is a real change to her login, so it is spelled out in the
   *    prompt rather than done quietly behind a "send" button.
   *
   * The chat window is reserved before the `await`, exactly like doApprove() in
   * StudentsList: a window.open after an await is blocked as a popup.
   */
  const handleSendCredentials = async (t) => {
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

    const known = knownPasswords[t.id];
    let password = known;

    if (!known) {
      const chosen = window.prompt(
        `${t.name}'s password is not stored anywhere — her login is a real Supabase account, so the portal only ever sees a hash of it.\n\n` +
        `To put a password in the message, one has to be set. Sending now will REPLACE her current password: whatever she is using today stops working.\n\n` +
        `Password to set and send (minimum 6 characters), or Cancel:`,
        suggestPassword()
      );
      if (chosen === null) return;
      password = chosen.trim();
      if (password.length < 6) {
        alert("Password must be at least 6 characters. Nothing was sent and nothing was changed.");
        return;
      }
    }

    // Reserved inside the click, before any await, or the browser blocks it. The demo
    // never opens a real chat, so reserving there would leave a blank tab sitting open.
    const waWindow = isDemoMode() ? null : window.open("", "_blank");

    if (!known) {
      try {
        await resetTeacherPassword(t.id, password);
        rememberPassword(t.id, password);
      } catch (err) {
        if (waWindow && !waWindow.closed) waWindow.close();
        alert("Could not set the new password, so nothing was sent: " + err.message);
        return;
      }
    }

    const opened = openWhatsApp(number, buildTeacherCredentialsMessage(t.name, t.email, password), waWindow);
    if (!opened && waWindow && !waWindow.closed) waWindow.close();
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
        {SUB_TABS.map((s) => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={`teachers__tab ${tab === s.id ? "teachers__tab--active" : ""}`}
          >
            <s.icon size={15} /> {s.label}
          </button>
        ))}
      </div>

      {tab === "list" && (
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
            <h3 className="teachers__heading">Teaching Staff ({teachers.length})</h3>
            {loading ? (
              <p className="teachers__empty">Loading...</p>
            ) : teachers.length === 0 ? (
              <p className="teachers__empty">No teachers added yet.</p>
            ) : (
              <div className="teachers__list">
                {teachers.map((t) => (
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
                              : `Send ${t.name} her login on WhatsApp — her password is not stored, so a new one has to be set first`
                          }
                          aria-label={`Send login details to ${t.name} on WhatsApp`}
                        >
                          <WhatsappIcon /> Send Login
                        </button>
                      )}
                      <button onClick={() => handleDelete(t)} className="teachers__delete-btn">
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "staff" && (
        <AdminStaff staff={staff} loading={staffLoading} onChanged={fetchStaff} />
      )}

      {tab === "payroll" && <StaffPayroll teachers={teachers} staff={staff} />}

      {tab === "tests" && (
        <ClassTestEntry teacher={null} allowedPrograms={allowedPrograms} teacherOptions={teachers} />
      )}

      {tab === "assignments" && (
        <AssignmentEntry teacher={null} allowedPrograms={allowedPrograms} teacherOptions={teachers} />
      )}

      {tab === "report" && <TeacherReport teachers={teachers} />}
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
