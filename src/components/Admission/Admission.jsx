import { useState, useRef } from "react";
import { CheckCircle, AlertCircle, FileCheck } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./Admission.css";

const DOC_FIELDS = [
  { key: "photo", label: "Photo (Blue Background)", required: true },
  { key: "bformDoc", label: "B-Form", required: true },
  { key: "fatherIdDoc", label: "Father's ID Card (NIC)", required: true },
  { key: "marksheet", label: "Matric Marksheet", required: true },
  { key: "noc", label: "NOC from Board (Optional)", required: false },
];

const BOARDS = [
  "BISE Rawalpindi", "BISE Lahore", "BISE Gujranwala",
  "BISE Sargodha", "Federal Board (FBISE)", "Other",
];

const PROGRAMS = ["Pre-Engineering", "Pre-Medical", "ICS", "General Science", "Humanities"];

export default function Admission() {
  const [form, setForm] = useState({
    name: "", father: "", dob: "", fatherCnic: "", bform: "",
    phone1: "", phone2: "", whatsapp: "", email: "", address: "",
    program: "", board: "", matricMarks: "", group: "",
  });
  const [files, setFiles] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileRefs = useRef({});

  const idFormat = /^\d{5}-\d{7}-\d$/;
  const phoneFormat = /^03\d{9}$/;

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Student name is required";
    if (!form.father.trim()) e.father = "Father's name is required";
    if (!form.dob) e.dob = "Date of birth is required";
    if (!idFormat.test(form.fatherCnic)) e.fatherCnic = "Format: 12345-1234567-1";
    if (!idFormat.test(form.bform)) e.bform = "Format: 12345-1234567-1";
    if (!phoneFormat.test(form.phone1)) e.phone1 = "Format: 03XXXXXXXXX";
    if (!phoneFormat.test(form.phone2)) e.phone2 = "Format: 03XXXXXXXXX";
    if (!phoneFormat.test(form.whatsapp)) e.whatsapp = "Format: 03XXXXXXXXX";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Enter a valid email";
    if (!form.address.trim()) e.address = "Address is required";
    if (!form.program) e.program = "Select a program";
    if (!form.board) e.board = "Select a board";
    if (!form.matricMarks || form.matricMarks < 0 || form.matricMarks > 100) e.matricMarks = "Enter marks between 0-100";
    if (!form.group) e.group = "Select a group";
    DOC_FIELDS.forEach((d) => {
      if (d.required && !files[d.key]) e[d.key] = "This document is required";
    });
    return e;
  };

  const handleFileChange = (key) => (ev) => {
    const f = ev.target.files[0];
    if (f) setFiles((prev) => ({ ...prev, [key]: f }));
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setLoading(true);
    setSubmitError("");

    const uploadedUrls = {};
    for (const doc of DOC_FIELDS) {
      const file = files[doc.key];
      if (!file) continue;
      const filePath = `${Date.now()}-${doc.key}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("admission-documents").upload(filePath, file);
      if (uploadError) {
        setSubmitError(`File upload failed (${doc.label}): ${uploadError.message}`);
        setLoading(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("admission-documents").getPublicUrl(filePath);
      uploadedUrls[doc.key] = urlData.publicUrl;
    }

    const { error } = await supabase.from("applications").insert({
      student_name: form.name,
      father_name: form.father,
      dob: form.dob,
      father_cnic: form.fatherCnic,
      bform: form.bform,
      phone1: form.phone1,
      phone2: form.phone2,
      whatsapp: form.whatsapp,
      email: form.email,
      address: form.address,
      program: form.program,
      board: form.board,
      matric_marks: form.matricMarks,
      student_group: form.group,
      photo_url: uploadedUrls.photo || null,
      bform_doc_url: uploadedUrls.bformDoc || null,
      father_id_doc_url: uploadedUrls.fatherIdDoc || null,
      marksheet_url: uploadedUrls.marksheet || null,
      noc_url: uploadedUrls.noc || null,
    });

    setLoading(false);

    if (error) {
      console.error(error);
      setSubmitError("Something went wrong while submitting. Please try again or contact the office.");
      return;
    }

    setSubmitted(true);
  };

  const update = (field) => (ev) => setForm({ ...form, [field]: ev.target.value });
  const cls = (field) => (errors[field] ? "admission__input--error" : "");

  if (submitted) {
    return (
      <section id="admission" className="admission">
        <div className="admission__success">
          <CheckCircle className="admission__success-icon" size={48} />
          <h3>Application Submitted ✅</h3>
          <p>Thank you, {form.name}. Your application for {form.program} has been received and saved.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="admission" className="admission">
      <div className="admission__container">
        <h2 className="admission__heading">Online Admission Form</h2>
        <p className="admission__subheading">Admissions Open for Session 2026</p>
        <div className="admission__form">

          <div className="admission__row">
            <div className="admission__field">
              <input placeholder="Student Name" value={form.name} onChange={update("name")} className={cls("name")} />
              {errors.name && <p className="admission__error">{errors.name}</p>}
            </div>
            <div className="admission__field">
              <input placeholder="Father's Name" value={form.father} onChange={update("father")} className={cls("father")} />
              {errors.father && <p className="admission__error">{errors.father}</p>}
            </div>
          </div>

          <div className="admission__row">
            <div className="admission__field">
              <label className="admission__label">Date of Birth</label>
              <input type="date" value={form.dob} onChange={update("dob")} className={cls("dob")} />
              {errors.dob && <p className="admission__error">{errors.dob}</p>}
            </div>
            <div className="admission__field">
              <input placeholder="Father's NIC (12345-1234567-1)" value={form.fatherCnic} onChange={update("fatherCnic")} className={cls("fatherCnic")} />
              {errors.fatherCnic && <p className="admission__error">{errors.fatherCnic}</p>}
            </div>
          </div>

          <div className="admission__field">
            <input placeholder="Student B-Form Number (12345-1234567-1)" value={form.bform} onChange={update("bform")} className={cls("bform")} />
            {errors.bform && <p className="admission__error">{errors.bform}</p>}
          </div>

          <div className="admission__row admission__row--three">
            <div className="admission__field">
              <input placeholder="Phone No 1 (03XXXXXXXXX)" value={form.phone1} onChange={update("phone1")} className={cls("phone1")} />
              {errors.phone1 && <p className="admission__error">{errors.phone1}</p>}
            </div>
            <div className="admission__field">
              <input placeholder="Phone No 2 (03XXXXXXXXX)" value={form.phone2} onChange={update("phone2")} className={cls("phone2")} />
              {errors.phone2 && <p className="admission__error">{errors.phone2}</p>}
            </div>
            <div className="admission__field">
              <input placeholder="WhatsApp No (03XXXXXXXXX)" value={form.whatsapp} onChange={update("whatsapp")} className={cls("whatsapp")} />
              {errors.whatsapp && <p className="admission__error">{errors.whatsapp}</p>}
            </div>
          </div>

          <div className="admission__field">
            <input placeholder="Email Address" value={form.email} onChange={update("email")} className={cls("email")} />
            {errors.email && <p className="admission__error">{errors.email}</p>}
          </div>

          <div className="admission__field">
            <textarea placeholder="Full Address" value={form.address} onChange={update("address")} className={cls("address")} rows={2} />
            {errors.address && <p className="admission__error">{errors.address}</p>}
          </div>

          <div className="admission__row">
            <div className="admission__field">
              <select value={form.program} onChange={update("program")} className={cls("program")}>
                <option value="">Select Program</option>
                {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
              </select>
              {errors.program && <p className="admission__error">{errors.program}</p>}
            </div>
            <div className="admission__field">
              <select value={form.board} onChange={update("board")} className={cls("board")}>
                <option value="">Select Board</option>
                {BOARDS.map((b) => <option key={b}>{b}</option>)}
              </select>
              {errors.board && <p className="admission__error">{errors.board}</p>}
            </div>
          </div>

          <div className="admission__row">
            <div className="admission__field">
              <input type="number" placeholder="Matric Marks (%)" value={form.matricMarks} onChange={update("matricMarks")} className={cls("matricMarks")} />
              {errors.matricMarks && <p className="admission__error">{errors.matricMarks}</p>}
            </div>
            <div className="admission__field">
              <label className="admission__label">Group</label>
              <div className="admission__radio-row">
                <label className="admission__radio">
                  <input type="radio" name="group" value="Science" checked={form.group === "Science"} onChange={update("group")} /> Science
                </label>
                <label className="admission__radio">
                  <input type="radio" name="group" value="Arts" checked={form.group === "Arts"} onChange={update("group")} /> Arts
                </label>
              </div>
              {errors.group && <p className="admission__error">{errors.group}</p>}
            </div>
          </div>

          <div className="admission__upload">
            <p className="admission__upload-title">Document Upload</p>
            <div className="admission__upload-list">
              {DOC_FIELDS.map((doc) => (
                <div key={doc.key} className="admission__upload-item">
                  <span>
                    {doc.label}
                    {files[doc.key] && (
                      <span className="admission__upload-filename"><FileCheck size={13} /> {files[doc.key].name}</span>
                    )}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    ref={(el) => (fileRefs.current[doc.key] = el)}
                    onChange={handleFileChange(doc.key)}
                    style={{ display: "none" }}
                  />
                  <button type="button" className="admission__upload-btn" onClick={() => fileRefs.current[doc.key]?.click()}>
                    {files[doc.key] ? "Change" : "Choose File"}
                  </button>
                </div>
              ))}
            </div>
            {DOC_FIELDS.map((doc) => errors[doc.key] && (
              <p key={doc.key} className="admission__error">{doc.label}: {errors[doc.key]}</p>
            ))}
          </div>

          {submitError && (
            <p className="admission__error admission__error--banner"><AlertCircle size={14} /> {submitError}</p>
          )}

          <button className="admission__submit" onClick={handleSubmit} disabled={loading}>
            {loading ? "Submitting..." : "Submit Application"}
          </button>
        </div>
      </div>
    </section>
  );
}