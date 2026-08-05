import { useState, useEffect } from "react";
import { Search, Eye, CheckCircle, XCircle, Clock, Plus, X, Save, DollarSign, ArrowLeft, Trash2, Image as ImageIcon } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { PROGRAMS, combinationsFor, formatCombination, groupHasChoice } from "../../lib/academics";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import { findBFormClash, describeUniqueViolation, isValidBForm, formatBForm } from "../../lib/bform";
import StudentDetail from "../StudentDetail/StudentDetail";
import EditRequests from "../EditRequests/EditRequests";
import { DETAIL_GROUPS, blankDetails, detailsToRow, matricPercentage } from "../../lib/studentFields";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber } from "../../lib/whatsapp";
import { fetchFeePlans, findPlan, buildFeeRows } from "../../lib/feePlans";
import "./StudentsList.css";

// Used only until the fee_plans rows load, or if a group has no plan yet.
// The real amounts live in the fee_plans table and are edited from Fee Settings.
const FALLBACK_ADMISSION_FEE = 4000;
const FALLBACK_MONTHLY_FEE = 3000;

const DOCUMENTS = [
  { key: "photo", label: "Student Photo", urlField: "photo_url" },
  { key: "bform", label: "B-Form", urlField: "bform_doc_url" },
  { key: "father_id", label: "Father NIC", urlField: "father_id_doc_url" },
  { key: "marksheet", label: "Matric Marksheet", urlField: "marksheet_url" },
  { key: "noc", label: "NOC", urlField: "noc_url" },
  { key: "verified_marksheet", label: "Verified Marksheet", urlField: "verified_marksheet_url" },
];

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

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.46 0 .09 5.37.09 11.95c0 2.11.55 4.09 1.51 5.81L0 24l6.4-1.68a11.86 11.86 0 0 0 5.64 1.43h.01c6.58 0 11.95-5.37 11.95-11.95 0-3.19-1.24-6.19-3.48-8.32ZM12.05 21.3h-.01a9.3 9.3 0 0 1-4.74-1.3l-.34-.2-3.53.93.94-3.44-.22-.35a9.3 9.3 0 0 1-1.43-4.99c0-5.14 4.19-9.33 9.34-9.33 2.49 0 4.83.97 6.59 2.73a9.26 9.26 0 0 1 2.73 6.6c0 5.15-4.19 9.35-9.33 9.35Zm5.34-6.98c-.29-.15-1.72-.85-1.99-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.3-.36.45-.54.15-.18.2-.31.3-.51.1-.2.05-.37-.03-.51-.08-.15-.6-1.46-.82-2-.22-.53-.44-.46-.6-.47-.16-.01-.34-.01-.52-.01-.18 0-.47.07-.72.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.13 2.86.14.18 1.86 2.84 4.5 3.87 2.65 1.03 2.65.69 3.12.64.47-.05 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.24-.16-.53-.31Z" />
    </svg>
  );
}

const buildRejectionMessage = (studentName, rejectedDocLabels) => {
  return [
    `Assalamualaikum ${studentName},`,
    "",
    "We regret to inform you that your admission application has NOT been approved.",
    "",
    "Reason for rejection:",
    ...rejectedDocLabels.map((label) => `- ${label} is incorrect/invalid`),
    "",
    "Please fill the application form again and re-upload all required documents, especially correcting the rejected document(s) mentioned above, so that your application can be approved.",
    "",
    "Thank you.",
  ].join("\n");
};

const sendRejectionNotice = (application, message, waWindowRef) => {
  let email = (application?.email || "").trim();
  let whatsapp = (application?.whatsapp || "").trim();

  if (!email && !whatsapp) {
    if (waWindowRef && !waWindowRef.closed) waWindowRef.close();
    alert("No contact details found on this application to notify the student about the rejection.");
    return false;
  }

  const body = encodeURIComponent(message);

  if (email) {
    const mailto = `mailto:${email}?subject=${encodeURIComponent("CMGC Admission Application - Rejected")}&body=${body}`;
    window.open(mailto, "_blank", "noopener,noreferrer");
  }

  if (whatsapp) {
    openWhatsApp(whatsapp, message, waWindowRef);
  } else if (waWindowRef && !waWindowRef.closed) {
    waWindowRef.close();
  }

  return true;
};

const sendStudentCredentialsWhatsApp = (student) => {
  // Her WhatsApp number, not her phone: the two are often different and a
  // landline-style phone may have no WhatsApp on it at all.
  let number = whatsappNumberFor(student);
  if (!isValidWhatsAppNumber(number)) {
    const entered = window.prompt(
      `WhatsApp number for ${student?.name || "this student"} is missing or invalid. Enter one (03XXXXXXXXX):`,
      number || ""
    );
    if (!entered || !entered.trim()) return;
    number = entered.trim();
  }
  openWhatsApp(number, buildCredentialsMessage(student?.name || "Student", student?.roll_no, student?.password));
};

const shareCredentials = (application, rollNo, password, waWindowRef) => {
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
    if (waWindowRef && !waWindowRef.closed) waWindowRef.close();
    alert("Please provide at least one contact detail (email or WhatsApp) before sending credentials.");
    return false;
  }

  const body = encodeURIComponent(buildCredentialsMessage(application?.student_name || "Student", rollNo, password));

  if (email) {
    const mailto = `mailto:${email}?subject=${encodeURIComponent("CMGC Student Portal Credentials")}&body=${body}`;
    window.open(mailto, "_blank", "noopener,noreferrer");
  }

  if (whatsapp) {
    openWhatsApp(whatsapp, buildCredentialsMessage(application?.student_name || "Student", rollNo, password), waWindowRef);
  } else if (waWindowRef && !waWindowRef.closed) {
    waWindowRef.close();
  }

  return true;
};

export default function StudentsList({ allowedPrograms = [], adminProfile = null }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

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
    roll_no: "", name: "", father_name: "", cnic: "",
    program: isRestricted ? (visiblePrograms[0] || "Pre-Medical") : "Pre-Medical",
    comboIndex: isRestricted ? (groupHasChoice(visiblePrograms[0] || "Pre-Medical") ? null : 0) : 0,
    phone: "", whatsapp: "", password: "", year_of_study: "1st Year",
    ...blankDetails(),
  });

  const updateForm = (updates) => {
    if (updates.program) {
      const nextProgram = updates.program;
      const nextComboIndex = groupHasChoice(nextProgram) ? null : 0;
      setForm((prev) => ({ ...prev, ...updates, program: nextProgram, comboIndex: nextComboIndex }));
      return;
    }
    setForm((prev) => ({ ...prev, ...updates }));
  };
  // The optional half of the form stays folded away until the admin asks for it.
  const [showFurther, setShowFurther] = useState(false);
  const [detailStudent, setDetailStudent] = useState(null);   // { student, edit }
  // Owned by the EditRequests tab; kept here only to badge the tab button.
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [profileImage, setProfileImage] = useState(null);
  const [profileImagePreview, setProfileImagePreview] = useState(null);
  const [formError, setFormError] = useState("");
  const [showFeeModal, setShowFeeModal] = useState(null);
  const [feeAmount, setFeeAmount] = useState("");
  const [feeDueDate, setFeeDueDate] = useState("");
  const [showPictureModal, setShowPictureModal] = useState(null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [pictureTempImage, setPictureTempImage] = useState(null);
  const [pictureTempPreview, setPictureTempPreview] = useState(null);
  const [allocating, setAllocating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showAdmissionFeeModal, setShowAdmissionFeeModal] = useState(false);
  const [admissionFeeConfirmed, setAdmissionFeeConfirmed] = useState(false);
  const [docReview, setDocReview] = useState({});
  const [rejecting, setRejecting] = useState(false);
  const [feePlans, setFeePlans] = useState([]);
  const [deletedApps, setDeletedApps] = useState([]);
  const [deletedStudents, setDeletedStudents] = useState([]);
  const [busyRow, setBusyRow] = useState(null);

  // The plan that applies to the application currently open for review — drives
  // the admission-fee figure shown in the confirmation modal and the WhatsApp
  // message, so those can never drift from what is actually charged.
  const selectedProgram = selected?.group_selected || selected?.program;
  const selectedYear = selected?.year_of_study || "1st Year";
  const activePlan = findPlan(feePlans, selectedYear, selectedProgram);
  const admissionFee = Number(activePlan?.admission_fee ?? FALLBACK_ADMISSION_FEE);

  // Every list below filters on deleted_at: a deleted row must vanish from both
  // the Applications and Enrolled tabs, and appear only in Deleted Items.
  const fetchApplications = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("applications")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (data) setApplications(data);
    setLoading(false);
  };

  /* ---------- Bulk promotion / passout helpers ---------- */
  const markSecondYearPassout = async () => {
    if (!adminProfile?.is_super_admin) { alert('Only a super admin may mark passout.'); return; }
    if (!window.confirm('Are you sure? This will mark all current 2nd Year students as passout and archive them.')) return;
    setBusyRow('passout');
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('students')
      .update({ is_passout: true, passout_at: now, deleted_at: now })
      .eq('year_of_study', '2nd Year')
      .is('deleted_at', null)
      .select('id');
    setBusyRow(null);
    if (error) {
      alert('Failed to mark passout: ' + error.message);
      return;
    }
    await Promise.all([fetchStudents(), fetchDeleted(), fetchPendingRequestCount()]);
    alert((data || []).length + ' students marked as passout and archived.');
  };

  const promoteFirstYearToSecond = async () => {
    if (!adminProfile?.is_super_admin) { alert('Only a super admin may perform bulk promotions.'); return; }
    if (!window.confirm('Are you sure? This will promote all 1st Year students to 2nd Year if no active 2nd Year students remain.')) return;
    setBusyRow('promote');
    const { count: open2Count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('year_of_study', '2nd Year')
      .is('deleted_at', null)
      .not('is_passout', 'is', true);
    if (open2Count && open2Count > 0) {
      setBusyRow(null);
      alert('Cannot promote: there are still ' + open2Count + ' active 2nd Year students. Mark them passout first.');
      return;
    }

    const { data, error } = await supabase
      .from('students')
      .update({ year_of_study: '2nd Year' })
      .eq('year_of_study', '1st Year')
      .is('deleted_at', null)
      .select('id');
    setBusyRow(null);
    if (error) {
      alert('Failed to promote students: ' + error.message);
      return;
    }
    await Promise.all([fetchStudents(), fetchPendingRequestCount()]);
    alert((data || []).length + ' students promoted to 2nd Year.');
  };

  const fetchStudents = async () => {
    const { data } = await supabase
      .from("students")
      .select("*")
      .is("deleted_at", null)
      .order("name");
    if (data) setStudents(data);
  };

  const fetchDeleted = async () => {
    const [apps, studs] = await Promise.all([
      supabase.from("applications").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
      supabase.from("students").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
    ]);
    setDeletedApps(apps.data || []);
    setDeletedStudents(studs.data || []);
  };

  // Just the number, so the tab can carry a badge without loading the tab.
  // RLS already limits a sub-admin to her own programs.
  const fetchPendingRequestCount = async () => {
    const { count } = await supabase
      .from("profile_edit_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "Pending");
    setPendingRequestCount(count || 0);
  };

  useEffect(() => {
    fetchApplications();
    fetchStudents();
    fetchDeleted();
    fetchPendingRequestCount();
    // Non-fatal: enrolment falls back to the constants above if this fails.
    fetchFeePlans().then(setFeePlans).catch(() => setFeePlans([]));
    const now = new Date();
    const due = new Date(now.getFullYear(), now.getMonth() + 1, 28);
    setFeeDueDate(due.toISOString().split("T")[0]);
  }, []);

  /* ---------- Recycle bin ---------- */
  // Soft delete: stamp deleted_at. The row keeps its status and every linked
  // record, so restoring puts it back exactly where it was.
  const softDelete = async (table, row, name) => {
    const label = table === "applications" ? "application" : "enrolled student";
    if (!adminProfile?.is_super_admin) {
      alert('Only a super admin may delete records.');
      return;
    }
    if (!window.confirm(
      `Delete the ${label} "${name}"?\n\n` +
      "It will move to the Deleted Items tab and disappear from this list. " +
      "Nothing is erased — you can restore it from there at any time."
    )) return;

    setBusyRow(row.id);
    const { data: hit, error } = await supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", row.id)
      .select("id");
    setBusyRow(null);

    if (error) {
      alert("Could not delete: " + error.message);
      return;
    }
    if (!hit || hit.length === 0) {
      alert(WRITE_BLOCKED_HINT);
      return;
    }
    if (selected?.id === row.id) setSelected(null);
    await Promise.all([fetchApplications(), fetchStudents(), fetchDeleted()]);
  };

  const restore = async (table, row) => {
    if (!adminProfile?.is_super_admin) { alert('Only a super admin may restore deleted records.'); return; }
    setBusyRow(row.id);
    const { data: hit, error } = await supabase
      .from(table).update({ deleted_at: null }).eq("id", row.id).select("id");
    setBusyRow(null);
    if (error) {
      alert("Could not restore: " + error.message);
      return;
    }
    if (!hit || hit.length === 0) {
      alert(WRITE_BLOCKED_HINT);
      return;
    }
    await Promise.all([fetchApplications(), fetchStudents(), fetchDeleted()]);
  };

  /**
   * The application a student was enrolled from, if any.
   *
   * `doApprove` copies the applicant's B-form into `students.cnic`, and that is
   * the only link between the two tables — students added by hand through the
   * Add Student form have no cnic and no application, so matching on it cannot
   * pick up the wrong person.
   */
  const findSourceApplication = async (student) => {
    if (!student.cnic) return null;
    const { data } = await supabase
      .from("applications")
      .select("id, student_name, status")
      .eq("bform", student.cnic)
      .eq("status", "Approved")
      .maybeSingle();
    return data || null;
  };

  // The real DELETE. For a student the database cascades her fees, payments,
  // attendance, results and class test marks along with her — see
  // supabase_soft_delete.sql.
  const permanentDelete = async (table, row, name) => {
    if (!adminProfile?.is_super_admin) {
      alert('Only a super admin may permanently delete records.');
      return;
    }
    const isStudent = table === "students";
    const sourceApp = isStudent ? await findSourceApplication(row) : null;

    if (!window.confirm(
      `Permanently delete "${name}"?\n\n` +
      "THIS CANNOT BE UNDONE. The record will be erased from the database.\n\n" +
      (isStudent
        ? "Her fee history, payments, attendance, results and class test marks will be deleted with her."
        : "The submitted documents and all form data will be gone.") +
      (sourceApp
        ? "\n\nHer application will go back to Pending, so you can approve it again to re-enrol her — or delete it too."
        : "")
    )) return;

    if (!window.confirm(`Last check — really erase "${name}" for good?`)) return;

    setBusyRow(row.id);
    const { data: erased, error } = await supabase
      .from(table).delete().eq("id", row.id).select("id");
    const reallyGone = !error && erased && erased.length > 0;

    // Only after the student is actually gone: otherwise a failed delete would
    // leave an enrolled student whose application says Pending.
    if (reallyGone && sourceApp) {
      const { error: appError } = await supabase
        .from("applications")
        .update({ status: "Pending" })
        .eq("id", sourceApp.id);
      if (appError) {
        alert(
          `${name} was deleted, but her application could not be reset to Pending: ${appError.message}\n\n` +
          "Open the Applications tab and change it by hand."
        );
      }
    }
    setBusyRow(null);

    if (error) {
      alert("Could not delete permanently: " + error.message);
      return;
    }
    if (!reallyGone) {
      alert(WRITE_BLOCKED_HINT);
      return;
    }
    await Promise.all([fetchApplications(), fetchDeleted()]);
  };

  const presentDocuments = () => DOCUMENTS.filter((d) => selected?.[d.urlField]);

  const handleApprove = () => {
    if (!selected) return;
    const presentDocs = presentDocuments();
    const unreviewed = presentDocs.filter((d) => !docReview[d.key]);
    if (unreviewed.length > 0) {
      alert(
        "Please mark each document as Correct or Incorrect before approving:\n\n" +
        unreviewed.map((d) => "- " + d.label).join("\n")
      );
      return;
    }

    const rejectedDocs = presentDocs.filter((d) => docReview[d.key] === "rejected");
    if (rejectedDocs.length > 0) {
      rejectApplication(rejectedDocs.map((d) => d.label));
      return;
    }

    setAdmissionFeeConfirmed(false);
    setShowAdmissionFeeModal(true);
  };

  const rejectApplication = async (reasonLabels) => {
    if (!selected) return;
    const labels = reasonLabels.length > 0
      ? reasonLabels
      : ["Submitted documents did not meet admission requirements"];
    const reasonLines = labels.map((l) => "- " + l).join("\n");
    const confirmed = window.confirm(
      "This application will be rejected for the following reason(s):\n" + reasonLines +
      "\n\nThe student will be notified via WhatsApp/Email with this reason. Continue?"
    );
    if (!confirmed) return;

    setRejecting(true);

    // Opened synchronously (within the click's user-gesture window) so the
    // WhatsApp redirect below isn't blocked as a popup after the awaits.
    const waWindowRef = window.open("", "_blank");

    const { error } = await supabase
      .from("applications")
      .update({ status: "Rejected" })
      .eq("id", selected.id);

    if (error) {
      if (waWindowRef && !waWindowRef.closed) waWindowRef.close();
      alert("Failed to reject application: " + error.message);
      setRejecting(false);
      return;
    }

    const updatedApp = { ...selected, status: "Rejected" };
    setApplications((prev) => prev.map((a) => a.id === selected.id ? updatedApp : a));
    setSelected(updatedApp);

    const message = buildRejectionMessage(selected.student_name || "Student", labels);
    sendRejectionNotice(selected, message, waWindowRef);

    setRejecting(false);
  };

  const doApprove = async () => {
    if (!selected) return;
    setApproving(true);
    setShowAdmissionFeeModal(false);

    // Opened synchronously (within the click's user-gesture window) so the
    // WhatsApp redirect below isn't blocked as a popup after the awaits.
    const waWindowRef = window.open("", "_blank");

    const { error: appError } = await supabase
      .from("applications")
      .update({ status: "Approved" })
      .eq("id", selected.id);

    if (appError) {
      if (waWindowRef && !waWindowRef.closed) waWindowRef.close();
      alert("Failed to update application: " + appError.message);
      setApproving(false);
      return;
    }

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
        // Which elective set she chose on the form — only FA-IT and Humanities
        // offer a choice, so this is null for the single-combination groups.
        subject_combination: selected.subject_combination || null,
        phone: selected.phone1,
        password: defaultPassword,
        cnic: selected.bform,
        year_of_study: selected.year_of_study || "1st Year",
        profile_picture_url: selected.photo_url || null,

        // Everything else she filled in on the admission form. This used to be
        // dropped on approval, so an enrolled student lost her WhatsApp number,
        // address, matric record and every uploaded document.
        whatsapp: selected.whatsapp || selected.phone1 || null,
        phone2: selected.phone2 || null,
        email: selected.email || null,
        address: selected.address || null,
        dob: selected.dob || null,
        father_cnic: selected.father_cnic || null,
        nationality: selected.nationality || null,
        religion: selected.religion || null,
        orphan: selected.orphan ?? null,
        father_occupation: selected.father_occupation || null,
        monthly_income: selected.monthly_income ?? null,
        family_members: selected.family_members ?? null,
        financial_assistance: selected.financial_assistance ?? null,
        ssc_roll_no: selected.ssc_roll_no || null,
        ssc_registration_no: selected.ssc_registration_no || null,
        matric_marks_obtained: selected.matric_marks_obtained ?? null,
        matric_total_marks: selected.matric_total_marks ?? null,
        matric_percentage: selected.matric_percentage ?? null,
        board: selected.board || null,
        student_group: selected.student_group || null,
        bform_doc_url: selected.bform_doc_url || null,
        father_id_doc_url: selected.father_id_doc_url || null,
        marksheet_url: selected.marksheet_url || null,
        noc_url: selected.noc_url || null,
        verified_marksheet_url: selected.verified_marksheet_url || null,
      })
      .select()
      .single();

    if (studentError) {
      if (waWindowRef && !waWindowRef.closed) waWindowRef.close();
      // Approving a second application for a girl who is already enrolled trips
      // the B-Form index; say so plainly instead of showing the raw constraint.
      alert("Student enroll failed: " + (studentError.code === "23505"
        ? describeUniqueViolation(studentError)
        : studentError.message));
      setApproving(false);
      return;
    }

    if (newStudent) {
      // The whole year's schedule is written up front — admission fee plus every
      // instalment — so the office and the student both see what is owed and
      // when, instead of the admin allocating each month by hand.
      const feeRows = activePlan
        ? buildFeeRows({
            plan: activePlan,
            studentId: newStudent.id,
            program: selectedProgram,
            year: selectedYear,
          })
        : [{
            student_id: newStudent.id,
            program: selectedProgram,
            year_of_study: selectedYear,
            label: "Admission Fee",
            amount_due: FALLBACK_ADMISSION_FEE,
            due_date: new Date(Date.now() + 7 * 864e5).toISOString().split("T")[0],
            status: "Unpaid",
          }];

      const { error: feeError } = await supabase.from("fees").insert(feeRows);
      if (feeError) alert("Fee allocation failed: " + feeError.message);
      else if (!activePlan) {
        alert(`No fee plan is set for ${selectedYear} ${selectedProgram}, so only the admission fee was created. Set it up in Fee Verification → Fee Settings, then allocate the rest manually.`);
      }

      const credentialsShared = shareCredentials(selected, rollNo, defaultPassword, waWindowRef);
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
        "Admission Fee Due: Rs " + admissionFee.toLocaleString() + "\n\n" +
        "The login credentials were prepared for delivery via email or WhatsApp."
      );
    } else if (waWindowRef && !waWindowRef.closed) {
      waWindowRef.close();
    }

    setApproving(false);
    setAdmissionFeeConfirmed(false);
  };

  const handleReject = () => {
    if (!selected) return;
    const rejectedDocs = presentDocuments().filter((d) => docReview[d.key] === "rejected");
    rejectApplication(rejectedDocs.map((d) => d.label));
  };

  const addStudent = async () => {
    setFormError("");
    if (!form.roll_no.trim()) return setFormError("Roll number is required");
    if (!form.name.trim()) return setFormError("Name is required");
    if (!form.password.trim()) return setFormError("Password is required");
    if (form.password.length < 6) return setFormError("Password must be at least 6 characters");
    if (!isValidBForm(form.cnic)) return setFormError("B-Form number is required, in the format 12345-1234567-1");
    if (groupHasChoice(form.program) && form.comboIndex === null) {
      return setFormError("Choose a subject combination for " + form.program);
    }
    setSaving(true);

    // Checked here so the admin is told whose record already holds this number,
    // rather than being handed a raw constraint error after the photo upload.
    const clash = await findBFormClash(form.cnic);
    if (clash) {
      setSaving(false);
      return setFormError(clash);
    }

    let profileImageUrl = null;

    // Upload image to Supabase Storage if provided
    if (profileImage) {
      try {
        const fileExt = profileImage.name.split('.').pop().toLowerCase();
        const fileName = `${form.roll_no.replace(/\//g, '-')}-${Date.now()}.${fileExt}`;

        // Try upload with upsert option
        const { error: uploadError } = await supabase.storage
          .from('student-profiles')
          .upload(fileName, profileImage, {
            cacheControl: '3600',
            upsert: true
          });

        if (uploadError) {
          console.error("Upload detailed error:", uploadError);
          throw new Error(uploadError.message || "Upload failed");
        }

        // Get public URL
        const { data: publicUrlData } = supabase.storage
          .from('student-profiles')
          .getPublicUrl(fileName);
        
        profileImageUrl = publicUrlData?.publicUrl || null;
        
        if (!profileImageUrl) {
          throw new Error("Could not generate public URL");
        }
      } catch (error) {
        setSaving(false);
        setFormError("Image upload failed: " + (error?.message || "Unknown error"));
        return;
      }
    }

    const selectedCombo = form.comboIndex !== null ? combinationsFor(form.program)[form.comboIndex] : combinationsFor(form.program)[0];
    const { error } = await supabase.from("students").insert({
      roll_no: form.roll_no,
      name: form.name,
      father_name: form.father_name,
      cnic: formatBForm(form.cnic),
      program: form.program,
      subject_combination: selectedCombo ? formatCombination(selectedCombo) : null,
      phone: form.phone,
      // Falls back to the phone so she is at least reachable; the admin can
      // correct it later from Edit.
      whatsapp: form.whatsapp.trim() || form.phone.trim() || null,
      password: form.password,
      year_of_study: form.year_of_study,
      profile_picture_url: profileImageUrl,
      // Whatever was filled in under "Further Entry" — all optional.
      ...detailsToRow(form),
    });
    setSaving(false);
    if (error) {
      // Two unique indexes can fire here now, so read which one it was rather
      // than always blaming the roll number.
      if (error.code === "23505") setFormError(describeUniqueViolation(error));
      else setFormError("Error: " + error.message);
      return;
    }
    setSaved(true);
    setShowFurther(false);
    setForm({
      roll_no: "", name: "", father_name: "", cnic: "", program: "Pre-Medical",
      comboIndex: groupHasChoice("Pre-Medical") ? 0 : 0,
      phone: "", whatsapp: "", password: "", year_of_study: "1st Year",
      ...blankDetails(),
    });
    setProfileImage(null);
    setProfileImagePreview(null);
    fetchStudents();
    setTimeout(() => setSaved(false), 3000);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setFormError("Please select a valid image file");
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setFormError("Image must be less than 5MB");
        return;
      }
      setProfileImage(file);
      const reader = new FileReader();
      reader.onload = (e) => setProfileImagePreview(e.target?.result);
      reader.readAsDataURL(file);
      setFormError("");
    }
  };

  const handlePictureImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert("Please select a valid image file");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("Image must be less than 5MB");
        return;
      }
      setPictureTempImage(file);
      const reader = new FileReader();
      reader.onload = (e) => setPictureTempPreview(e.target?.result);
      reader.readAsDataURL(file);
    }
  };

  const uploadStudentPicture = async () => {
    if (!showPictureModal || !pictureTempImage) return;
    setUploadingPicture(true);

    try {
      const fileExt = pictureTempImage.name.split('.').pop().toLowerCase();
      const fileName = `${showPictureModal.roll_no.replace(/\//g, '-')}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('student-profiles')
        .upload(fileName, pictureTempImage, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('student-profiles')
        .getPublicUrl(fileName);

      const pictureUrl = publicUrlData?.publicUrl;
      if (!pictureUrl) throw new Error("Could not generate public URL");

      // Update student record
      const { error: updateError } = await supabase
        .from('students')
        .update({ profile_picture_url: pictureUrl })
        .eq('id', showPictureModal.id);

      if (updateError) throw updateError;

      // Update local state
      setStudents((prev) =>
        prev.map((s) =>
          s.id === showPictureModal.id ? { ...s, profile_picture_url: pictureUrl } : s
        )
      );

      alert("Picture uploaded successfully!");
      setShowPictureModal(null);
      setPictureTempImage(null);
      setPictureTempPreview(null);
    } catch (error) {
      alert("Picture upload failed: " + (error?.message || "Unknown error"));
    } finally {
      setUploadingPicture(false);
    }
  };

  const openFeeModal = (student) => {
    setShowFeeModal(student);
    setFeeAmount(String(findPlan(feePlans, student.year_of_study || "1st Year", student.program)?.monthly_fee || FALLBACK_MONTHLY_FEE));
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
    if (!adminProfile?.is_super_admin) { alert('Only a super admin can change a student\'s year.'); return; }
    const confirmed = window.confirm(
      "Confirm year change for " + student.name + "?\n" +
      "Current: " + (student.year_of_study || "1st Year") + "\n" +
      "New: " + newYear
    );
    if (!confirmed) return;
    const { data: hit, error } = await supabase
      .from("students")
      .update({ year_of_study: newYear })
      .eq("id", student.id)
      .select("id");
    if (error) { alert("Error: " + error.message); return; }
    if (!hit || hit.length === 0) { alert(WRITE_BLOCKED_HINT); return; }
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

  const DocumentRow = ({ label, url, docKey }) => {
    if (!url) return null;
    const status = docReview[docKey];
    const canReview = selected?.status !== "Approved";
    return (
      <div className="sl-doc-row">
        <a href={url} target="_blank" rel="noopener noreferrer" className="sl-doc-link">📄 {label}</a>
        {canReview && (
          <div className="sl-doc-review-btns">
            <button
              type="button"
              onClick={() => setDocReview((prev) => ({ ...prev, [docKey]: "approved" }))}
              className={"sl-doc-approve-btn" + (status === "approved" ? " sl-doc-approve-btn--active" : "")}
            >
              <CheckCircle size={12} /> Correct
            </button>
            <button
              type="button"
              onClick={() => setDocReview((prev) => ({ ...prev, [docKey]: "rejected" }))}
              className={"sl-doc-reject-btn" + (status === "rejected" ? " sl-doc-reject-btn--active" : "")}
            >
              <XCircle size={12} /> Incorrect
            </button>
          </div>
        )}
      </div>
    );
  };

  const ApproveSection = () => (
    <div className="sl-detail-actions">
      <div className="sl-fee-notice">
        <DollarSign size={16} />
        <p>Admission fee of <strong>Rs {admissionFee.toLocaleString()}</strong> must be collected before approving. Mark every document above as Correct/Incorrect first — if any document is Incorrect, the application will be rejected with the reason sent to the student instead of being approved.</p>
      </div>
      <div className="sl-action-btns">
        <button onClick={handleReject} disabled={approving || rejecting} className="sl-reject-btn">
          <XCircle size={16} /> Reject Application
        </button>
        <button onClick={handleApprove} disabled={approving || rejecting} className="sl-approve-btn">
          <CheckCircle size={16} /> {approving ? "Processing..." : rejecting ? "Rejecting..." : "Approve & Enroll"}
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
                <p>Admission Fee: <strong>Rs {admissionFee.toLocaleString()}</strong></p>
              </div>
              <label className="sl-modal-check">
                <input
                  type="checkbox"
                  checked={admissionFeeConfirmed}
                  onChange={(e) => setAdmissionFeeConfirmed(e.target.checked)}
                />
                I confirm that Rs {admissionFee.toLocaleString()} admission fee has been received.
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
              <DocumentRow label="Student Photo" url={selected.photo_url} docKey="photo" />
              <DocumentRow label="B-Form" url={selected.bform_doc_url} docKey="bform" />
              <DocumentRow label="Father NIC" url={selected.father_id_doc_url} docKey="father_id" />
              <DocumentRow label="Matric Marksheet" url={selected.marksheet_url} docKey="marksheet" />
              <DocumentRow label="NOC" url={selected.noc_url} docKey="noc" />
              <DocumentRow label="Verified Marksheet" url={selected.verified_marksheet_url} docKey="verified_marksheet" />
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

      {/* Picture Upload Modal */}
      {showPictureModal && (
        <div className="sl-modal-overlay">
          <div className="sl-modal">
            <div className="sl-modal-header-row">
              <h3>Upload Student Picture</h3>
              <button onClick={() => { setShowPictureModal(null); setPictureTempImage(null); setPictureTempPreview(null); }}><X size={18} /></button>
            </div>
            <p className="sl-modal-info">Student: <strong>{showPictureModal.name}</strong> ({showPictureModal.roll_no})</p>
            <div className="sl-modal-field">
              <label>Select Picture *</label>
              <input type="file" id="picture-upload-input" accept="image/*" onChange={handlePictureImageSelect} style={{ display: 'none' }} />
              <button type="button" onClick={() => document.getElementById('picture-upload-input').click()} className="sl-image-upload-btn">
                <ImageIcon size={18} /> Choose Picture
              </button>
              {pictureTempPreview && (
                <div className="sl-image-preview">
                  <img src={pictureTempPreview} alt="Preview" />
                  <button type="button" onClick={() => { setPictureTempImage(null); setPictureTempPreview(null); }} className="sl-image-remove"><X size={14} /></button>
                </div>
              )}
            </div>
            <div className="sl-modal-actions">
              <button onClick={() => { setShowPictureModal(null); setPictureTempImage(null); setPictureTempPreview(null); }} className="sl-modal-cancel">Cancel</button>
              <button onClick={uploadStudentPicture} disabled={!pictureTempImage || uploadingPicture} className="sl-modal-save">
                <ImageIcon size={14} /> {uploadingPicture ? "Uploading..." : "Upload Picture"}
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
        <button onClick={() => setActiveTab("editRequests")} className={"sl-tab " + (activeTab === "editRequests" ? "sl-tab--active" : "")}>
          Edit Requests
          {pendingRequestCount > 0 && <span className="sl-tab-badge">{pendingRequestCount}</span>}
        </button>
        <button onClick={() => setActiveTab("deleted")} className={"sl-tab " + (activeTab === "deleted" ? "sl-tab--active" : "")}>
          <Trash2 size={13} /> Deleted Items ({deletedApps.length + deletedStudents.length})
        </button>
      </div>

      {/* Toolbar — the requests tab has its own filters and no roster to search */}
      <div className="sl-toolbar" hidden={activeTab === "editRequests"}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setShowAddForm(!showAddForm)} className="sl-add-btn">
              {showAddForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Student</>}
            </button>
            {adminProfile?.is_super_admin && (
              <button
              onClick={async () => {
                if (!window.confirm('Mark all current 2nd Year students as passout and archive them?')) return;
                await markSecondYearPassout();
              }}
                className="sl-action-btn sl-passout-btn"
              >
                Mark 2nd Year as Passout
              </button>
            )}
            {adminProfile?.is_super_admin && (
              <button
              onClick={async () => {
                if (!window.confirm('Promote all 1st Year students to 2nd Year? This will only run if there are no active 2nd Year students (they should be marked passout first).')) return;
                await promoteFirstYearToSecond();
              }}
                className="sl-action-btn sl-promote-btn"
              >
                Promote 1st → 2nd (bulk)
              </button>
            )}
          </div>
        )}
      </div>

      {activeTab === "editRequests" && (
        <EditRequests allowedPrograms={allowedPrograms} onCountChange={setPendingRequestCount} />
      )}

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
                  <td className="sl-row-actions">
                    <button onClick={() => { setSearch(""); setDocReview({}); setSelected(a); }} className="sl-view-btn"><Eye size={14} /> View</button>
                    {adminProfile?.is_super_admin ? (
                      <button
                        onClick={() => softDelete("applications", a, a.student_name)}
                        disabled={busyRow === a.id}
                        className="sl-delete-btn"
                        title="Move to Deleted Items"
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </td>
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
                  <label>B-Form No. *</label>
                  <input placeholder="12345-1234567-1" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
                  <span className="sl-field-hint">One B-Form, one student — a number already on record will be refused.</span>
                </div>
                <div className="sl-add-field">
                  <label>Program *</label>
                  <select value={form.program} onChange={(e) => updateForm({ program: e.target.value })}>
                    {visiblePrograms.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                {groupHasChoice(form.program) && (
                  <div className="sl-add-field">
                    <label>Subject Combination *</label>
                    <select
                      value={form.comboIndex ?? ""}
                      onChange={(e) => updateForm({ comboIndex: e.target.value === "" ? null : Number(e.target.value) })}
                    >
                      <option value="">— Select combination —</option>
                      {combinationsFor(form.program).map((combo, index) => (
                        <option key={index} value={index}>{formatCombination(combo)}</option>
                      ))}
                    </select>
                    <span className="sl-field-hint">Choose the electives for {form.program}.</span>
                  </div>
                )}
                <div className="sl-add-field"><label>Phone</label><input placeholder="03XXXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="sl-add-field">
                  <label>WhatsApp No.</label>
                  <input placeholder="03XXXXXXXXX" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
                  <span className="sl-field-hint">Messages go here. Blank = use the phone above.</span>
                </div>
                <div className="sl-add-field"><label>Login Password *</label><input type="password" placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div className="sl-add-field">
                  <label>Year of Study *</label>
                  <select value={form.year_of_study} onChange={(e) => setForm({ ...form, year_of_study: e.target.value })}>
                    <option>1st Year</option>
                    <option>2nd Year</option>
                  </select>
                </div>
              </div>
              <div className="sl-add-image-section">
                <label className="sl-image-label">Profile Picture (Optional)</label>
                <div className="sl-image-upload">
                  <input type="file" id="profile-image-input" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
                  <button type="button" onClick={() => document.getElementById('profile-image-input').click()} className="sl-image-upload-btn">
                    <ImageIcon size={18} /> {profileImagePreview ? 'Change Picture' : 'Upload Picture'}
                  </button>
                  {profileImagePreview && (
                    <div className="sl-image-preview">
                      <img src={profileImagePreview} alt="Preview" />
                      <button type="button" onClick={() => { setProfileImage(null); setProfileImagePreview(null); }} className="sl-image-remove"><X size={14} /></button>
                    </div>
                  )}
                </div>
              </div>

              {/* Everything below is optional for the admin. It stays folded away
                  so the quick path — name, roll no, group, password — is not
                  buried under twenty fields she does not have to hand. */}
              <button
                type="button"
                onClick={() => setShowFurther((v) => !v)}
                className="sl-further-btn"
              >
                {showFurther ? <><X size={14} /> Hide Further Entry</> : <><Plus size={14} /> Further Entry (optional)</>}
              </button>

              {showFurther && (
                <div className="sl-further">
                  <p className="sl-further-hint">
                    None of this is required now — you can fill it in later from the student's
                    <strong> Edit</strong> button, along with her documents.
                  </p>
                  {DETAIL_GROUPS.map((group) => (
                    <div key={group.title} className="sl-further-group">
                      <h4>{group.title}</h4>
                      <div className="sl-add-grid">
                        {group.fields.map((f) => (
                          <div key={f.key} className={"sl-add-field " + (f.wide ? "sl-add-field--wide" : "")}>
                            <label>{f.label}</label>
                            {f.type === "select" ? (
                              <select value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                                <option value="">— Select —</option>
                                {(f.options || []).map((o) => <option key={o}>{o}</option>)}
                              </select>
                            ) : f.type === "boolean" ? (
                              <label className="sl-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(form[f.key])}
                                  onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })}
                                />
                                Yes
                              </label>
                            ) : f.type === "textarea" ? (
                              <textarea
                                rows={2}
                                placeholder={f.placeholder}
                                value={form[f.key] ?? ""}
                                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                              />
                            ) : (
                              <input
                                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                                placeholder={f.placeholder}
                                readOnly={f.readOnly}
                                value={form[f.key] ?? ""}
                                onChange={(e) => {
                                  const next = { ...form, [f.key]: e.target.value };
                                  if (f.key === "matric_marks_obtained" || f.key === "matric_total_marks") {
                                    next.matric_percentage = matricPercentage(
                                      next.matric_marks_obtained,
                                      next.matric_total_marks
                                    );
                                  }
                                  setForm(next);
                                }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                  {/* Only what the office needs at a glance — everything else is
                      one click away under Details. */}
                  <tr><th></th><th>Roll No</th><th>Name</th><th>Program</th><th>Year</th><th>WhatsApp</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.id}>
                      <td className="sl-pic-cell">
                        {s.profile_picture_url ? (
                          <img src={s.profile_picture_url} alt={s.name} className="sl-student-pic" loading="lazy" decoding="async" />
                        ) : (
                          <div className="sl-student-pic sl-pic-placeholder">—</div>
                        )}
                      </td>
                      <td>{s.roll_no}</td>
                      <td className="sl-name">{s.name}</td>
                      <td>{s.program}</td>
                      <td>
                        <select
                          value={s.year_of_study || "1st Year"}
                          onChange={(e) => changeYear(s, e.target.value)}
                          className="sl-year-select"
                          disabled={!adminProfile?.is_super_admin}
                          title={adminProfile?.is_super_admin ? "Change year" : "Only super admin can change year"}
                        >
                          <option>1st Year</option>
                          <option>2nd Year</option>
                        </select>
                      </td>
                      <td>
                        {s.whatsapp || s.phone || "—"}
                        {!s.whatsapp && s.phone && <span className="sl-wa-fallback" title="No WhatsApp number on record — using her phone">phone</span>}
                      </td>
                      <td>
                        <button onClick={() => setDetailStudent({ student: s, edit: false })} className="sl-detail-btn">
                          <Eye size={13} /> Details
                        </button>
                        <button onClick={() => setDetailStudent({ student: s, edit: true })} className="sl-edit-btn">
                          <Save size={13} /> Edit
                        </button>
                        <button onClick={() => openFeeModal(s)} className="sl-fee-btn">
                          <DollarSign size={13} /> Fee
                        </button>
                        <button onClick={() => setShowPictureModal(s)} className="sl-picture-btn">
                          <ImageIcon size={13} /> Picture
                        </button>
                        <button onClick={() => sendStudentCredentialsWhatsApp(s)} className="sl-whatsapp-btn" title="Send login ID & password via WhatsApp">
                          <WhatsappIcon />
                        </button>
                        {adminProfile?.is_super_admin ? (
                          <button
                            onClick={() => softDelete("students", s, s.name)}
                            disabled={busyRow === s.id}
                            className="sl-delete-btn"
                            title="Move to Deleted Items"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </div>
      )}

      {detailStudent && (
        <StudentDetail
          student={detailStudent.student}
          allowedPrograms={allowedPrograms}
          startInEdit={detailStudent.edit}
          onClose={() => setDetailStudent(null)}
          onSaved={fetchStudents}
        />
      )}

      {/* Deleted Items Tab */}
      {activeTab === "deleted" && (
        <div className="sl-deleted">
          <p className="sl-deleted__intro">
            Anything deleted from the Applications or Enrolled Students tab is kept here.
            <strong> Restore</strong> puts it back exactly where it was.
            <strong> Delete Permanently</strong> erases it from the database for good.
          </p>

          {deletedApps.length === 0 && deletedStudents.length === 0 ? (
            <div className="sl-deleted__empty">
              <Trash2 size={30} />
              <p>Deleted Items is empty.</p>
            </div>
          ) : (
            <>
              {deletedApps.length > 0 && (
                <div className="sl-deleted__section">
                  <h4>Applications ({deletedApps.length})</h4>
                  <div className="sl-table-wrap">
                    <table className="sl-table">
                      <thead>
                        <tr><th>Name</th><th>Group</th><th>Year</th><th>Phone</th><th>Status</th><th>Deleted</th><th>Actions</th></tr>
                      </thead>
                      <tbody>
                        {deletedApps.map((a) => (
                          <tr key={a.id}>
                            <td className="sl-name">{a.student_name}</td>
                            <td>{a.group_selected}</td>
                            <td>{a.year_of_study || "1st Year"}</td>
                            <td>{a.phone1}</td>
                            <td>{statusBadge(a.status)}</td>
                            <td>{new Date(a.deleted_at).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}</td>
                            <td className="sl-row-actions">
                              {adminProfile?.is_super_admin ? (
                                <>
                                  <button onClick={() => restore("applications", a)} disabled={busyRow === a.id} className="sl-restore-btn">
                                    <ArrowLeft size={13} /> Restore
                                  </button>
                                  <button onClick={() => permanentDelete("applications", a, a.student_name)} disabled={busyRow === a.id} className="sl-purge-btn">
                                    <X size={13} /> Delete Permanently
                                  </button>
                                </>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {deletedStudents.length > 0 && (
                <div className="sl-deleted__section">
                  <h4>Enrolled Students ({deletedStudents.length})</h4>
                  <div className="sl-table-wrap">
                    <table className="sl-table">
                      <thead>
                        <tr><th>Roll No</th><th>Name</th><th>Father</th><th>Program</th><th>Year</th><th>Deleted</th><th>Actions</th></tr>
                      </thead>
                      <tbody>
                        {deletedStudents.map((s) => (
                          <tr key={s.id}>
                            <td>{s.roll_no}</td>
                            <td className="sl-name">{s.name}</td>
                            <td>{s.father_name}</td>
                            <td>{s.program}</td>
                            <td>{s.year_of_study || "1st Year"}</td>
                            <td>{new Date(s.deleted_at).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}</td>
                            <td className="sl-row-actions">
                              {adminProfile?.is_super_admin ? (
                                <>
                                  <button onClick={() => restore("students", s)} disabled={busyRow === s.id} className="sl-restore-btn">
                                    <ArrowLeft size={13} /> Restore
                                  </button>
                                  <button onClick={() => permanentDelete("students", s, s.name)} disabled={busyRow === s.id} className="sl-purge-btn">
                                    <X size={13} /> Delete Permanently
                                  </button>
                                </>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}