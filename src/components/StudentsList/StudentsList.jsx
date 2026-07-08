import { useState, useEffect } from "react";
import { Search, Eye, CheckCircle, XCircle, Clock, Plus, X, Save } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./StudentsList.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];

export default function StudentsList() {
  const [applications, setApplications] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("applications");
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    roll_no: "", name: "", father_name: "", program: "Pre-Medical", phone: "", password: "",
  });
  const [formError, setFormError] = useState("");

  useEffect(() => {
    fetchApplications();
    fetchStudents();
  }, []);

  const fetchApplications = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setApplications(data);
    setLoading(false);
  };

  const fetchStudents = async () => {
    const { data } = await supabase
      .from("students")
      .select("*")
      .order("name");
    if (data) setStudents(data);
  };

  const updateStatus = async (id, status) => {
    await supabase.from("applications").update({ status }).eq("id", id);
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
    if (selected?.id === id) setSelected((p) => ({ ...p, status }));
  };

  const addStudent = async () => {
    setFormError("");
    if (!form.roll_no.trim()) return setFormError("Roll number is required");
    if (!form.name.trim()) return setFormError("Name is required");
    if (!form.password.trim()) return setFormError("Password is required");
    if (form.password.length < 6) return setFormError("Password must be at least 6 characters");

    setSaving(true);
    const { error } = await supabase.from("students").insert({
      roll_no: form.roll_no,
      name: form.name,
      father_name: form.father_name,
      program: form.program,
      phone: form.phone,
      password: form.password,
    });
    setSaving(false);

    if (error) {
      if (error.code === "23505") setFormError("Roll number already exists");
      else setFormError("Error saving student: " + error.message);
      return;
    }

    setSaved(true);
    setForm({ roll_no: "", name: "", father_name: "", program: "Pre-Medical", phone: "", password: "" });
    fetchStudents();
    setTimeout(() => setSaved(false), 3000);
  };

  const deleteStudent = async (id) => {
    if (!window.confirm("Are you sure you want to delete this student?")) return;
    await supabase.from("students").delete().eq("id", id);
    setStudents((p) => p.filter((s) => s.id !== id));
  };

  const statusBadge = (status) => {
    if (status === "Approved") return <span className="students-list__badge students-list__badge--approved"><CheckCircle size={11} /> Approved</span>;
    if (status === "Rejected") return <span className="students-list__badge students-list__badge--rejected"><XCircle size={11} /> Rejected</span>;
    return <span className="students-list__badge students-list__badge--pending"><Clock size={11} /> Pending</span>;
  };

  const filteredApps = applications.filter((a) =>
    a.student_name?.toLowerCase().includes(search.toLowerCase()) ||
    a.program?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredStudents = students.filter((s) =>
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.roll_no?.includes(search) ||
    s.program?.toLowerCase().includes(search.toLowerCase())
  );

  // Application Detail View
  if (selected) {
    return (
      <div className="students-list">
        <button onClick={() => setSelected(null)} className="students-list__back">← Back to List</button>
        <div className="students-list__detail">
          <div className="students-list__detail-header">
            <div>
              <h2>{selected.student_name}</h2>
              <p>{selected.program} — {selected.group_selected}</p>
            </div>
            {statusBadge(selected.status)}
          </div>
          <div className="students-list__detail-grid">
            <div className="students-list__detail-section">
              <h3>Personal Information</h3>
              <p><span>Father's Name</span><strong>{selected.father_name}</strong></p>
              <p><span>Date of Birth</span><strong>{selected.dob}</strong></p>
              <p><span>B-Form</span><strong>{selected.bform}</strong></p>
              <p><span>Father's NIC</span><strong>{selected.father_cnic}</strong></p>
              <p><span>Nationality</span><strong>{selected.nationality}</strong></p>
              <p><span>Religion</span><strong>{selected.religion}</strong></p>
              <p><span>Orphan</span><strong>{selected.orphan ? "Yes" : "No"}</strong></p>
              <p><span>Father's Occupation</span><strong>{selected.father_occupation}</strong></p>
              <p><span>Monthly Income</span><strong>Rs {selected.monthly_income}</strong></p>
              <p><span>Family Members</span><strong>{selected.family_members}</strong></p>
              <p><span>Financial Assistance</span><strong>{selected.financial_assistance ? "Yes" : "No"}</strong></p>
            </div>
            <div className="students-list__detail-section">
              <h3>Contact Information</h3>
              <p><span>Phone 1</span><strong>{selected.phone1}</strong></p>
              <p><span>Phone 2</span><strong>{selected.phone2}</strong></p>
              <p><span>WhatsApp</span><strong>{selected.whatsapp}</strong></p>
              <p><span>Email</span><strong>{selected.email}</strong></p>
              <p><span>Address</span><strong>{selected.address}</strong></p>
            </div>
            <div className="students-list__detail-section">
              <h3>SSC Information</h3>
              <p><span>Roll No</span><strong>{selected.ssc_roll_no}</strong></p>
              <p><span>Reg No</span><strong>{selected.ssc_registration_no}</strong></p>
              <p><span>Marks Obtained</span><strong>{selected.matric_marks_obtained}</strong></p>
              <p><span>Total Marks</span><strong>{selected.matric_total_marks}</strong></p>
              <p><span>Percentage</span><strong>{selected.matric_percentage}%</strong></p>
              <p><span>Board</span><strong>{selected.board}</strong></p>
              <p><span>Group</span><strong>{selected.student_group}</strong></p>
            </div>
            <div className="students-list__detail-section">
              <h3>Documents</h3>
              {selected.photo_url && <a href={selected.photo_url} target="_blank" rel="noopener noreferrer" className="students-list__doc-link">📷 Student Photo</a>}
              {selected.bform_doc_url && <a href={selected.bform_doc_url} target="_blank" rel="noopener noreferrer" className="students-list__doc-link">📄 B-Form</a>}
              {selected.father_id_doc_url && <a href={selected.father_id_doc_url} target="_blank" rel="noopener noreferrer" className="students-list__doc-link">📄 Father's NIC</a>}
              {selected.marksheet_url && <a href={selected.marksheet_url} target="_blank" rel="noopener noreferrer" className="students-list__doc-link">📄 Marksheet</a>}
              {selected.noc_url && <a href={selected.noc_url} target="_blank" rel="noopener noreferrer" className="students-list__doc-link">📄 NOC</a>}
              {selected.verified_marksheet_url && <a href={selected.verified_marksheet_url} target="_blank" rel="noopener noreferrer" className="students-list__doc-link">📄 Verified Marksheet</a>}
            </div>
          </div>
          {selected.status === "Pending" && (
            <div className="students-list__actions">
              <button onClick={() => updateStatus(selected.id, "Approved")} className="students-list__approve">✓ Approve Application</button>
              <button onClick={() => updateStatus(selected.id, "Rejected")} className="students-list__reject">✗ Reject Application</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="students-list">
      {/* Tabs */}
      <div className="students-list__tabs">
        <button onClick={() => setActiveTab("applications")} className={`students-list__tab ${activeTab === "applications" ? "students-list__tab--active" : ""}`}>
          Applications ({applications.length})
        </button>
        <button onClick={() => setActiveTab("students")} className={`students-list__tab ${activeTab === "students" ? "students-list__tab--active" : ""}`}>
          Enrolled Students ({students.length})
        </button>
      </div>

      {/* Applications Tab */}
      {activeTab === "applications" && (
        <div className="students-list">
          <div className="students-list__toolbar">
            <div className="students-list__search">
              <Search size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or program..." />
            </div>
            <div className="students-list__counts">
              <span className="students-list__badge students-list__badge--pending"><Clock size={11} /> {applications.filter(a => a.status === "Pending").length} Pending</span>
              <span className="students-list__badge students-list__badge--approved"><CheckCircle size={11} /> {applications.filter(a => a.status === "Approved").length} Approved</span>
              <span className="students-list__badge students-list__badge--rejected"><XCircle size={11} /> {applications.filter(a => a.status === "Rejected").length} Rejected</span>
            </div>
          </div>
          {loading ? (
            <div className="students-list__loading">Loading applications...</div>
          ) : filteredApps.length === 0 ? (
            <div className="students-list__empty">No applications found</div>
          ) : (
            <div className="students-list__table-wrap">
              <table className="students-list__table">
                <thead>
                  <tr><th>Name</th><th>Program</th><th>Group</th><th>Board</th><th>Phone</th><th>Date</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredApps.map((a) => (
                    <tr key={a.id}>
                      <td className="students-list__name">{a.student_name}</td>
                      <td>{a.program}</td>
                      <td>{a.group_selected}</td>
                      <td>{a.board}</td>
                      <td>{a.phone1}</td>
                      <td>{new Date(a.created_at).toLocaleDateString()}</td>
                      <td>{statusBadge(a.status)}</td>
                      <td>
                        <button onClick={() => setSelected(a)} className="students-list__view">
                          <Eye size={14} /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Enrolled Students Tab */}
      {activeTab === "students" && (
        <div className="students-list">
          <div className="students-list__toolbar">
            <div className="students-list__search">
              <Search size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, roll no, program..." />
            </div>
            <button onClick={() => setShowAddForm(!showAddForm)} className="students-list__add">
              {showAddForm ? <><X size={15} /> Cancel</> : <><Plus size={15} /> Add Student</>}
            </button>
          </div>

          {/* Add Student Form */}
          {showAddForm && (
            <div className="students-list__add-form">
              <h3>Add New Student</h3>
              <div className="students-list__add-grid">
                <div className="students-list__add-field">
                  <label>Roll Number *</label>
                  <input placeholder="e.g. CMGC-2026-001" value={form.roll_no} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} />
                </div>
                <div className="students-list__add-field">
                  <label>Student Name *</label>
                  <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="students-list__add-field">
                  <label>Father's Name</label>
                  <input placeholder="Father's name" value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} />
                </div>
                <div className="students-list__add-field">
                  <label>Program *</label>
                  <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}>
                    {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="students-list__add-field">
                  <label>Phone</label>
                  <input placeholder="03XXXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="students-list__add-field">
                  <label>Login Password *</label>
                  <input type="password" placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
              </div>
              {formError && <p className="students-list__form-error">{formError}</p>}
              {saved && <p className="students-list__form-success">✓ Student added successfully!</p>}
              <button onClick={addStudent} disabled={saving} className="students-list__save-btn">
                <Save size={15} /> {saving ? "Saving..." : "Save Student"}
              </button>
            </div>
          )}

          {/* Students Table */}
          {filteredStudents.length === 0 ? (
            <div className="students-list__empty">No enrolled students found</div>
          ) : (
            <div className="students-list__table-wrap">
              <table className="students-list__table">
                <thead>
                  <tr><th>Roll No</th><th>Name</th><th>Father's Name</th><th>Program</th><th>Phone</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.id}>
                      <td>{s.roll_no}</td>
                      <td className="students-list__name">{s.name}</td>
                      <td>{s.father_name}</td>
                      <td>{s.program}</td>
                      <td>{s.phone}</td>
                      <td>
                        <button onClick={() => deleteStudent(s.id)} className="students-list__delete">
                          <X size={14} /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}