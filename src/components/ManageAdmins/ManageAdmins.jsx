import { useState, useEffect } from "react";
import { Plus, Trash2, Save, X, ShieldCheck, Eye, EyeOff, KeyRound, MessageCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  PERMISSION_KEYS,
  PROGRAMS,
  createSubAdmin,
  deleteSubAdmin,
  updateSubAdmin,
} from "../../lib/adminAuth";
import { openWhatsApp, isValidWhatsAppNumber } from "../../lib/whatsapp";
import "./ManageAdmins.css";

const emptyForm = { name: "", email: "", password: "", whatsapp: "", permissions: [], allowedPrograms: [] };

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// The password appears only when there is one to quote — see the Teachers screen for
// why sending can never depend on knowing it.
function buildAdminCredentialsMessage(name, email, password) {
  return [
    `Assalamualaikum ${name || "Admin"},`,
    "",
    "Your CMGC admin portal login is ready.",
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
  ].join("\n");
}

// A readable throwaway password, for the case where no password is known and one has
// to be set before it can be sent. Same helper as the Teachers screen.
const SUGGEST_WORDS = ["cmgc", "office", "admin", "college"];
function suggestPassword() {
  const word = SUGGEST_WORDS[Math.floor(Math.random() * SUGGEST_WORDS.length)];
  return `${word}${Math.floor(100 + Math.random() * 900)}`;
}

export default function ManageAdmins({ adminProfile }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEditId, setSavingEditId] = useState(null);

  // Passwords set during this visit to the screen, keyed by the admin's user_id.
  //
  // A sub-admin's login is a Supabase Auth account, so nothing here can read her
  // password back — the same position the Teachers screen is in. Holding the one the
  // super admin has just typed is what lets "Send WhatsApp" send it without asking
  // for it again, and without resetting a working login. Memory only; a reload
  // forgets them and the send flow then offers to set a new one.
  const [knownPasswords, setKnownPasswords] = useState({});
  const rememberPassword = (userId, password) =>
    setKnownPasswords((prev) => ({ ...prev, [userId]: password }));

  const fetchAdmins = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("admin_profiles")
      .select("*")
      .order("created_at", { ascending: true });
    setAdmins(data || []);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAdmins();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.password.trim()) {
      setError("Email and password are required.");
      return;
    }
    if (form.permissions.length === 0) {
      setError("Select at least one tab this admin is allowed to use.");
      return;
    }
    if (form.whatsapp.trim() && !isValidWhatsAppNumber(form.whatsapp.trim())) {
      setError("WhatsApp number must be in the format 03XXXXXXXXX.");
      return;
    }

    setCreating(true);
    try {
      const created = await createSubAdmin({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        whatsapp: form.whatsapp.trim() || undefined,
        permissions: form.permissions,
        allowedPrograms: form.allowedPrograms,
      });
      // The route answers with the auth user it made, which is what admin_profiles
      // keys on — so the password just typed can be sent from her card as it is.
      if (created?.userId) rememberPassword(created.userId, form.password);
      setForm(emptyForm);
      await fetchAdmins();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (admin) => {
    setEditingId(admin.id);
    setEditForm({
      name: admin.name || "",
      email: admin.email || "",
      password: "",
      whatsapp: admin.whatsapp || "",
      permissions: [...admin.permissions],
      allowedPrograms: [...admin.allowed_programs],
    });
  };

  const saveEdit = async (admin) => {
    if (!editForm.email.trim()) {
      alert("Email is required.");
      return;
    }
    if (editForm.permissions.length === 0) {
      alert("Select at least one tab this admin is allowed to use.");
      return;
    }
    if (editForm.whatsapp.trim() && !isValidWhatsAppNumber(editForm.whatsapp.trim())) {
      alert("WhatsApp number must be in the format 03XXXXXXXXX.");
      return;
    }

    setSavingEditId(admin.id);
    try {
      await updateSubAdmin({
        targetUserId: admin.user_id,
        email: editForm.email.trim(),
        password: editForm.password.trim() || undefined,
        name: editForm.name.trim(),
        whatsapp: editForm.whatsapp.trim() || undefined,
        permissions: editForm.permissions,
        allowedPrograms: editForm.allowedPrograms,
      });
      if (editForm.password.trim()) rememberPassword(admin.user_id, editForm.password.trim());
      setEditingId(null);
      setEditForm(null);
      await fetchAdmins();
    } catch (err) {
      alert("Failed to update admin: " + err.message);
    } finally {
      setSavingEditId(null);
    }
  };

  /**
   * Send a sub-admin her own login details on WhatsApp.
   *
   * Sending changes nothing: no password is set here and none is asked for. It used
   * to ask on every send, through an empty box that looked like a reset and was not
   * one — whatever was typed went into the message and nowhere else, so a
   * half-remembered password reached someone who then could not sign in with it.
   *
   * Her password cannot be looked up (a sub-admin login is a Supabase Auth account,
   * so only a hash exists), which is precisely why sending must not depend on it. The
   * message quotes a password only when one was set on this screen; changing one
   * lives behind "Reset Password", which is the button that says so.
   */
  const sendCredentials = (admin) => {
    let number = (admin.whatsapp || "").trim();
    if (!number || !isValidWhatsAppNumber(number)) {
      const entered = window.prompt("Enter the sub-admin WhatsApp number (03XXXXXXXXX):", "");
      if (entered === null) return;
      number = entered.trim();
      if (!isValidWhatsAppNumber(number)) {
        return alert("Please enter a valid WhatsApp number in the format 03XXXXXXXXX.");
      }
    }

    // Nothing is awaited between here and the chat, so no window has to be reserved
    // against the popup blocker — this is all still inside the click.
    const message = buildAdminCredentialsMessage(
      admin.name,
      admin.email,
      knownPasswords[admin.user_id] || null
    );
    if (!openWhatsApp(number, message)) {
      alert("Could not open WhatsApp. Please check the number and try again.");
    }
  };

  const handleResetPassword = async (admin) => {
    // The one button that changes a password, so the one place that asks for one.
    const next = window.prompt(
      `Set a new login password for ${admin.name || admin.email} (minimum 6 characters).\n\n` +
      `Her current password stops working. Her tabs, programs and name are untouched.`,
      suggestPassword()
    );
    if (next === null) return;
    const password = next.trim();
    if (password.length < 6) {
      return alert("Password must be at least 6 characters.");
    }

    try {
      await updateSubAdmin({
        targetUserId: admin.user_id,
        email: admin.email,
        password,
        name: admin.name,
        whatsapp: admin.whatsapp || undefined,
        permissions: admin.permissions || [],
        allowedPrograms: admin.allowed_programs || [],
      });
      rememberPassword(admin.user_id, password);
      alert(`Password updated. ${admin.name || admin.email} can now sign in with the new password. Use "Send WhatsApp" on her card to send it to her.`);
      await fetchAdmins();
    } catch (err) {
      alert("Could not update password: " + err.message);
    }
  };

  const handleDelete = async (admin) => {
    if (!window.confirm(`Remove admin access for ${admin.name || admin.email}? This deletes their login entirely.`)) return;
    try {
      await deleteSubAdmin(admin.user_id);
      await fetchAdmins();
    } catch (err) {
      alert("Failed to remove admin: " + err.message);
    }
  };

  return (
    <div className="manage-admins">
      <div className="manage-admins__section">
        <h3 className="manage-admins__heading">Add a New Admin</h3>
        <form onSubmit={handleCreate} className="manage-admins__form">
          <div className="manage-admins__form-row">
            <input
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <div className="manage-admins__password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button type="button" onClick={() => setShowPassword((s) => !s)} className="manage-admins__eye">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <input
              placeholder="WhatsApp (03XXXXXXXXX)"
              value={form.whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
            />
          </div>

          <div className="manage-admins__field-label">Allowed Tabs</div>
          <div className="manage-admins__chip-row">
            {PERMISSION_KEYS.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setForm((f) => ({ ...f, permissions: toggleValue(f.permissions, p.id) }))}
                className={"manage-admins__chip " + (form.permissions.includes(p.id) ? "manage-admins__chip--active" : "")}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="manage-admins__field-label">Allowed Classes/Programs (none selected = all programs)</div>
          <div className="manage-admins__chip-row">
            {PROGRAMS.map((program) => (
              <button
                type="button"
                key={program}
                onClick={() => setForm((f) => ({ ...f, allowedPrograms: toggleValue(f.allowedPrograms, program) }))}
                className={"manage-admins__chip " + (form.allowedPrograms.includes(program) ? "manage-admins__chip--active" : "")}
              >
                {program}
              </button>
            ))}
          </div>

          {error && <p className="manage-admins__error">{error}</p>}

          <button type="submit" disabled={creating} className="manage-admins__submit">
            <Plus size={15} /> {creating ? "Creating..." : "Create Admin"}
          </button>
        </form>
      </div>

      <div className="manage-admins__section">
        <h3 className="manage-admins__heading">Existing Admins</h3>
        {loading ? (
          <p className="manage-admins__empty">Loading...</p>
        ) : admins.length === 0 ? (
          <p className="manage-admins__empty">No admin accounts found.</p>
        ) : (
          <div className="manage-admins__list">
            {admins.map((admin) => (
              <div key={admin.id} className="manage-admins__card">
                <div className="manage-admins__card-info">
                  <p className="manage-admins__name">
                    {admin.name || admin.email}
                    {admin.is_super_admin && (
                      <span className="manage-admins__super-tag"><ShieldCheck size={12} /> Super Admin</span>
                    )}
                  </p>
                  <p className="manage-admins__email">{admin.email}</p>
                  {admin.whatsapp && <p className="manage-admins__whatsapp">WhatsApp: {admin.whatsapp}</p>}

                  {editingId === admin.id ? (
                    <div className="manage-admins__edit-block">
                      <div className="manage-admins__form-row">
                        <input
                          placeholder="Full name"
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        />
                        <input
                          type="email"
                          placeholder="Email"
                          value={editForm.email}
                          onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                        />
                        <div className="manage-admins__password-wrap">
                          <input
                            type={showPassword ? "text" : "password"}
                            placeholder="New password (leave blank to keep unchanged)"
                            value={editForm.password}
                            onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                          />
                          <button type="button" onClick={() => setShowPassword((s) => !s)} className="manage-admins__eye">
                            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                        <input
                          placeholder="WhatsApp (03XXXXXXXXX)"
                          value={editForm.whatsapp}
                          onChange={(e) => setEditForm((f) => ({ ...f, whatsapp: e.target.value }))}
                        />
                      </div>

                      <div className="manage-admins__field-label">Allowed Tabs</div>
                      <div className="manage-admins__chip-row">
                        {PERMISSION_KEYS.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => setEditForm((f) => ({ ...f, permissions: toggleValue(f.permissions, p.id) }))}
                            className={"manage-admins__chip " + (editForm.permissions.includes(p.id) ? "manage-admins__chip--active" : "")}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <div className="manage-admins__field-label">Allowed Classes/Programs</div>
                      <div className="manage-admins__chip-row">
                        {PROGRAMS.map((program) => (
                          <button
                            type="button"
                            key={program}
                            onClick={() => setEditForm((f) => ({ ...f, allowedPrograms: toggleValue(f.allowedPrograms, program) }))}
                            className={"manage-admins__chip " + (editForm.allowedPrograms.includes(program) ? "manage-admins__chip--active" : "")}
                          >
                            {program}
                          </button>
                        ))}
                      </div>
                      <div className="manage-admins__edit-actions">
                        <button onClick={() => saveEdit(admin)} disabled={savingEditId === admin.id} className="manage-admins__save-btn">
                          <Save size={13} /> {savingEditId === admin.id ? "Saving..." : "Save"}
                        </button>
                        <button onClick={() => { setEditingId(null); setEditForm(null); }} className="manage-admins__cancel-btn">
                          <X size={13} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="manage-admins__tags">
                        {admin.is_super_admin ? (
                          <span className="manage-admins__tag">All tabs</span>
                        ) : admin.permissions.length === 0 ? (
                          <span className="manage-admins__tag manage-admins__tag--muted">No tabs assigned</span>
                        ) : (
                          admin.permissions.map((perm) => <span key={perm} className="manage-admins__tag">{perm}</span>)
                        )}
                      </div>
                      <div className="manage-admins__tags">
                        {admin.is_super_admin || admin.allowed_programs.length === 0 ? (
                          <span className="manage-admins__tag manage-admins__tag--muted">All programs</span>
                        ) : (
                          admin.allowed_programs.map((program) => <span key={program} className="manage-admins__tag">{program}</span>)
                        )}
                      </div>
                    </>
                  )}
                </div>

                {!admin.is_super_admin && editingId !== admin.id && (
                  <div className="manage-admins__card-actions">
                    <button onClick={() => startEdit(admin)} className="manage-admins__edit-btn">Edit</button>
                    <button onClick={() => handleResetPassword(admin)} className="manage-admins__edit-btn">
                      <KeyRound size={13} /> Reset Password
                    </button>
                    <button onClick={() => sendCredentials(admin)} className="manage-admins__whatsapp-btn">
                      <MessageCircle size={13} /> Send WhatsApp
                    </button>
                    {admin.user_id !== adminProfile?.user_id && (
                      <button onClick={() => handleDelete(admin)} className="manage-admins__delete-btn">
                        <Trash2 size={13} /> Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
