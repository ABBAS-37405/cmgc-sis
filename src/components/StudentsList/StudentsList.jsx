import { useState, useEffect } from "react";
import { Search, Eye, CheckCircle, XCircle, Clock } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./StudentsList.css";

export default function StudentsList() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetchApplications();
  }, []);

  const fetchApplications = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setApplications(data);
    setLoading(false);
  };

  const updateStatus = async (id, status) => {
    await supabase.from("applications").update({ status }).eq("id", id);
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
    if (selected?.id === id) setSelected((p) => ({ ...p, status }));
  };

  const filtered = applications.filter((a) =>
    a.student_name?.toLowerCase().includes(search.toLowerCase()) ||
    a.program?.toLowerCase().includes(search.toLowerCase()) ||
    a.phone1?.includes(search)
  );

  const statusBadge = (status) => {
    if (status === "Approved") return <span className="students-list__badge students-list__badge--approved"><CheckCircle size={11} /> Approved</span>;
    if (status === "Rejected") return <span className="students-list__badge students-list__badge--rejected"><XCircle size={11} /> Rejected</span>;
    return <span className="students-list__badge students-list__badge--pending"><Clock size={11} /> Pending</span>;
  };

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
      <div className="students-list__toolbar">
        <div className="students-list__search">
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, program, phone..." />
        </div>
        <div className="students-list__counts">
          <span className="students-list__badge students-list__badge--pending"><Clock size={11} /> {applications.filter(a => a.status === "Pending").length} Pending</span>
          <span className="students-list__badge students-list__badge--approved"><CheckCircle size={11} /> {applications.filter(a => a.status === "Approved").length} Approved</span>
          <span className="students-list__badge students-list__badge--rejected"><XCircle size={11} /> {applications.filter(a => a.status === "Rejected").length} Rejected</span>
        </div>
      </div>

      {loading ? (
        <div className="students-list__loading">Loading applications...</div>
      ) : filtered.length === 0 ? (
        <div className="students-list__empty">No applications found</div>
      ) : (
        <div className="students-list__table-wrap">
          <table className="students-list__table">
            <thead>
              <tr><th>Name</th><th>Program</th><th>Group</th><th>Board</th><th>Phone</th><th>Date</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
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
  );
}