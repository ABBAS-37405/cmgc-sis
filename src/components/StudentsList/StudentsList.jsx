import { useState, useEffect } from "react";
import { Search, Eye, CheckCircle, XCircle, Clock, Plus, X, Save, DollarSign, ArrowLeft } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./StudentsList.css";

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];
const ADMISSION_FEE = 12500;
const FEE_AMOUNTS = {
  "Pre-Engineering": 3000,
  "Pre-Medical": 3000,
  "ICS": 3000,
  "General Science": 3000,
  "Humanities": 2500,
};

const normalizeWhatsAppNumber = (value) => {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return `+${digits}`;
  if (digits.startsWith("0")) return `+92${digits.slice(1)}`;
  return `+${digits}`;
};

const buildCredentialsMessage = (studentName, rollNo, password) => {
  return [
    `Assalamualaikum ${studentName},`,
    "",
    "Your CMGC student portal credentials are ready.",
    "",
    `Student ID: ${rollNo}`,
    `Password: ${password}`,
    "",
    "Please use these details to login to the CMGC portal.",
    "Thank you.",
  ].join("\n");
};

const shareCredentials = (application, rollNo, password) => {
  let email = (application?.email || "").trim();
  let whatsapp = (application?.whatsapp || "").trim();

  if (!email && !whatsapp) {
    const enteredEmail = window.prompt("Student email is missing. Enter an email address to receive the credentials:", "");
    if (enteredEmail && enteredEmail.trim()) {
      email = enteredEmail.trim();
    }
    const enteredWhatsApp = window.prompt("Student WhatsApp number is missing. Enter a WhatsApp number (03XXXXXXXXX):", "");
    if (enteredWhatsApp && enteredWhatsApp.trim()) {
      whatsapp = enteredWhatsApp.trim();
    }
  }

  if (!email && !whatsapp) {
    alert("Please provide at least one contact detail (email or WhatsApp) before sending credentials.");
    return false;
  }

  const body = encodeURIComponent(buildCredentialsMessage(application?.student_name || "Student", rollNo, password));

  if (email) {
    const mailto = `mailto:${email}?subject=${encodeURIComponent("CMGC Student Portal Credentials")}&body=${body}`;
    window.open(mailto, "_blank", "noopener,noreferrer");
  }

  if (whatsapp) {
    const normalized = normalizeWhatsAppNumber(whatsapp);
    const waUrl = `https://wa.me/${normalized.replace("+", "")}?text=${body}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  return true;
};

export default function StudentsList() {
  const [applications, setApplications] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("applications");
  const [yearFilter, setYearFilter] = useState("Both");
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    roll_no: "", name: "", father_name: "", program: "Pre-Medical",
    phone: "", password: "", year_of_study: "1st Year",
  });
  const [formError, setFormError] = useState("");
  const [showFeeModal, setShowFeeModal] = useState(null);
  const [feeAmount, setFeeAmount] = useState("");
  const [feeDueDate, setFeeDueDate] = useState("");
  const [allocating, setAllocating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showAdmissionFeeModal, setShowAdmissionFeeModal] = useState(false);
  const [admissionFeeConfirmed, setAdmissionFeeConfirmed] = useState(false);

  useEffect(() => {
    fetchApplications();
    fetchStudents();
    const now = new Date();
    const due = new Date(now.getFullYear(), now.getMonth() + 1, 28);
    setFeeDueDate(due.toISOString().split("T")[0]);
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

  const handleApprove = () => {
    setAdmissionFeeConfirmed(false);
    setShowAdmissionFeeModal(true);
  };

  const doApprove = async () => {
    if (!selected) return;
    setApproving(true);
    setShowAdmissionFeeModal(false);

    const { error: appError } = await supabase
      .from("applications")
      .update({ status: "Approved" })
      .eq("id", selected.id);

    if (appError) {
      alert("Failed to update application: " + appError.message);
      setApproving(false);
      return;
    }

    const { count } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true });
    const year = new Date().getFullYear();
    const rollNo = "CMGC-" + year + "-" + String(Date.now()).slice(-5);
    const defaultPassword = selected.bform
      ? selected.bform.replace(/-/g, "").slice(-6)
      : "cmgc123";

    const { data: newStudent, error: studentError } = await supabase
      .from("students")
      .insert({
        roll_no: rollNo,
        name: selected.student_name,
        father_name: selected.father_name,
        program: selected.group_selected || selected.program,
        phone: selected.phone1,
        password: defaultPassword,
        cnic: selected.bform,
        year_of_study: selected.year_of_study || "1st Year",
      })
      .select()
      .single();

    if (studentError) {
      alert("Student enroll failed: " + studentError.message);
      setApproving(false);
      return;
    }

    if (newStudent) {
      const admDue = new Date();
      admDue.setDate(admDue.getDate() + 7);
      const { error: feeError } = await supabase.from("fees").insert({
        student_id: newStudent.id,
        program: selected.group_selected || selected.program,
        amount_due: ADMISSION_FEE,
        due_date: admDue.toISOString().split("T")[0],
        status: "Unpaid",
      });
      if (feeError) alert("Fee allocation failed: " + feeError.message);

      const credentialsShared = shareCredentials(selected, rollNo, defaultPassword);
      if (!credentialsShared) {
        setApproving(false);
        setAdmissionFeeConfirmed(false);
        return;
      }

      const updatedApp = { ...selected, status: "Approved" };
      setApplications((prev) => prev.map((a) => a.id === selected.id ? updatedApp : a));
      setSelected(updatedApp);
      await fetchStudents();

      alert(
        "Student Enrolled Successfully!\n\n" +
        "Name: " + selected.student_name + "\n" +
        "Roll No: " + rollNo + "\n" +
        "Year: " + (selected.year_of_study || "1st Year") + "\n" +
        "Password: " + defaultPassword + "\n" +
        "Admission Fee Due: Rs " + ADMISSION_FEE.toLocaleString() + "\n\n" +
        "The login credentials were prepared for delivery via email or WhatsApp."
      );
    }

    setApproving(false);
    setAdmissionFeeConfirmed(false);
  };

  const handleReject = async () => {
    if (!selected) return;
    if (!window.confirm("Are you sure you want to reject this application?")) return;
    const { error } = await supabase
      .from("applications")
      .update({ status: "Rejected" })
      .eq("id", selected.id);
    if (error) { alert("Error: " + error.message); return; }
    const updatedApp = { ...selected, status: "Rejected" };
    setApplications((prev) => prev.map((a) => a.id === selected.id ? updatedApp : a));
    setSelected(updatedApp);
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
      year_of_study: form.year_of_study,
    });
    setSaving(false);
    if (error) {
      if (error.code === "23505") setFormError("Roll number already exists");
      else setFormError("Error: " + error.message);
      return;
    }
    setSaved(true);
    setForm({ roll_no: "", name: "", father_name: "", program: "Pre-Medical", phone: "", password: "", year_of_study: "1st Year" });
    fetchStudents();
    setTimeout(() => setSaved(false), 3000);
  };

  const openFeeModal = (student) => {
    setShowFeeModal(student);
    setFeeAmount(String(FEE_AMOUNTS[student.program] || 3000));
    const now = new Date();
    const due = new Date(now.getFullYear(), now.getMonth() + 1, 28);
    setFeeDueDate(due.toISOString().split("T")[0]);
  };

  const allocateFee = async () => {
    if (!feeAmount || !feeDueDate) return alert("Please fill all fee fields");
    setAllocating(true);
    const { error } = await supabase.from("fees").insert({
      student_id: showFeeModal.id,
      program: showFeeModal.program,
      amount_due: parseFloat(feeAmount),
      due_date: feeDueDate,
      status: "Unpaid",
    });
    setAllocating(false);
    if (error) alert("Error: " + error.message);
    else { alert("Fee allocated for " + showFeeModal.name); setShowFeeModal(null); }
  };

  const changeYear = async (student, newYear) => {
    const confirmed = window.confirm(
      "Confirm year change for " + student.name + "?\n" +
      "Current: " + (student.year_of_study || "1st Year") + "\n" +
      "New: " + newYear
    );
    if (!confirmed) return;
    const { error } = await supabase
      .from("students")
      .update({ year_of_study: newYear })
      .eq("id", student.id);
    if (error) { alert("Error: " + error.message); return; }
    setStudents((prev) =>
      prev.map((s) => s.id === student.id ? { ...s, year_of_study: newYear } : s)
    );
  };

  const statusBadge = (status) => {
    if (status === "Approved") return <span className="sl-badge sl-badge--approved"><CheckCircle size={12} /> Approved</span>;
    if (status === "Rejected") return <span className="sl-badge sl-badge--rejected"><XCircle size={12} /> Rejected</span>;
    return <span className="sl-badge sl-badge--pending"><Clock size={12} /> Pending</span>;
  };

  const Row = ({ label, value }) => (
    <div className="sl-detail-row">
      <span className="sl-detail-label">{label}</span>
      <span className="sl-detail-value">{value || "—"}</span>
    </div>
  );

  const ApproveSection = () => (
    <div className="sl-detail-actions">
      <div className="sl-fee-notice">
        <DollarSign size={16} />
        <p>Admission fee of <strong>Rs {ADMISSION_FEE.toLocaleString()}</strong> must be collected before approving.</p>
      </div>
      <div className="sl-action-btns">
        <button onClick={handleReject} className="sl-reject-btn">
          <XCircle size={16} /> Reject Application
        </button>
        <button onClick={handleApprove} disabled={approving} className="sl-approve-btn">
          <CheckCircle size={16} /> {approving ? "Processing..." : "Approve & Enroll"}
        </button>
      </div>
    </div>
  );

  const normalizedYear = (value) => value || "1st Year";

  const filteredApps = applications.filter((a) => {
    const matchesSearch =
      a.student_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.program?.toLowerCase().includes(search.toLowerCase()) ||
      a.phone1?.includes(search);
    const matchesYear = yearFilter === "Both" || normalizedYear(a.year_of_study) === yearFilter;
    return matchesSearch && matchesYear;
  });

  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.name?.toLowerCase().includes(search.toLowerCase()) ||
      s.roll_no?.includes(search) ||
      s.program?.toLowerCase().includes(search.toLowerCase());
    const matchesYear = yearFilter === "Both" || normalizedYear(s.year_of_study) === yearFilter;
    return matchesSearch && matchesYear;
  });

  // Application Detail View
  if (selected) {
    return (
      <div className="sl-detail-page">
        {showAdmissionFeeModal && (
          <div className="sl-modal-overlay">
            <div className="sl-modal">
              <h3>Confirm Admission Fee Receipt</h3>
              <div className="sl-modal-fee-box">
                <p>Student: <strong>{selected.student_name}</strong></p>
                <p>Year: <strong>{selected.year_of_study || "1st Year"}</strong></p>
                <p>Admission Fee: <strong>Rs {ADMISSION_FEE.toLocaleString()}</strong></p>
              </div>
              <label className="sl-modal-check">
                <input
                  type="checkbox"
                  checked={admissionFeeConfirmed}
                  onChange={(e) => setAdmissionFeeConfirmed(e.target.checked)}
                />
                I confirm that Rs {ADMISSION_FEE.toLocaleString()} admission fee has been received.
              </label>
              <div className="sl-modal-actions">
                <button onClick={() => { setShowAdmissionFeeModal(false); setAdmissionFeeConfirmed(false); }} className="sl-modal-cancel">Cancel</button>
                <button onClick={doApprove} disabled={!admissionFeeConfirmed || approving} className="sl-modal-save">
                  <CheckCircle size={14} /> {approving ? "Enrolling..." : "Approve & Enroll"}
                </button>
              </div>
            </div>
          </div>
        )}

        <button onClick={() => setSelected(null)} className="sl-back-btn">
          <ArrowLeft size={16} /> Back to Applications
        </button>

        <div className="sl-detail-card">
          <div className="sl-detail-header">
            <div>
              <h2>{selected.student_name}</h2>
              <p>{selected.group_selected || selected.program} — {selected.year_of_study || "1st Year"}</p>
              <p className="sl-detail-date">
                Applied: {new Date(selected.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
            {statusBadge(selected.status)}
          </div>

          <div className="sl-detail-sections">
            <div className="sl-detail-section">
              <h3>Personal Information</h3>
              <Row label="Student Name" value={selected.student_name} />
              <Row label="Father's Name" value={selected.father_name} />
              <Row label="Date of Birth" value={selected.dob} />
              <Row label="B-Form No." value={selected.bform} />
              <Row label="Father's NIC" value={selected.father_cnic} />
              <Row label="Nationality" value={selected.nationality} />
              <Row label="Religion" value={selected.religion} />
              <Row label="Orphan" value={selected.orphan ? "Yes" : "No"} />
              <Row label="Father's Occupation" value={selected.father_occupation} />
              <Row label="Monthly Income" value={selected.monthly_income ? "Rs " + selected.monthly_income : null} />
              <Row label="Family Members" value={selected.family_members} />
              <Row label="Financial Assistance" value={selected.financial_assistance ? "Required" : "Not Required"} />
            </div>
            <div className="sl-detail-section">
              <h3>Contact Information</h3>
              <Row label="Phone 1" value={selected.phone1} />
              <Row label="Phone 2" value={selected.phone2} />
              <Row label="WhatsApp" value={selected.whatsapp} />
              <Row label="Email" value={selected.email} />
              <Row label="Address" value={selected.address} />
            </div>
            <div className="sl-detail-section">
              <h3>SSC (Matric) Information</h3>
              <Row label="Roll No." value={selected.ssc_roll_no} />
              <Row label="Registration No." value={selected.ssc_registration_no} />
              <Row label="Marks Obtained" value={selected.matric_marks_obtained} />
              <Row label="Total Marks" value={selected.matric_total_marks} />
              <Row label="Percentage" value={selected.matric_percentage ? selected.matric_percentage + "%" : null} />
              <Row label="Board" value={selected.board} />
              <Row label="Group" value={selected.student_group} />
            </div>
            <div className="sl-detail-section">
              <h3>HSSC-I Admission</h3>
              <Row label="Program" value={selected.program} />
              <Row label="Group Selected" value={selected.group_selected} />
              <Row label="Year of Admission" value={selected.year_of_study || "1st Year"} />
              
            </div>
            <div className="sl-detail-section">
              <h3>Uploaded Documents</h3>
              {selected.photo_url && <a href={selected.photo_url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📷 Student Photo</a>}
              {selected.bform_doc_url && <a href={selected.bform_doc_url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📄 B-Form</a>}
              {selected.father_id_doc_url && <a href={selected.father_id_doc_url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📄 Father NIC</a>}
              {selected.marksheet_url && <a href={selected.marksheet_url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📄 Matric Marksheet</a>}
              {selected.noc_url && <a href={selected.noc_url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📄 NOC</a>}
              {selected.verified_marksheet_url && <a href={selected.verified_marksheet_url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📄 Verified Marksheet</a>}
              {!selected.photo_url && !selected.bform_doc_url && !selected.father_id_doc_url && !selected.marksheet_url && (
                <p className="sl-no-docs">No documents uploaded</p>
              )}
            </div>
          </div>

          {selected.status === "Pending" && <ApproveSection />}
          {selected.status === "Approved" && (
            <div className="sl-already-approved">
              <CheckCircle size={18} /> Student has been enrolled successfully.
            </div>
          )}
          {selected.status === "Rejected" && (
            <div>
              <div className="sl-already-rejected">
                <XCircle size={18} /> This application was rejected.
              </div>
              <ApproveSection />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sl-wrap">
      {/* Fee Allocation Modal */}
      {showFeeModal && (
        <div className="sl-modal-overlay">
          <div className="sl-modal">
            <div className="sl-modal-header-row">
              <h3>Allocate Monthly Fee</h3>
              <button onClick={() => setShowFeeModal(null)}><X size={18} /></button>
            </div>
            <p className="sl-modal-info">Student: <strong>{showFeeModal.name}</strong> ({showFeeModal.roll_no})</p>
            <p className="sl-modal-info">Program: <strong>{showFeeModal.program}</strong></p>
            <p className="sl-modal-info">Year: <strong>{showFeeModal.year_of_study || "1st Year"}</strong></p>
            <div className="sl-modal-field">
              <label>Fee Amount (Rs) *</label>
              <input type="number" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} />
            </div>
            <div className="sl-modal-field">
              <label>Due Date *</label>
              <input type="date" value={feeDueDate} onChange={(e) => setFeeDueDate(e.target.value)} />
            </div>
            <div className="sl-modal-actions">
              <button onClick={() => setShowFeeModal(null)} className="sl-modal-cancel">Cancel</button>
              <button onClick={allocateFee} disabled={allocating} className="sl-modal-save">
                <DollarSign size={14} /> {allocating ? "Allocating..." : "Allocate Fee"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="sl-tabs">
        <button onClick={() => setActiveTab("applications")} className={"sl-tab " + (activeTab === "applications" ? "sl-tab--active" : "")}>
          Applications ({applications.length})
        </button>
        <button onClick={() => setActiveTab("students")} className={"sl-tab " + (activeTab === "students" ? "sl-tab--active" : "")}>
          Enrolled Students ({students.length})
        </button>
      </div>

      {/* Toolbar */}
      <div className="sl-toolbar">
        <div className="sl-search">
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." />
        </div>
        <div className="sl-year-filters" role="group" aria-label="Filter by class year">
          <button onClick={() => setYearFilter("1st Year")} className={"sl-year-btn " + (yearFilter === "1st Year" ? "sl-year-btn--active" : "")}>1st Year</button>
          <button onClick={() => setYearFilter("2nd Year")} className={"sl-year-btn " + (yearFilter === "2nd Year" ? "sl-year-btn--active" : "")}>2nd Year</button>
          <button onClick={() => setYearFilter("Both")} className={"sl-year-btn " + (yearFilter === "Both" ? "sl-year-btn--active" : "")}>Both</button>
        </div>
        {activeTab === "applications" && (
          <div className="sl-counts">
            <span className="sl-badge sl-badge--pending"><Clock size={11} /> {applications.filter(a => a.status === "Pending").length} Pending</span>
            <span className="sl-badge sl-badge--approved"><CheckCircle size={11} /> {applications.filter(a => a.status === "Approved").length} Approved</span>
            <span className="sl-badge sl-badge--rejected"><XCircle size={11} /> {applications.filter(a => a.status === "Rejected").length} Rejected</span>
          </div>
        )}
        {activeTab === "students" && (
          <button onClick={() => setShowAddForm(!showAddForm)} className="sl-add-btn">
            {showAddForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Student</>}
          </button>
        )}
      </div>

      {/* Applications Tab */}
      {activeTab === "applications" && (
        loading ? <p className="sl-empty">Loading...</p> :
        filteredApps.length === 0 ? <p className="sl-empty">No applications found</p> :
        <div className="sl-table-wrap">
          <table className="sl-table">
            <thead>
              <tr><th>Name</th><th>Group</th><th>Year</th><th>Board</th><th>Phone</th><th>Date</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filteredApps.map((a) => (
                <tr key={a.id}>
                  <td className="sl-name">{a.student_name}</td>
                  <td>{a.group_selected}</td>
                  <td>{a.year_of_study || "1st Year"}</td>
                  <td>{a.board}</td>
                  <td>{a.phone1}</td>
                  <td>{new Date(a.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</td>
                  <td>{statusBadge(a.status)}</td>
                  <td><button onClick={() => { setSearch(""); setSelected(a); }} className="sl-view-btn"><Eye size={14} /> View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Students Tab */}
      {activeTab === "students" && (
        <div>
          {showAddForm && (
            <div className="sl-add-form">
              <h3>Add New Student</h3>
              <div className="sl-add-grid">
                <div className="sl-add-field"><label>Roll Number *</label><input placeholder="e.g. CMGC-2026-001" value={form.roll_no} onChange={(e) => setForm({ ...form, roll_no: e.target.value })} /></div>
                <div className="sl-add-field"><label>Student Name *</label><input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="sl-add-field"><label>Father's Name</label><input placeholder="Father's name" value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} /></div>
                <div className="sl-add-field">
                  <label>Program *</label>
                  <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}>
                    {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="sl-add-field"><label>Phone</label><input placeholder="03XXXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="sl-add-field"><label>Login Password *</label><input type="password" placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div className="sl-add-field">
                  <label>Year of Study *</label>
                  <select value={form.year_of_study} onChange={(e) => setForm({ ...form, year_of_study: e.target.value })}>
                    <option>1st Year</option>
                    <option>2nd Year</option>
                  </select>
                </div>
              </div>
              {formError && <p className="sl-form-error">{formError}</p>}
              {saved && <p className="sl-form-success">Student added successfully!</p>}
              <button onClick={addStudent} disabled={saving} className="sl-save-btn">
                <Save size={14} /> {saving ? "Saving..." : "Save Student"}
              </button>
            </div>
          )}

          {filteredStudents.length === 0 ?
            <p className="sl-empty">No enrolled students found</p> :
            <div className="sl-table-wrap">
              <table className="sl-table">
                <thead>
                  <tr><th>Roll No</th><th>Name</th><th>Father</th><th>Program</th><th>Year</th><th>Phone</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.id}>
                      <td>{s.roll_no}</td>
                      <td className="sl-name">{s.name}</td>
                      <td>{s.father_name}</td>
                      <td>{s.program}</td>
                      <td>
                        <select
                          value={s.year_of_study || "1st Year"}
                          onChange={(e) => changeYear(s, e.target.value)}
                          className="sl-year-select"
                        >
                          <option>1st Year</option>
                          <option>2nd Year</option>
                        </select>
                      </td>
                      <td>{s.phone}</td>
                      <td>
                        <button onClick={() => openFeeModal(s)} className="sl-fee-btn">
                          <DollarSign size={13} /> Fee
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </div>
      )}
    </div>
  );
}