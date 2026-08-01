// The full student record, described once.
//
// The admin's "Further Entry" form and the read-only detail view are both built
// from this, so a field added here appears in both without touching either
// screen. Keys match the `students` columns exactly (supabase_student_details.sql).

export const BOARDS = [
  "BISE Rawalpindi", "BISE Lahore", "BISE Gujranwala", "BISE Sargodha", "BISE Faisalabad",
  "BISE Multan", "BISE Bahawalpur", "BISE DG Khan", "BISE Sahiwal", "Federal Board (FBISE)",
  "BISE Karachi", "BISE Hyderabad", "BISE Sukkur", "BISE Larkana", "BISE Mirpurkhas",
  "BISE Peshawar", "BISE Mardan", "BISE Abbottabad", "BISE Swat", "BISE Kohat",
  "BISE Bannu", "BISE DI Khan", "BISE Malakand", "BISE Quetta",
  "BISE Mirpur (AJK)", "BISE Muzaffarabad (AJK)", "BISE Gilgit Baltistan", "Other",
];

export const RELIGIONS = ["Islam", "Christianity", "Hinduism", "Other"];
export const NATIONALITIES = ["Pakistani", "Other"];
export const SSC_GROUPS = ["Science", "Arts"];

/** Everything the admin must fill in — the rest of the form is optional. */
export const REQUIRED_KEYS = ["roll_no", "name", "program", "year_of_study", "password"];

export const DETAIL_GROUPS = [
  {
    title: "Contact",
    fields: [
      { key: "whatsapp", label: "WhatsApp No.", placeholder: "03XXXXXXXXX" },
      { key: "phone2", label: "Alternate Phone", placeholder: "03XXXXXXXXX" },
      { key: "email", label: "Email", type: "email", placeholder: "example@email.com" },
      { key: "address", label: "Full Address", type: "textarea", placeholder: "House No., Street, Area, City", wide: true },
    ],
  },
  {
    title: "Personal",
    fields: [
      { key: "dob", label: "Date of Birth", type: "date" },
      { key: "father_cnic", label: "Father's NIC", placeholder: "12345-1234567-1" },
      { key: "nationality", label: "Nationality", type: "select", options: NATIONALITIES },
      { key: "religion", label: "Religion", type: "select", options: RELIGIONS },
      { key: "orphan", label: "Orphan", type: "boolean" },
    ],
  },
  {
    title: "Family & Finance",
    fields: [
      { key: "father_occupation", label: "Father's Occupation" },
      { key: "monthly_income", label: "Monthly Income", type: "number", placeholder: "e.g. 50000" },
      { key: "family_members", label: "Family Members", type: "number", placeholder: "e.g. 6" },
      { key: "financial_assistance", label: "Needs Financial Assistance", type: "boolean" },
    ],
  },
  {
    title: "Matric Record",
    fields: [
      { key: "ssc_roll_no", label: "Matric Roll No." },
      { key: "ssc_registration_no", label: "Board Registration No." },
      { key: "student_group", label: "Matric Group", type: "select", options: SSC_GROUPS },
      { key: "board", label: "Board", type: "select", options: BOARDS },
      { key: "matric_marks_obtained", label: "Marks Obtained", type: "number", placeholder: "e.g. 950" },
      { key: "matric_total_marks", label: "Total Marks", type: "number", placeholder: "e.g. 1100" },
      { key: "matric_percentage", label: "Percentage", type: "number", readOnly: true, hint: "Calculated" },
    ],
  },
];

/** Uploadable documents. `profile_picture_url` is handled by its own Picture button. */
export const DOCUMENT_FIELDS = [
  { key: "bform_doc_url", label: "B-Form" },
  { key: "father_id_doc_url", label: "Father's NIC" },
  { key: "marksheet_url", label: "Matric Marksheet" },
  { key: "noc_url", label: "NOC from Board" },
  { key: "verified_marksheet_url", label: "Verified Marksheet" },
];

export const ALL_DETAIL_KEYS = DETAIL_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

/** Empty values for every detail field, so the form is never uncontrolled. */
export function blankDetails() {
  const out = {};
  for (const group of DETAIL_GROUPS) {
    for (const f of group.fields) out[f.key] = f.type === "boolean" ? false : "";
  }
  return out;
}

/** Pull the detail fields off a student row into form-ready strings. */
export function detailsFrom(student) {
  const out = blankDetails();
  if (!student) return out;
  for (const key of ALL_DETAIL_KEYS) {
    const v = student[key];
    out[key] = v === null || v === undefined ? out[key] : v;
  }
  return out;
}

/**
 * Turn the form values back into a row the database accepts: empty strings
 * become null so a blank optional field is stored as "not provided" rather than
 * as an empty string, and numbers/booleans get their real types.
 */
export function detailsToRow(values) {
  const row = {};
  for (const group of DETAIL_GROUPS) {
    for (const f of group.fields) {
      const raw = values[f.key];
      if (f.type === "boolean") row[f.key] = Boolean(raw);
      else if (f.type === "number") row[f.key] = raw === "" || raw === null ? null : Number(raw);
      else row[f.key] = String(raw ?? "").trim() || null;
    }
  }
  return row;
}

export function matricPercentage(obtained, total) {
  const o = Number(obtained);
  const t = Number(total);
  if (!o || !t || t <= 0) return "";
  return ((o / t) * 100).toFixed(1);
}
