import { useState, useRef } from "react";
import { ArrowLeft, CheckCircle, FileCheck, Upload, User } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./AdmissionPage.css";

const DOCS_BASE = [
  { key: "bformDoc", label: "B-Form", required: true },
  { key: "fatherIdDoc", label: "Father's ID Card (NIC)", required: true },
  { key: "marksheet", label: "Matric Marksheet", required: true },
];

const GROUPS = {
  "Pre-Engineering": ["Physics", "Chemistry", "Mathematics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "Pre-Medical": ["Physics", "Chemistry", "Biology", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "ICS": ["Computer Science", "Mathematics", "Physics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "General Science": ["Mathematics", "Economics", "Computer Science", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
  "Humanities": ["Education", "Sociology", "Civics", "English", "Urdu", "Islamiat", "Tarjama Tul Quran"],
};

const BOARDS = [
  "BISE Rawalpindi","BISE Lahore","BISE Gujranwala","BISE Sargodha","BISE Faisalabad",
  "BISE Multan","BISE Bahawalpur","BISE DG Khan","BISE Sahiwal","Federal Board (FBISE)",
  "BISE Karachi","BISE Hyderabad","BISE Sukkur","BISE Larkana","BISE Mirpurkhas",
  "BISE Peshawar","BISE Mardan","BISE Abbottabad","BISE Swat","BISE Kohat",
  "BISE Bannu","BISE DI Khan","BISE Malakand","BISE Quetta",
  "BISE Mirpur (AJK)","BISE Muzaffarabad (AJK)","BISE Gilgit Baltistan","Other",
];

const RELIGIONS = ["Islam", "Christianity", "Hinduism", "Other"];
const NATIONALITIES = ["Pakistani", "Other"];

function SectionHeading({ number, title }) {
  return (
    <div className="ap-section-heading">
      <span className="ap-section-num">{number}</span>
      <h3>{title}</h3>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="ap-field">
      <label className="ap-label">{label}</label>
      {children}
      {error && <p className="ap-error">{error}</p>}
    </div>
  );
}

export default function AdmissionPage({ onBack }) {
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [files, setFiles] = useState({});
  const [activeDoc, setActiveDoc] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [group, setGroup] = useState("");
  const [selectedBoard, setSelectedBoard] = useState("");

  // ✅ CHANGE 1: yearOfStudy added to form state
  const [form, setForm] = useState({
    name: "", father: "", dob: "", bform: "", fatherCnic: "",
    nationality: "", religion: "", orphan: "no", fatherOccupation: "",
    monthlyIncome: "", familyMembers: "", financialAssistance: "no",
    phone1: "", phone2: "", whatsapp: "", email: "", address: "",
    sscRollNo: "", sscRegNo: "", marksObtained: "", totalMarks: "",
    percentage: "", sscGroup: "", yearOfStudy: "1st Year",
  });
  const [errors, setErrors] = useState({});

  const photoRef = useRef();
  const fileRefs = useRef({});

  const docsOtherBoard = [
    { key: "noc", label: "NOC from Board", required: true },
    { key: "verifiedMarksheet", label: `Matric Marksheet Photocopy (Verified by ${selectedBoard || "Relevant Board"})`, required: true },
  ];

  const activeDocs = [
    ...DOCS_BASE,
    ...(selectedBoard && selectedBoard !== "BISE Rawalpindi" ? docsOtherBoard : []),
  ];

  const up = (field) => (e) => {
    const val = e.target.value;
    setForm((p) => {
      const updated = { ...p, [field]: val };
      if (field === "marksObtained" || field === "totalMarks") {
        const obt = field === "marksObtained" ? val : p.marksObtained;
        const tot = field === "totalMarks" ? val : p.totalMarks;
        if (obt && tot && parseFloat(tot) > 0)
          updated.percentage = ((parseFloat(obt) / parseFloat(tot)) * 100).toFixed(1);
        else updated.percentage = "";
      }
      return updated;
    });
  };

  const handlePhoto = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 20 * 1024) {
      setPhotoError(`Too large (${(f.size / 1024).toFixed(1)}KB). Max: 20KB`);
      return;
    }
    setPhotoError("");
    setPhoto(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const handleDocFile = (key) => (e) => {
    const f = e.target.files[0];
    if (f) { setFiles((p) => ({ ...p, [key]: f })); setActiveDoc(null); }
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.father.trim()) e.father = "Required";
    if (!form.dob) e.dob = "Required";
    if (!/^\d{5}-\d{7}-\d$/.test(form.bform)) e.bform = "Format: 12345-1234567-1";
    if (!/^\d{5}-\d{7}-\d$/.test(form.fatherCnic)) e.fatherCnic = "Format: 12345-1234567-1";
    if (!form.nationality) e.nationality = "Required";
    if (!form.religion) e.religion = "Required";
    if (!/^03\d{9}$/.test(form.phone1)) e.phone1 = "Format: 03XXXXXXXXX";
    if (!/^03\d{9}$/.test(form.whatsapp)) e.whatsapp = "Format: 03XXXXXXXXX";
    if (!form.address.trim()) e.address = "Required";
    if (!form.marksObtained) e.marksObtained = "Required";
    if (!form.totalMarks) e.totalMarks = "Required";
    if (!selectedBoard) e.board = "Required";
    if (!form.sscGroup) e.sscGroup = "Required";
    if (!group) e.group = "Select a group";
    if (!photo) e.photo = "Student photo is required";
    activeDocs.forEach((d) => {
      if (d.required && !files[d.key]) e[d.key] = "Required";
    });
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setLoading(true);
    setSubmitError("");

    const uploadedUrls = {};
    if (photo) {
      const path = `photos/${Date.now()}-photo-${photo.name}`;
      const { error: upErr } = await supabase.storage.from("admission-documents").upload(path, photo);
      if (upErr) { setSubmitError(`Photo upload failed: ${upErr.message}`); setLoading(false); return; }
      const { data: urlData } = supabase.storage.from("admission-documents").getPublicUrl(path);
      uploadedUrls.photo = urlData.publicUrl;
    }

    for (const doc of activeDocs) {
      const file = files[doc.key];
      if (!file) continue;
      const path = `docs/${Date.now()}-${doc.key}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("admission-documents").upload(path, file);
      if (upErr) { setSubmitError(`Upload failed (${doc.label}): ${upErr.message}`); setLoading(false); return; }
      const { data: urlData } = supabase.storage.from("admission-documents").getPublicUrl(path);
      uploadedUrls[doc.key] = urlData.publicUrl;
    }

    // ✅ CHANGE 2: year_of_study added to insert
    const { error } = await supabase.from("applications").insert({
      student_name: form.name,
      father_name: form.father,
      dob: form.dob,
      bform: form.bform,
      father_cnic: form.fatherCnic,
      nationality: form.nationality,
      religion: form.religion,
      orphan: form.orphan === "yes",
      father_occupation: form.fatherOccupation,
      monthly_income: form.monthlyIncome ? parseFloat(form.monthlyIncome) : null,
      family_members: form.familyMembers ? parseInt(form.familyMembers) : null,
      financial_assistance: form.financialAssistance === "yes",
      phone1: form.phone1,
      phone2: form.phone2,
      whatsapp: form.whatsapp,
      email: form.email,
      address: form.address,
      ssc_roll_no: form.sscRollNo,
      ssc_registration_no: form.sscRegNo,
      matric_marks_obtained: form.marksObtained ? parseFloat(form.marksObtained) : null,
      matric_total_marks: form.totalMarks ? parseFloat(form.totalMarks) : null,
      matric_percentage: form.percentage ? parseFloat(form.percentage) : null,
      board: selectedBoard,
      student_group: form.sscGroup,
      group_selected: group,
      year_of_study: form.yearOfStudy,
      photo_url: uploadedUrls.photo || null,
      bform_doc_url: uploadedUrls.bformDoc || null,
      father_id_doc_url: uploadedUrls.fatherIdDoc || null,
      marksheet_url: uploadedUrls.marksheet || null,
      noc_url: uploadedUrls.noc || null,
      verified_marksheet_url: uploadedUrls.verifiedMarksheet || null,
    });

    setLoading(false);
    if (error) { setSubmitError("Submission failed. Please try again or contact the office."); return; }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="ap-success-page">
        <div className="ap-success-card">
          <CheckCircle className="ap-success-icon" size={52} />
          <h2>Application Submitted ✅</h2>
          <p>Thank you! Your admission application has been successfully received by <strong>Community Model Girls College, Rawalpindi</strong>.</p>
          <p className="ap-success-note">You will be informed about your admission status and confirmation via <strong>WhatsApp or Email</strong> within 3–5 working days. Please ensure your phone and email are active.</p>
          <button onClick={onBack} className="ap-back-btn">Back to Website</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-page">
      <div className="ap-header">
        <button onClick={onBack} className="ap-header-back"><ArrowLeft size={18} /> Back to Website</button>
        <span className="ap-header-divider">|</span>
        <span className="ap-header-title">CMGC — Online Admission Form 2026</span>
      </div>

      <div className="ap-container">
        <div className="ap-card">

          <div className="ap-card-header">
            <div>
              <h1>Admission Application</h1>
              <p>Community Model Girls College, Rawalpindi</p>
            </div>
            <div className="ap-photo-wrap">
              <button onClick={() => photoRef.current?.click()} className="ap-photo-btn">
                {photoPreview
                  ? <img src={photoPreview} alt="Student" className="ap-photo-img" />
                  : <div className="ap-photo-placeholder"><User size={24} /><p>Photo</p></div>
                }
                <div className="ap-photo-overlay"><Upload size={16} /></div>
              </button>
              <input type="file" accept="image/*" ref={photoRef} onChange={handlePhoto} style={{ display: "none" }} />
              {photoError ? <p className="ap-photo-error">{photoError}</p> : <p className="ap-photo-hint">Max 20KB</p>}
              {photo && !photoError && <p className="ap-photo-ok">✓ Uploaded</p>}
              {errors.photo && <p className="ap-photo-error">{errors.photo}</p>}
            </div>
          </div>

          <div className="ap-notices">
            <div className="ap-notice ap-notice--red">
              <p className="ap-notice-title">⚠️ Important Notice</p>
              <p>Please fill this form carefully and ensure all information provided is <strong>accurate and correct</strong>. Any incorrect, false, or misleading information will be the <strong>sole responsibility of the student/guardian</strong>. The college reserves the right to cancel the admission at any stage if any discrepancy is found.</p>
            </div>
            <div className="ap-notice ap-notice--amber">
              <p className="ap-notice-title">📋 Please have the following documents ready:</p>
              <ul>
                <li>Student's recent passport-size photo with <strong>blue background</strong> (max 20KB)</li>
                <li>Student's <strong>B-Form</strong> (clear scan or photo)</li>
                <li>Father's / Guardian's <strong>CNIC</strong> (both sides)</li>
                <li>Matric / SSC <strong>Marksheet</strong> (original or attested copy)</li>
                <li><strong>NOC + Verified Marksheet</strong> (only if matric from board other than BISE Rawalpindi)</li>
              </ul>
            </div>
          </div>

          <div className="ap-form">

            {/* Section 1 */}
            <section className="ap-section">
              <SectionHeading number="1" title="Personal Information" />
              <div className="ap-grid">
                <Field label="Student Full Name *" error={errors.name}>
                  <input placeholder="As per Matric Marksheet" value={form.name} onChange={up("name")} className={errors.name ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Father's Full Name *" error={errors.father}>
                  <input placeholder="As per Matric Marksheet" value={form.father} onChange={up("father")} className={errors.father ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Date of Birth *" error={errors.dob}>
                  <input type="date" value={form.dob} onChange={up("dob")} className={errors.dob ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Student B-Form No. *" error={errors.bform}>
                  <input placeholder="12345-1234567-1" value={form.bform} onChange={up("bform")} className={errors.bform ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Father's NIC *" error={errors.fatherCnic}>
                  <input placeholder="12345-1234567-1" value={form.fatherCnic} onChange={up("fatherCnic")} className={errors.fatherCnic ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Nationality *" error={errors.nationality}>
                  <select value={form.nationality} onChange={up("nationality")} className={errors.nationality ? "ap-input ap-input--err" : "ap-input"}>
                    <option value="">Select</option>
                    {NATIONALITIES.map(n => <option key={n}>{n}</option>)}
                  </select>
                </Field>
                <Field label="Religion *" error={errors.religion}>
                  <select value={form.religion} onChange={up("religion")} className={errors.religion ? "ap-input ap-input--err" : "ap-input"}>
                    <option value="">Select</option>
                    {RELIGIONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="Father's Occupation">
                  <select value={form.fatherOccupation} onChange={up("fatherOccupation")} className="ap-input">
                    <option value="">Select</option>
                    <option>Government Employee</option>
                    <option>Private Employee</option>
                    <option>Self Employed / Business</option>
                    <option>Retired</option>
                    <option>Deceased</option>
                    <option>Other</option>
                  </select>
                </Field>
                <Field label="Monthly Income (Rs)">
                  <input type="number" placeholder="e.g. 50000" value={form.monthlyIncome} onChange={up("monthlyIncome")} className="ap-input" />
                </Field>
                <Field label="No. of Family Members">
                  <input type="number" placeholder="e.g. 6" value={form.familyMembers} onChange={up("familyMembers")} className="ap-input" />
                </Field>
                <Field label="Is Student Orphan?">
                  <div className="ap-radio-row">
                    <label><input type="radio" name="orphan" value="yes" checked={form.orphan === "yes"} onChange={up("orphan")} /> Yes</label>
                    <label><input type="radio" name="orphan" value="no" checked={form.orphan === "no"} onChange={up("orphan")} /> No</label>
                  </div>
                </Field>
                <Field label="Need Financial Assistance?">
                  <div className="ap-radio-row">
                    <label><input type="radio" name="financial" value="yes" checked={form.financialAssistance === "yes"} onChange={up("financialAssistance")} /> Yes</label>
                    <label><input type="radio" name="financial" value="no" checked={form.financialAssistance === "no"} onChange={up("financialAssistance")} /> No</label>
                  </div>
                </Field>
              </div>
            </section>

            {/* Section 2 */}
            <section className="ap-section">
              <SectionHeading number="2" title="Contact Information" />
              <div className="ap-grid">
                <Field label="Phone No. 1 *" error={errors.phone1}>
                  <input placeholder="03XXXXXXXXX" value={form.phone1} onChange={up("phone1")} className={errors.phone1 ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Phone No. 2">
                  <input placeholder="03XXXXXXXXX" value={form.phone2} onChange={up("phone2")} className="ap-input" />
                </Field>
                <Field label="WhatsApp No. *" error={errors.whatsapp}>
                  <input placeholder="03XXXXXXXXX" value={form.whatsapp} onChange={up("whatsapp")} className={errors.whatsapp ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Email Address">
                  <input placeholder="example@email.com" value={form.email} onChange={up("email")} className="ap-input" />
                </Field>
                <div className="ap-grid-full">
                  <Field label="Full Address *" error={errors.address}>
                    <textarea placeholder="House No., Street, Area, City" value={form.address} onChange={up("address")} rows={2} className={errors.address ? "ap-input ap-input--err" : "ap-input"} />
                  </Field>
                </div>
              </div>
            </section>

            {/* Section 3 */}
            <section className="ap-section">
              <SectionHeading number="3" title="SSC (Matric) Information" />
              <div className="ap-grid">
                <Field label="Roll No.">
                  <input placeholder="Matric Roll No." value={form.sscRollNo} onChange={up("sscRollNo")} className="ap-input" />
                </Field>
                <Field label="Registration No.">
                  <input placeholder="Board Registration No." value={form.sscRegNo} onChange={up("sscRegNo")} className="ap-input" />
                </Field>
                <Field label="Marks Obtained *" error={errors.marksObtained}>
                  <input type="number" placeholder="e.g. 950" value={form.marksObtained} onChange={up("marksObtained")} className={errors.marksObtained ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Total Marks *" error={errors.totalMarks}>
                  <input type="number" placeholder="e.g. 1100" value={form.totalMarks} onChange={up("totalMarks")} className={errors.totalMarks ? "ap-input ap-input--err" : "ap-input"} />
                </Field>
                <Field label="Percentage (%)">
                  <input type="number" placeholder="Auto calculated" value={form.percentage} readOnly className="ap-input ap-input--readonly" />
                </Field>
                <Field label="Board Name *" error={errors.board}>
                  <select value={selectedBoard} onChange={(e) => { setSelectedBoard(e.target.value); setFiles((p) => { const n = { ...p }; delete n.noc; delete n.verifiedMarksheet; return n; }); }} className={errors.board ? "ap-input ap-input--err" : "ap-input"}>
                    <option value="">Select Board</option>
                    {BOARDS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label="Subjects Group *" error={errors.sscGroup}>
                  <div className="ap-radio-row">
                    <label><input type="radio" name="sscGroup" value="Science" checked={form.sscGroup === "Science"} onChange={up("sscGroup")} /> Science</label>
                    <label><input type="radio" name="sscGroup" value="Arts" checked={form.sscGroup === "Arts"} onChange={up("sscGroup")} /> Arts</label>
                  </div>
                </Field>
              </div>
            </section>

            {/* Section 4 */}
            <section className="ap-section">
              <SectionHeading number="4" title="HSSC-I & II Admission" />
              <Field label="Select Group *" error={errors.group}>
                <div className="ap-group-btns">
                  {Object.keys(GROUPS).map((g) => (
                    <button key={g} type="button" onClick={() => setGroup(g)} className={`ap-group-btn ${group === g ? "ap-group-btn--active" : ""}`}>{g}</button>
                  ))}
                </div>
              </Field>
              {group && (
                <div className="ap-subjects">
                  <p>Subjects for <strong>{group}</strong>:</p>
                  <div className="ap-subject-tags">
                    {GROUPS[group].map((s) => <span key={s} className="ap-subject-tag">{s}</span>)}
                  </div>
                </div>
              )}

              {/* ✅ CHANGE 3: Year of Admission field */}
              <div style={{ marginTop: "16px" }}>
                <Field label="Year of Admission *">
                  <div className="ap-radio-row">
                    <label className="ap-radio">
                      <input
                        type="radio"
                        name="yearOfStudy"
                        value="1st Year"
                        checked={form.yearOfStudy === "1st Year"}
                        onChange={up("yearOfStudy")}
                      /> 1st Year
                    </label>
                    <label className="ap-radio">
                      <input
                        type="radio"
                        name="yearOfStudy"
                        value="2nd Year"
                        checked={form.yearOfStudy === "2nd Year"}
                        onChange={up("yearOfStudy")}
                      /> 2nd Year
                    </label>
                  </div>
                </Field>
              </div>
            </section>

            {/* Section 5 */}
            <section className="ap-section">
              <SectionHeading number="5" title="Document Upload" />
              {selectedBoard && selectedBoard !== "BISE Rawalpindi" && (
                <div className="ap-notice ap-notice--amber" style={{ marginBottom: 12 }}>
                  <p>Since you passed Matric from <strong>{selectedBoard}</strong>, you must also upload: <strong>NOC from your board</strong> and a <strong>Matric Marksheet photocopy verified by {selectedBoard}</strong>. Both are compulsory.</p>
                </div>
              )}
              {!selectedBoard && (
                <div className="ap-notice ap-notice--blue" style={{ marginBottom: 12 }}>
                  <p>Please select your <strong>Board Name</strong> in Section 3 first.</p>
                </div>
              )}
              <div className="ap-docs">
                {activeDocs.map((doc) => (
                  <div key={doc.key}>
                    <div className="ap-doc-row">
                      <div>
                        <p className="ap-doc-label">{doc.label} <span className={doc.required ? "ap-doc-req" : "ap-doc-opt"}>{doc.required ? "*" : "(Optional)"}</span></p>
                        {files[doc.key] && <p className="ap-doc-filename"><FileCheck size={12} /> {files[doc.key].name}</p>}
                        {errors[doc.key] && <p className="ap-error">{errors[doc.key]}</p>}
                      </div>
                      <button type="button" onClick={() => setActiveDoc(activeDoc === doc.key ? null : doc.key)} className={`ap-upload-btn ${files[doc.key] ? "ap-upload-btn--done" : ""}`}>
                        {files[doc.key] ? "✓ Change" : "Upload"}
                      </button>
                    </div>
                    {activeDoc === doc.key && (
                      <div className="ap-file-picker">
                        <p>Select file (Image or PDF):</p>
                        <input type="file" accept="image/*,.pdf" ref={(el) => (fileRefs.current[doc.key] = el)} onChange={handleDocFile(doc.key)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {submitError && <div className="ap-notice ap-notice--red"><p>{submitError}</p></div>}

            <button onClick={handleSubmit} disabled={loading} className="ap-submit">
              {loading ? "Submitting..." : "Submit Application"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}