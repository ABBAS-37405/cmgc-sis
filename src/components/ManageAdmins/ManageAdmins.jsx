import { useState, useEffect } from "react";
import { Plus, Trash2, Save, X, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PERMISSION_KEYS, PROGRAMS, createSubAdmin, deleteSubAdmin } from "../../lib/adminAuth";
import "./ManageAdmins.css";

const emptyForm = { name: "", email: "", password: "", permissions: [], allowedPrograms: [] };

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
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

    setCreating(true);
    try {
      await createSubAdmin({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim(),
        permissions: form.permissions,
        allowedPrograms: form.allowedPrograms,
      });
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
    setEditForm({ permissions: [...admin.permissions], allowedPrograms: [...admin.allowed_programs] });
  };

  const saveEdit = async (admin) => {
    setSavingEditId(admin.id);
    const { error: updateError } = await supabase
      .from("admin_profiles")
      .update({ permissions: editForm.permissions, allowed_programs: editForm.allowedPrograms })
      .eq("id", admin.id);
    setSavingEditId(null);
    if (updateError) {
      alert("Failed to update permissions: " + updateError.message);
      return;
    }
    setEditingId(null);
    setEditForm(null);
    await fetchAdmins();
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

                  {editingId === admin.id ? (
                    <div className="manage-admins__edit-block">
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
