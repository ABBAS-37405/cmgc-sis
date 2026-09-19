import { useState, useEffect } from "react";
import { Check, X, Eye, Download, RotateCcw } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import FeeSettings from "../FeeSettings/FeeSettings";
import { openWhatsApp, whatsappNumberFor, isValidWhatsAppNumber, reserveWhatsAppWindow } from "../../lib/whatsapp";
import { downloadXlsx, S } from "../../lib/xlsx";
import { LATE_FEE_AMOUNT, isLatePayment, totalWithFine, feeLabelWithFine } from "../../lib/lateFee";
import "./FeeVerification.css";

const PAYMENT_METHODS = ["Easypaisa", "Bank Al Habib", "Raast", "Cash in College Office"];
// Admin ye screen zyada tar office counter pe cash lene ke liye use karti hai.
const DEFAULT_PAYMENT_METHOD = "Cash in College Office";

const buildFeeReminderMessage = (studentName, rollNo, amount, dueDate) => {
  const lines = [
    `Assalamualaikum ${studentName},`,
    "",
    `This is a reminder that your college fee of Rs ${Number(amount || 0).toLocaleString()} (Roll No: ${rollNo}) is still pending.`,
    "",
  ];
  if (dueDate) {
    const formattedDue = new Date(dueDate).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
    lines.push(`Please deposit the fee before ${formattedDue} to avoid any inconvenience.`);
  } else {
    lines.push("Please deposit the fee at your earliest convenience.");
  }
  lines.push("", "You can pay via the CMGC student portal or at the college office.", "Thank you.");
  return lines.join("\n");
};

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.46 0 .09 5.37.09 11.95c0 2.11.55 4.09 1.51 5.81L0 24l6.4-1.68a11.86 11.86 0 0 0 5.64 1.43h.01c6.58 0 11.95-5.37 11.95-11.95 0-3.19-1.24-6.19-3.48-8.32ZM12.05 21.3h-.01a9.3 9.3 0 0 1-4.74-1.3l-.34-.2-3.53.93.94-3.44-.22-.35a9.3 9.3 0 0 1-1.43-4.99c0-5.14 4.19-9.33 9.34-9.33 2.49 0 4.83.97 6.59 2.73a9.26 9.26 0 0 1 2.73 6.6c0 5.15-4.19 9.35-9.33 9.35Zm5.34-6.98c-.29-.15-1.72-.85-1.99-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.3-.36.45-.54.15-.18.2-.31.3-.51.1-.2.05-.37-.03-.51-.08-.15-.6-1.46-.82-2-.22-.53-.44-.46-.6-.47-.16-.01-.34-.01-.52-.01-.18 0-.47.07-.72.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.13 2.86.14.18 1.86 2.84 4.5 3.87 2.65 1.03 2.65.69 3.12.64.47-.05 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.24-.16-.53-.31Z" />
    </svg>
  );
}

const sendFeeReminderWhatsApp = async (fee, onPhoneSaved) => {
  const student = fee.student;
  let number = whatsappNumberFor(student);
  if (!isValidWhatsAppNumber(number)) {
    const entered = window.prompt(
      `WhatsApp number for ${student?.name || "this student"} is missing or invalid. Enter one (03XXXXXXXXX):`,
      number || ""
    );
    if (!entered || !entered.trim()) return;
    number = entered.trim();

    // Save it against her WhatsApp field so it is not asked for again.
    await supabase.from("students").update({ whatsapp: number }).eq("id", student.id);
    if (onPhoneSaved) onPhoneSaved(student.id, number);
  }
  openWhatsApp(
    number,
    buildFeeReminderMessage(student?.name || "Student", student?.roll_no, fee.remaining_amount, fee.due_date)
  );
};

const fmtStatementDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "—";

// Her whole record, paid and pending — the same figures the student's own
// "Download Fee Statement" produces, just as WhatsApp text rather than a file:
// click-to-chat cannot attach anything (see lib/whatsapp.js), so a message
// spelling out every fee is the closest equivalent that can actually be sent.
const buildFeeStatementMessage = (student, fees) => {
  const sorted = [...fees].sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
  const totalDue = fees.reduce((sum, f) => sum + totalWithFine(f), 0);
  const totalPaid = fees.reduce((sum, f) => sum + Number(f.amount_paid || 0), 0);
  const totalPending = fees.reduce((sum, f) => sum + Number(f.remaining_amount || 0), 0);

  const lines = [
    `Assalamualaikum, this is the CMGC fee record for ${student.name} (Roll No: ${student.roll_no}).`,
    "",
    ...sorted.map((f) => {
      const remaining = Number(f.remaining_amount || 0);
      const status = remaining === 0 ? "Paid" : f.status;
      return (
        `• ${feeLabelWithFine(f) || f.program || student.program || "Fee"} (Due ${fmtStatementDate(f.due_date)}): ` +
        `Rs ${totalWithFine(f).toLocaleString()} — Paid Rs ${Number(f.amount_paid || 0).toLocaleString()}, ` +
        `Pending Rs ${remaining.toLocaleString()} [${status}]`
      );
    }),
    "",
    `Total Due: Rs ${totalDue.toLocaleString()}`,
    `Total Paid: Rs ${totalPaid.toLocaleString()}`,
    `Total Pending: Rs ${totalPending.toLocaleString()}`,
    "",
    totalPending > 0
      ? "Kindly deposit the pending amount at your earliest convenience via the CMGC student portal or at the college office."
      : "All fees are fully paid. Thank you!",
  ];
  return lines.join("\n");
};

// Every fee for this girl, paid ones included — the Unpaid tab's own query
// deliberately drops those, so this is a separate fetch rather than reusing it.
const fetchStudentFullFees = async (studentId) => {
  const { data: feesData } = await supabase
    .from("fees")
    .select("id, amount_due, fine_amount, due_date, status, label, program, sort_order, payment_transactions(amount, status)")
    .eq("student_id", studentId)
    .order("due_date", { ascending: true })
    .order("sort_order", { ascending: true, nullsFirst: true });

  return (feesData || []).map((fee) => {
    const paidAmount = (fee.payment_transactions || [])
      .filter((t) => t.status === "Success")
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const remaining = Math.max(totalWithFine(fee) - paidAmount, 0);
    return { ...fee, amount_paid: paidAmount, remaining_amount: remaining, status: remaining === 0 ? "Paid" : fee.status };
  });
};

const sendFullFeeStatementWhatsApp = async (student, onPhoneSaved, onDone) => {
  // Reserved inside the click gesture, before the fee lookup below, so the
  // chat that follows isn't blocked as a popup once the awaits have run —
  // same trick as StudentsList.doApprove.
  const windowRef = reserveWhatsAppWindow();
  try {
    let number = whatsappNumberFor(student);
    if (!isValidWhatsAppNumber(number)) {
      const entered = window.prompt(
        `WhatsApp number for ${student?.name || "this student"} is missing or invalid. Enter one (03XXXXXXXXX):`,
        number || ""
      );
      if (!entered || !entered.trim()) {
        if (windowRef && !windowRef.closed) windowRef.close();
        return;
      }
      number = entered.trim();
      await supabase.from("students").update({ whatsapp: number }).eq("id", student.id);
      if (onPhoneSaved) onPhoneSaved(student.id, number);
    }

    const fees = await fetchStudentFullFees(student.id);
    if (fees.length === 0) {
      if (windowRef && !windowRef.closed) windowRef.close();
      window.alert(`No fee records found for ${student.name}.`);
      return;
    }

    openWhatsApp(number, buildFeeStatementMessage(student, fees), windowRef);
  } finally {
    if (onDone) onDone();
  }
};

export default function FeeVerification() {
  const [pending, setPending] = useState([]);
  const [unpaidFees, setUnpaidFees] = useState([]);
  const [yearFilter, setYearFilter] = useState("Both");
  const [unpaidView, setUnpaidView] = useState("overall"); // "overall" | "monthly"
  const [unpaidMonth, setUnpaidMonth] = useState(null);
  const [txView, setTxView] = useState("overall"); // "overall" | "monthly"
  const [txMonth, setTxMonth] = useState(null);
  // Student rows start collapsed; this holds the keys of the ones opened.
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  const [allTransactions, setAllTransactions] = useState([]);
  const [editingFeeId, setEditingFeeId] = useState(null);
  const [feeAdjustmentAmount, setFeeAdjustmentAmount] = useState("");
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [editingFineId, setEditingFineId] = useState(null);
  const [fineAdjustmentAmount, setFineAdjustmentAmount] = useState("");
  const [savingFineAdjustment, setSavingFineAdjustment] = useState(false);
  const [paymentMethodByFee, setPaymentMethodByFee] = useState({});
  const [paymentDateByFee, setPaymentDateByFee] = useState({});
  const [paymentAmountByFee, setPaymentAmountByFee] = useState({});
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [undoingTxnId, setUndoingTxnId] = useState(null);
  const [downloadingUnpaid, setDownloadingUnpaid] = useState(false);
  const [downloadingRegister, setDownloadingRegister] = useState(false);
  const [sendingStatementFor, setSendingStatementFor] = useState(null);

  const fetchPending = async () => {
    setLoading(true);
    // Embedded rather than a fee lookup per pending transaction.
    const { data } = await supabase
      .from("payment_transactions")
      .select("*, fees(*, students(name, roll_no, program))")
      .eq("status", "Pending Verification")
      .order("created_at", { ascending: false });

    if (data) setPending(data);
    setLoading(false);
  };

  // One query, not two per fee. This used to fire 1 + 2N requests — 135 of them
  // on a 67-row fee table — and every new student made the tab slower. The
  // student is joined with !inner so a deleted one drops the fee outright, and
  // her payments come back embedded instead of being looked up row by row.
  const fetchUnpaidFees = async () => {
    const { data: feesData } = await supabase
      .from("fees")
      .select(
        "id, student_id, amount_due, amount_paid, fine_amount, due_date, status, label, sort_order, " +
        "students!inner(id, name, roll_no, program, year_of_study, phone, whatsapp), " +
        "payment_transactions(amount, status)"
      )
      .is("students.deleted_at", null)
      .order("due_date", { ascending: true })
      .order("sort_order", { ascending: true, nullsFirst: true });

    if (feesData) {
      const enriched = feesData.map((fee) => {
        const paidAmount = (fee.payment_transactions || [])
          .filter((txn) => txn.status === "Success")
          .reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
        return {
          ...fee,
          student: fee.students,
          remaining_amount: Math.max(totalWithFine(fee) - paidAmount, 0),
        };
      });

      setUnpaidFees(
        enriched.filter(
          (fee) => fee.student && Number(fee.remaining_amount || 0) > 0 && !["Paid"].includes(fee.status)
        )
      );
    }
  };

  // Every transaction, not the last 20: the collection totals below are only
  // right if they see the whole history. One embedded query instead of a lookup
  // per row, which also stops this getting slower as records pile up.
  const fetchAll = async () => {
    const { data } = await supabase
      .from("payment_transactions")
      .select("*, fees(id, label, due_date, students(id, name, roll_no, program, year_of_study))")
      .order("created_at", { ascending: false });
    setAllTransactions(data || []);
  };

  useEffect(() => {
    const loadData = async () => {
      await fetchPending();
      await fetchUnpaidFees();
      await fetchAll();
    };
    loadData();
  }, []);

  const resolve = async (txn, newStatus) => {
    setProcessing(true);
    await supabase
      .from("payment_transactions")
      .update({ status: newStatus, verified_by: "Admin" })
      .eq("id", txn.id);

      if (newStatus === "Success") {
      const { data: feeData, error: feeError } = await supabase
        .from("fees")
        .select("amount_due, fine_amount, due_date")
        .eq("id", txn.fee_id)
        .single();

      const { data: successTxns, error: txnError } = await supabase
        .from("payment_transactions")
        .select("amount, created_at")
        .eq("fee_id", txn.fee_id)
        .eq("status", "Success");

      if (feeError || txnError) {
        console.error("Failed to resolve fee approval:", feeError || txnError);
      }

      const paidAmount = (successTxns || []).reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const latestPaymentDate = (successTxns || []).reduce((latest, t) => {
        if (!t.created_at) return latest;
        const txDate = new Date(t.created_at);
        return !latest || txDate > latest ? txDate : latest;
      }, null);

      // Added once, the moment a deposit against this fee turns out to be late —
      // never stacked on a later partial payment, and never touched again once
      // set (the admin's own Edit Fine is the only other writer of this column).
      const existingFine = Number(feeData?.fine_amount || 0);
      const fineAmount = existingFine === 0 && isLatePayment(feeData?.due_date, txn.created_at)
        ? LATE_FEE_AMOUNT
        : existingFine;
      const remaining = Math.max(Number(feeData?.amount_due || 0) + fineAmount - paidAmount, 0);

      await supabase
        .from("fees")
        .update({
          status: remaining > 0 ? "Partially Paid" : "Paid",
          amount_paid: paidAmount,
          fine_amount: fineAmount,
          last_payment_date: latestPaymentDate ? latestPaymentDate.toISOString() : new Date().toISOString(),
        })
        .eq("id", txn.fee_id);
    } else {
      const { data: feeData } = await supabase
        .from("fees")
        .select("amount_due, amount_paid, fine_amount")
        .eq("id", txn.fee_id)
        .single();

      const previousPaid = Number(feeData?.amount_paid || 0);
      const remaining = Math.max(totalWithFine(feeData) - previousPaid, 0);
      await supabase
        .from("fees")
        .update({ status: remaining > 0 ? (previousPaid > 0 ? "Partially Paid" : "Unpaid") : "Paid" })
        .eq("id", txn.fee_id);
    }

    setPending((p) => p.filter((t) => t.id !== txn.id));
    setProcessing(false);
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
  };

  const statusBadge = (status) => {
    const map = {
      "Pending Verification": "fee-v__badge--pending",
      Success: "fee-v__badge--success",
      Rejected: "fee-v__badge--rejected",
      Failed: "fee-v__badge--rejected",
    };
    return (
      <span className={"fee-v__badge " + (map[status] || "fee-v__badge--pending")}>
        {status}
      </span>
    );
  };

  const openReceipt = (url) => {
    window.open(url, "_blank");
  };

  const filteredUnpaidFees = unpaidFees.filter((fee) => {
    if (yearFilter === "Both") return true;
    return fee.student?.year_of_study === yearFilter;
  });

  /* ---------- Grouping for the Unpaid Fee tab ---------- */

  // One entry per student instead of one per fee, so a girl with three
  // outstanding instalments appears once with a "3" badge rather than three
  // times down the list.
  const groupByStudent = (fees) => {
    const map = new Map();
    for (const fee of fees) {
      const id = fee.student?.id;
      if (!id) continue;
      if (!map.has(id)) map.set(id, { student: fee.student, fees: [], total: 0 });
      const g = map.get(id);
      g.fees.push(fee);
      g.total += Number(fee.remaining_amount || 0);
    }
    return [...map.values()].sort((a, b) => a.student.name.localeCompare(b.student.name));
  };

  const monthKeyOf = (fee) => (fee.due_date ? fee.due_date.slice(0, 7) : "no-date");
  const monthLabelOf = (key) =>
    key === "no-date"
      ? "No due date"
      : new Date(`${key}-01T00:00:00`).toLocaleDateString("en-PK", { month: "long", year: "numeric" });

  const overallGroups = groupByStudent(filteredUnpaidFees);

  // Every month that has something outstanding, oldest first.
  const unpaidMonths = [...new Set(filteredUnpaidFees.map(monthKeyOf))].sort();

  // Get current month in YYYY-MM format
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Picking a month answers "what is outstanding by the end of this month?", so
  // it accumulates everything due up to and including it. Later months are
  // deliberately excluded — those are what the Overall view is for. Derived
  // rather than stored, so the choice stays valid when the year filter changes.
  const activeUnpaidMonth = unpaidMonths.includes(unpaidMonth)
    ? unpaidMonth
    : unpaidMonths.includes(currentMonth)
      ? currentMonth
      : unpaidMonths[unpaidMonths.length - 1] || null;

  const feesUpToMonth = activeUnpaidMonth
    ? filteredUnpaidFees.filter((f) => monthKeyOf(f) <= activeUnpaidMonth)
    : [];
  const monthGroups = groupByStudent(feesUpToMonth);
  const monthTotal = feesUpToMonth.reduce((s, f) => s + Number(f.remaining_amount || 0), 0);

  const overallTotal = filteredUnpaidFees.reduce((s, f) => s + Number(f.remaining_amount || 0), 0);
  const summaryStudentsCount = unpaidView === "monthly" ? monthGroups.length : overallGroups.length;
  const summaryPendingFeesCount = unpaidView === "monthly" ? feesUpToMonth.length : filteredUnpaidFees.length;
  const summaryPendingTotal = unpaidView === "monthly" ? monthTotal : overallTotal;

  /* ---------- Fee collection (All Transactions tab) ---------- */

  const filteredTransactions =
    yearFilter === "Both"
      ? allTransactions
      : allTransactions.filter((t) => t.fees?.students?.year_of_study === yearFilter);

  const successful = filteredTransactions.filter((t) => t.status === "Success");
  const txMonthKeyOf = (t) => (t.created_at ? t.created_at.slice(0, 7) : "no-date");
  const txMonths = [...new Set(successful.map(txMonthKeyOf))].sort().reverse();

  const activeTxMonth = txMonths.includes(txMonth) ? txMonth : txMonths[0] || null;

  // Collection is per month, not cumulative: "how much came in during September".
  const shownTransactions =
    txView === "overall"
      ? filteredTransactions
      : filteredTransactions.filter((t) => txMonthKeyOf(t) === activeTxMonth);
  const shownSuccessful = shownTransactions.filter((t) => t.status === "Success");
  const collected = shownSuccessful.reduce((s, t) => s + Number(t.amount || 0), 0);
  const payingStudents = new Set(
    shownSuccessful.map((t) => t.fees?.students?.id).filter(Boolean)
  ).size;

  const toggleGroup = (key) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const fmtDue = (d) =>
    d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "—";

  // Exports exactly what is on screen — the Overall list or the "up to this
  // month" list, under whichever year filter is active — so the sheet can
  // never disagree with the tab it was downloaded from.
  const downloadUnpaidList = async () => {
    const rowsSource = unpaidView === "monthly" ? feesUpToMonth : filteredUnpaidFees;
    if (rowsSource.length === 0) return;
    setDownloadingUnpaid(true);

    const sorted = [...rowsSource].sort((a, b) => {
      const nameCmp = (a.student?.name || "").localeCompare(b.student?.name || "");
      return nameCmp !== 0 ? nameCmp : (a.due_date || "").localeCompare(b.due_date || "");
    });
    const total = sorted.reduce((sum, f) => sum + Number(f.remaining_amount || 0), 0);
    const subtitle =
      unpaidView === "monthly"
        ? `Unpaid Fees — up to ${monthLabelOf(activeUnpaidMonth)} (${yearFilter})`
        : `Unpaid Fees — Overall (${yearFilter})`;

    const rows = [
      [{ v: "Community Model Girls College, Rawalpindi", s: S.TITLE }],
      [{ v: subtitle, s: S.LABEL }],
      [],
      ["Roll No", "Name", "Program", "Year", "Fee", "Due Date", "Fine (Rs)", "Pending (Rs)"].map((h) => ({ v: h, s: S.HEAD })),
      ...sorted.map((f) => [
        { v: f.student?.roll_no || "", s: S.TEXT },
        { v: f.student?.name || "", s: S.TEXT },
        { v: f.student?.program || "", s: S.TEXT },
        { v: f.student?.year_of_study || "", s: S.CENTER },
        { v: f.label || "Fee", s: S.TEXT },
        { v: fmtDue(f.due_date), s: S.CENTER },
        { v: Number(f.fine_amount || 0), s: S.CENTER },
        { v: Number(f.remaining_amount || 0), s: S.CENTER },
      ]),
      [
        { s: S.BAND }, { s: S.BAND }, { s: S.BAND }, { s: S.BAND }, { s: S.BAND },
        { v: "Total", s: S.BAND },
        { s: S.BAND },
        { v: total, s: S.BAND },
      ],
    ];

    const columns = [
      { width: 16 }, { width: 24 }, { width: 20 }, { width: 10 }, { width: 24 }, { width: 14 }, { width: 12 }, { width: 16 },
    ];

    const tag = unpaidView === "monthly" ? (activeUnpaidMonth || "month") : "overall";
    await downloadXlsx(`Unpaid-Fees-${tag}-${yearFilter.replace(/\s+/g, "")}`, {
      sheetName: "Unpaid Fees",
      rows,
      columns,
      freeze: { row: 4 },
    });
    setDownloadingUnpaid(false);
  };

  const monthShortLabelOf = (key) =>
    key === "no-date"
      ? "Undated"
      : new Date(`${key}-01T00:00:00`).toLocaleDateString("en-PK", { month: "short", year: "2-digit" });

  // Every student's whole fee position in one sheet — her total charge, what
  // she has paid broken down by the month it came in, and what is still
  // pending — rather than the Unpaid tab's list, which only ever named the
  // ones still owing. A fresh fetch rather than reusing unpaidFees/
  // allTransactions: this needs every fee (paid ones included) and every
  // student's total, neither of which either of those two states carries.
  const downloadFullFeeRegister = async () => {
    setDownloadingRegister(true);

    const { data: feesData, error } = await supabase
      .from("fees")
      .select(
        "id, student_id, amount_due, fine_amount, due_date, status, " +
        "students!inner(id, name, roll_no, program, year_of_study), " +
        "payment_transactions(amount, status, created_at)"
      )
      .is("students.deleted_at", null);

    if (error) {
      setDownloadingRegister(false);
      alert("Failed to build the fee register: " + error.message);
      return;
    }
    if (!feesData || feesData.length === 0) {
      setDownloadingRegister(false);
      return;
    }

    const scoped =
      yearFilter === "Both" ? feesData : feesData.filter((f) => f.students?.year_of_study === yearFilter);

    const byStudent = new Map();
    const monthSet = new Set();

    for (const fee of scoped) {
      const student = fee.students;
      if (!student) continue;
      if (!byStudent.has(student.id)) {
        byStudent.set(student.id, { student, totalDue: 0, totalPaid: 0, monthly: {} });
      }
      const entry = byStudent.get(student.id);
      entry.totalDue += totalWithFine(fee);
      for (const txn of fee.payment_transactions || []) {
        if (txn.status !== "Success") continue;
        const amt = Number(txn.amount || 0);
        const key = txn.created_at ? txn.created_at.slice(0, 7) : "no-date";
        monthSet.add(key);
        entry.totalPaid += amt;
        entry.monthly[key] = (entry.monthly[key] || 0) + amt;
      }
    }

    if (byStudent.size === 0) {
      setDownloadingRegister(false);
      return;
    }

    const months = [...monthSet].sort();
    const students = [...byStudent.values()].sort((a, b) => a.student.name.localeCompare(b.student.name));

    const headerRow = [
      "Roll No", "Name", "Program", "Year",
      ...months.map(monthShortLabelOf),
      "Total Fee (Rs)", "Total Paid (Rs)", "Total Pending (Rs)", "Status",
    ].map((h) => ({ v: h, s: S.HEAD }));

    const bodyRows = students.map(({ student, totalDue, totalPaid, monthly }) => {
      const pending = Math.max(totalDue - totalPaid, 0);
      const status = pending === 0 ? "Paid" : totalPaid > 0 ? "Partially Paid" : "Unpaid";
      return [
        { v: student.roll_no || "", s: S.TEXT },
        { v: student.name || "", s: S.TEXT },
        { v: student.program || "", s: S.TEXT },
        { v: student.year_of_study || "", s: S.CENTER },
        ...months.map((m) => ({ v: monthly[m] || 0, s: S.CENTER })),
        { v: totalDue, s: S.CENTER },
        { v: totalPaid, s: S.CENTER },
        { v: pending, s: S.CENTER },
        { v: status, s: S.CENTER },
      ];
    });

    const grandDue = students.reduce((s, x) => s + x.totalDue, 0);
    const grandPaid = students.reduce((s, x) => s + x.totalPaid, 0);
    const grandPending = Math.max(grandDue - grandPaid, 0);
    const monthTotals = months.map((m) => students.reduce((s, x) => s + (x.monthly[m] || 0), 0));

    const totalRow = [
      { s: S.BAND }, { v: "Total", s: S.BAND }, { s: S.BAND }, { s: S.BAND },
      ...monthTotals.map((v) => ({ v, s: S.BAND })),
      { v: grandDue, s: S.BAND },
      { v: grandPaid, s: S.BAND },
      { v: grandPending, s: S.BAND },
      { s: S.BAND },
    ];

    const rows = [
      [{ v: "Community Model Girls College, Rawalpindi", s: S.TITLE }],
      [{ v: `Fee Register — Paid & Pending (${yearFilter})`, s: S.LABEL }],
      [],
      headerRow,
      ...bodyRows,
      totalRow,
    ];

    const columns = [
      { width: 16 }, { width: 24 }, { width: 20 }, { width: 10 },
      ...months.map(() => ({ width: 12 })),
      { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 },
    ];

    await downloadXlsx(`Fee-Register-${yearFilter.replace(/\s+/g, "")}`, {
      sheetName: "Fee Register",
      rows,
      columns,
      freeze: { row: 4, col: 4 },
    });
    setDownloadingRegister(false);
  };

  // One outstanding charge, with the controls that were previously spread across
  // the table row: adjust the amount, nudge on WhatsApp, or record a payment.
  const renderFeeDetail = (fee) => (
    <div key={fee.id} className="fee-v__detail">
      <div className="fee-v__detail-head">
        <span className="fee-v__detail-label">{fee.label || "Fee"}</span>
        <span className="fee-v__detail-amount">Rs {Number(fee.remaining_amount || 0).toLocaleString()}</span>
        <span className="fee-v__detail-due">Due {fmtDue(fee.due_date)}</span>
        {Number(fee.fine_amount || 0) > 0 && (
          <span className="fee-v__detail-fine">+ Rs {Number(fee.fine_amount).toLocaleString()} late fee</span>
        )}
      </div>

      <div className="fee-v__detail-actions">
        {editingFeeId === fee.id ? (
          <div className="fee-v__edit-row">
            <input
              type="number"
              value={feeAdjustmentAmount}
              onChange={(e) => setFeeAdjustmentAmount(e.target.value)}
            />
            <button onClick={() => saveFeeAdjustment(fee)} disabled={savingAdjustment} className="fee-v__view">
              {savingAdjustment ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setEditingFeeId(null)} className="fee-v__reject">Cancel</button>
          </div>
        ) : editingFineId === fee.id ? (
          <div className="fee-v__edit-row">
            <input
              type="number"
              min="0"
              value={fineAdjustmentAmount}
              onChange={(e) => setFineAdjustmentAmount(e.target.value)}
            />
            <button onClick={() => saveFineAdjustment(fee)} disabled={savingFineAdjustment} className="fee-v__view">
              {savingFineAdjustment ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setEditingFineId(null)} className="fee-v__reject">Cancel</button>
          </div>
        ) : (
          <div className="fee-v__edit-row">
            <button onClick={() => startFeeEdit(fee)} className="fee-v__view">Edit Fee</button>
            <button onClick={() => startFineEdit(fee)} className="fee-v__view" title="Increase, reduce, or clear the late fee">
              {Number(fee.fine_amount || 0) > 0 ? "Edit Fine" : "Add Fine"}
            </button>
            <button
              onClick={() => sendFeeReminderWhatsApp(fee, (studentId, savedNumber) => {
                setUnpaidFees((prev) => prev.map((f) =>
                  f.student?.id === studentId ? { ...f, student: { ...f.student, whatsapp: savedNumber } } : f
                ));
              })}
              className="fee-v__whatsapp"
              title="Send fee deposit reminder via WhatsApp"
            >
              <WhatsappIcon />
            </button>
          </div>
        )}

        <div className="fee-v__record-payment">
          <input
            type="number"
            min="0"
            max={fee.remaining_amount}
            placeholder="Amount paid"
            className="fee-v__amount-input"
            value={getPaymentAmount(fee)}
            onChange={(e) => setPaymentAmountByFee((p) => ({ ...p, [fee.id]: e.target.value }))}
          />
          <select
            value={getPaymentMethod(fee.id)}
            onChange={(e) => setPaymentMethodByFee((p) => ({ ...p, [fee.id]: e.target.value }))}
          >
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input
            type="date"
            value={getPaymentDate(fee.id)}
            onChange={(e) => setPaymentDateByFee((p) => ({ ...p, [fee.id]: e.target.value }))}
          />
          <button
            onClick={() => markFeePaid(fee)}
            disabled={markingPaidId === fee.id}
            className="fee-v__mark-paid"
          >
            {markingPaidId === fee.id ? "Saving..." : "Mark Paid"}
          </button>
        </div>
      </div>
    </div>
  );

  // A collapsed student row. `keyPrefix` keeps the open/closed state separate per
  // month, so expanding a girl under August does not also expand her under November.
  const renderStudentGroup = (group, keyPrefix) => {
    const key = keyPrefix + group.student.id;
    const open = expandedGroups.has(key);
    const sending = sendingStatementFor === group.student.id;
    return (
      <div key={key} className={"fee-v__group " + (open ? "fee-v__group--open" : "")}>
        <div className="fee-v__group-head">
          <button className="fee-v__group-toggle" onClick={() => toggleGroup(key)} aria-expanded={open}>
            <span className="fee-v__caret">{open ? "▾" : "▸"}</span>
            <span className="fee-v__group-name">{group.student.name}</span>
            <span className="fee-v__group-meta">{group.student.roll_no}</span>
            <span className="fee-v__group-meta">{group.student.program}</span>
            <span className="fee-v__group-meta">{group.student.year_of_study || "—"}</span>
            <span className="fee-v__badge" title={`${group.fees.length} pending fee${group.fees.length === 1 ? "" : "s"}`}>
              {group.fees.length}
            </span>
            <span className="fee-v__group-total">Rs {group.total.toLocaleString()}</span>
          </button>
          <button
            className="fee-v__whatsapp fee-v__group-whatsapp"
            title="Send full fee record (paid & pending) via WhatsApp"
            disabled={sending}
            onClick={(e) => {
              e.stopPropagation();
              setSendingStatementFor(group.student.id);
              sendFullFeeStatementWhatsApp(
                group.student,
                (studentId, savedNumber) => {
                  setUnpaidFees((prev) => prev.map((f) =>
                    f.student?.id === studentId ? { ...f, student: { ...f.student, whatsapp: savedNumber } } : f
                  ));
                },
                () => setSendingStatementFor(null)
              );
            }}
          >
            <WhatsappIcon />
          </button>
        </div>
        {open && <div className="fee-v__group-body">{group.fees.map(renderFeeDetail)}</div>}
      </div>
    );
  };

  const startFeeEdit = (fee) => {
    setEditingFeeId(fee.id);
    setFeeAdjustmentAmount(String(fee.amount_due || ""));
  };

  const saveFeeAdjustment = async (fee) => {
    if (!feeAdjustmentAmount || isNaN(feeAdjustmentAmount)) return;
    setSavingAdjustment(true);

    const { data: transactions } = await supabase
      .from("payment_transactions")
      .select("amount, status")
      .eq("fee_id", fee.id)
      .eq("status", "Success");

    const paidAmount = (transactions || []).reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
    // This box edits the base charge only — the fine (if any) is untouched and
    // is backed out of the new total so the combined remaining still comes to
    // whatever was typed. "Edit Fine" below is the only thing that moves fine_amount.
    const fineAmount = Number(fee.fine_amount || 0);
    const newRemainingAmount = Math.max(Number(feeAdjustmentAmount), 0);
    const newTotalDue = paidAmount + newRemainingAmount;
    const newAmountDue = Math.max(newTotalDue - fineAmount, 0);
    const newStatus = newRemainingAmount > 0
      ? (fee.status === "Pending Verification" ? "Pending Verification" : (paidAmount > 0 ? "Partially Paid" : "Unpaid"))
      : "Paid";

    const { error } = await supabase
      .from("fees")
      .update({
        amount_due: newAmountDue,
        amount_paid: paidAmount,
        status: newStatus,
      })
      .eq("id", fee.id);

    setSavingAdjustment(false);
    if (error) {
      alert("Failed to update fee amount: " + error.message);
      return;
    }
    setEditingFeeId(null);
    setFeeAdjustmentAmount("");
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
  };

  // The office's own control over a fine — whether it was added automatically
  // by a late deposit or never applied at all: increase it, reduce it, or clear
  // it to 0. Independent of "Edit Fee" above, which only ever moves the base charge.
  const startFineEdit = (fee) => {
    setEditingFineId(fee.id);
    setFineAdjustmentAmount(String(fee.fine_amount || 0));
  };

  const saveFineAdjustment = async (fee) => {
    if (fineAdjustmentAmount === "" || isNaN(fineAdjustmentAmount)) return;
    setSavingFineAdjustment(true);

    const { data: transactions } = await supabase
      .from("payment_transactions")
      .select("amount, status")
      .eq("fee_id", fee.id)
      .eq("status", "Success");

    const paidAmount = (transactions || []).reduce((sum, txn) => sum + Number(txn.amount || 0), 0);
    const newFine = Math.max(Number(fineAdjustmentAmount), 0);
    const newRemaining = Math.max(Number(fee.amount_due || 0) + newFine - paidAmount, 0);
    const newStatus = newRemaining > 0
      ? (fee.status === "Pending Verification" ? "Pending Verification" : (paidAmount > 0 ? "Partially Paid" : "Unpaid"))
      : "Paid";

    const { error } = await supabase
      .from("fees")
      .update({ fine_amount: newFine, status: newStatus })
      .eq("id", fee.id);

    setSavingFineAdjustment(false);
    if (error) {
      alert("Failed to update fine: " + error.message);
      return;
    }
    setEditingFineId(null);
    setFineAdjustmentAmount("");
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
  };

  const todayStr = () => new Date().toISOString().split("T")[0];
  const getPaymentMethod = (feeId) => paymentMethodByFee[feeId] || DEFAULT_PAYMENT_METHOD;
  const getPaymentDate = (feeId) => paymentDateByFee[feeId] || todayStr();
  const getPaymentAmount = (fee) => {
    const stored = paymentAmountByFee[fee.id];
    return stored !== undefined ? stored : String(fee.remaining_amount || "");
  };

  const markFeePaid = async (fee) => {
    const method = getPaymentMethod(fee.id);
    const date = getPaymentDate(fee.id);
    const amountToRecord = Number(getPaymentAmount(fee));
    const paidAtIso = new Date(date).toISOString();

    // Added once, the moment this deposit turns out to be late — never touched
    // again once set, so a fine the office has already waived or corrected by
    // hand (Edit Fine) is never re-applied by a later partial payment.
    const existingFine = Number(fee.fine_amount || 0);
    const fineAmount = existingFine === 0 && isLatePayment(fee.due_date, paidAtIso)
      ? LATE_FEE_AMOUNT
      : existingFine;
    const previousPaid = Math.max(Number(fee.amount_due || 0) + existingFine - Number(fee.remaining_amount || 0), 0);
    const remainingAmount = Math.max(Number(fee.amount_due || 0) + fineAmount - previousPaid, 0);

    if (!amountToRecord || isNaN(amountToRecord) || amountToRecord <= 0) {
      alert("Please enter a valid amount paid.");
      return;
    }
    if (amountToRecord > remainingAmount) {
      alert(`Amount paid cannot exceed the pending amount (Rs ${remainingAmount.toLocaleString()}).`);
      return;
    }

    const newRemaining = remainingAmount - amountToRecord;
    const newStatus = newRemaining <= 0 ? "Paid" : "Partially Paid";

    const confirmMark = window.confirm(
      `Mark Rs ${amountToRecord.toLocaleString()} as paid for ${fee.student?.name || "this student"} via ${method} on ${date}?` +
      (fineAmount > existingFine ? ` A Rs ${LATE_FEE_AMOUNT.toLocaleString()} late fee applies — this is after the due date.` : "") +
      (newRemaining > 0 ? ` Rs ${newRemaining.toLocaleString()} will remain pending.` : " This fully settles the fee.")
    );
    if (!confirmMark) return;

    setMarkingPaidId(fee.id);

    const { error: txnError } = await supabase.from("payment_transactions").insert({
      fee_id: fee.id,
      payment_method: method,
      amount: amountToRecord,
      status: "Success",
      verified_by: "Admin",
      recorded_by: "admin",
      created_at: paidAtIso,
    });

    if (txnError) {
      setMarkingPaidId(null);
      alert("Failed to record payment: " + txnError.message);
      return;
    }

    await supabase
      .from("fees")
      .update({
        status: newStatus,
        amount_paid: previousPaid + amountToRecord,
        fine_amount: fineAmount,
        last_payment_date: paidAtIso,
      })
      .eq("id", fee.id);

    setMarkingPaidId(null);
    setPaymentAmountByFee((p) => {
      const next = { ...p };
      delete next[fee.id];
      return next;
    });
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
  };

  // "Undo" on a row in All Transactions — for a payment recorded by a wrong
  // click. The transaction is marked Rejected rather than deleted (the record of
  // the correction is worth keeping, and every collection total here already
  // counts only Success rows), then the fee is re-derived from whatever Success
  // payments are left: amount_paid, status and last_payment_date all recompute,
  // exactly as resolve() does it. A late fee already added stays put — only the
  // Unpaid Fee tab's "Edit Fine" clears it, same as everywhere else.
  const undoTransaction = async (txn) => {
    const studentName = txn.fees?.students?.name || "this student";
    const amt = Number(txn.amount || 0).toLocaleString();
    const when = txn.created_at
      ? new Date(txn.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })
      : "";
    const wasSuccess = txn.status === "Success";
    const ok = window.confirm(
      `Undo this Rs ${amt} payment for ${studentName}${when ? ` (recorded ${when})` : ""}?\n\n` +
      (wasSuccess
        ? "The entry will be marked Rejected and the fee re-opened so the correct payment can be recorded again. Any late fee already added stays — clear it from the Unpaid Fee tab if it was a mistake."
        : "The pending entry will be marked Rejected.")
    );
    if (!ok) return;

    setUndoingTxnId(txn.id);

    const { data: voided, error: voidErr } = await supabase
      .from("payment_transactions")
      .update({ status: "Rejected", verified_by: "Admin (undo)" })
      .eq("id", txn.id)
      .select("id");

    if (voidErr || !voided || voided.length === 0) {
      setUndoingTxnId(null);
      alert(
        "Could not undo this payment. " +
        (voidErr?.message || "It may already have been changed, or your session has expired — sign in again.")
      );
      return;
    }

    const feeId = txn.fee_id || txn.fees?.id;

    // select("*") rather than naming columns, so this keeps working whether or
    // not the late-fee migration has been run. Never decide the fee's status on
    // a failed read — writing "Paid" here (the zero-remaining default) is exactly
    // how a re-opened fee vanished from the Unpaid tab instead of reappearing.
    const { data: feeData, error: feeErr } = await supabase
      .from("fees")
      .select("*")
      .eq("id", feeId)
      .single();

    if (feeErr || !feeData) {
      setUndoingTxnId(null);
      await fetchPending();
      await fetchAll();
      alert(
        "The payment was undone, but the fee could not be re-opened automatically" +
        (feeErr?.message ? ` (${feeErr.message})` : "") +
        ". Open the Unpaid Fee tab and use \"Edit Fee\" to set the pending amount."
      );
      return;
    }

    const { data: successTxns } = await supabase
      .from("payment_transactions")
      .select("amount, created_at")
      .eq("fee_id", feeId)
      .eq("status", "Success");

    const paidAmount = (successTxns || []).reduce((s, t) => s + Number(t.amount || 0), 0);
    const latest = (successTxns || []).reduce((acc, t) => {
      if (!t.created_at) return acc;
      const d = new Date(t.created_at);
      return !acc || d > acc ? d : acc;
    }, null);
    const remaining = Math.max(totalWithFine(feeData) - paidAmount, 0);
    const status = remaining <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";

    const { data: reopened, error: reopenErr } = await supabase
      .from("fees")
      .update({
        amount_paid: paidAmount,
        status,
        last_payment_date: latest ? latest.toISOString() : null,
      })
      .eq("id", feeId)
      .select("id");

    if (reopenErr || !reopened || reopened.length === 0) {
      setUndoingTxnId(null);
      await fetchPending();
      await fetchUnpaidFees();
      await fetchAll();
      alert(
        "The payment was undone, but re-opening the fee failed" +
        (reopenErr?.message ? ` (${reopenErr.message})` : " — your session may have expired, sign in again") +
        ". The fee still shows as paid; fix it from the Unpaid Fee tab."
      );
      return;
    }

    setUndoingTxnId(null);
    await fetchPending();
    await fetchUnpaidFees();
    await fetchAll();
  };

  return (
    <div className="fee-v">
      <div className="fee-v__tabs">
        <button
          onClick={() => setActiveTab("pending")}
          className={"fee-v__tab " + (activeTab === "pending" ? "fee-v__tab--active" : "")}
        >
          Pending Verification
          {pending.length > 0 && (
            <span className="fee-v__count">{pending.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("unpaid")}
          className={"fee-v__tab " + (activeTab === "unpaid" ? "fee-v__tab--active" : "")}
        >
          Unpaid Fee
          {unpaidFees.length > 0 && (
            <span className="fee-v__count">{unpaidFees.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("all")}
          className={"fee-v__tab " + (activeTab === "all" ? "fee-v__tab--active" : "")}
        >
          All Transactions
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={"fee-v__tab " + (activeTab === "settings" ? "fee-v__tab--active" : "")}
        >
          Fee Settings
        </button>
      </div>

      {activeTab === "settings" && <FeeSettings />}

      {activeTab === "pending" && (
        <div>
          {loading ? (
            <p className="fee-v__empty">Loading...</p>
          ) : pending.length === 0 ? (
            <div className="fee-v__empty">
              <Check size={32} className="fee-v__empty-icon" />
              <p>No pending verifications</p>
            </div>
          ) : (
            <div className="fee-v__list">
              {pending.map((p) => (
                <div key={p.id} className="fee-v__card">
                  <div className="fee-v__card-info">
                    <p className="fee-v__student-name">
                      {p.fees && p.fees.students ? p.fees.students.name : "Unknown"}
                      <span>
                        {" "}
                        (
                        {p.fees && p.fees.students
                          ? p.fees.students.roll_no
                          : "—"}
                        )
                      </span>
                    </p>
                    <p className="fee-v__meta">
                      {p.payment_method} &bull; {p.payment_method === "Cash in College Office" ? "Receipt" : "Ref"}: {p.reference_number} &bull; Rs{" "}
                      {p.amount ? p.amount.toLocaleString() : "—"}
                    </p>
                    <p className="fee-v__date">
                      {new Date(p.created_at).toLocaleDateString("en-PK", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="fee-v__card-actions">
                    {p.proof_image_url ? (
                      <button
                        onClick={() => openReceipt(p.proof_image_url)}
                        className="fee-v__view"
                      >
                        <Eye size={14} /> Receipt
                      </button>
                    ) : null}
                    <button
                      onClick={() => resolve(p, "Success")}
                      disabled={processing}
                      className="fee-v__approve"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      onClick={() => resolve(p, "Rejected")}
                      disabled={processing}
                      className="fee-v__reject"
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="fee-v__note">
            <p>
              Approving will mark fee as <strong>Paid</strong>. Rejecting will
              keep it <strong>Unpaid</strong>.
            </p>
          </div>
        </div>
      )}

      {activeTab === "unpaid" && (
        <div className="fee-v__unpaid">
          <div className="fee-v__filters">
            <div className="fee-v__year-filters" role="group" aria-label="Filter by class year">
              {["1st Year", "2nd Year", "Both"].map((y) => (
                <button
                  key={y}
                  onClick={() => setYearFilter(y)}
                  className={"fee-v__year-btn " + (yearFilter === y ? "fee-v__year-btn--active" : "")}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="fee-v__filters-right">
              <div className="fee-v__view-toggle" role="group" aria-label="Pending fee view">
                <button
                  onClick={() => setUnpaidView("overall")}
                  className={"fee-v__view-btn " + (unpaidView === "overall" ? "fee-v__view-btn--active" : "")}
                >
                  Overall
                </button>
                <button
                  onClick={() => setUnpaidView("monthly")}
                  className={"fee-v__view-btn " + (unpaidView === "monthly" ? "fee-v__view-btn--active" : "")}
                >
                  Month wise
                </button>
              </div>
              <button
                onClick={downloadUnpaidList}
                disabled={downloadingUnpaid || filteredUnpaidFees.length === 0}
                className="fee-v__download-btn"
              >
                <Download size={14} /> {downloadingUnpaid ? "Preparing..." : "Download List (.xlsx)"}
              </button>
            </div>
          </div>

          <div className="fee-v__summary">
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">{summaryStudentsCount}</p>
              <p className="fee-v__stat-label">Students</p>
            </div>
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">{summaryPendingFeesCount}</p>
              <p className="fee-v__stat-label">Pending Fees</p>
            </div>
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">{unpaidMonths.length}</p>
              <p className="fee-v__stat-label">Months</p>
            </div>
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">Rs {summaryPendingTotal.toLocaleString()}</p>
              <p className="fee-v__stat-label">Total Pending</p>
            </div>
          </div>

          {filteredUnpaidFees.length === 0 ? (
            <p className="fee-v__empty">No unpaid fees found</p>
          ) : unpaidView === "overall" ? (
            <div className="fee-v__groups">
              {overallGroups.map((g) => renderStudentGroup(g, "all:"))}
            </div>
          ) : (
            <>
              <div className="fee-v__month-picker">
                <span className="fee-v__month-picker-label">Show pending up to:</span>
                <div className="fee-v__month-chips">
                  {unpaidMonths.map((m) => (
                    <button
                      key={m}
                      onClick={() => setUnpaidMonth(m)}
                      className={"fee-v__month-chip " + (m === activeUnpaidMonth ? "fee-v__month-chip--active" : "")}
                    >
                      {monthLabelOf(m)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="fee-v__month-summary">
                Outstanding by the end of <strong>{monthLabelOf(activeUnpaidMonth)}</strong>:{" "}
                {monthGroups.length} student{monthGroups.length === 1 ? "" : "s"} ·{" "}
                {feesUpToMonth.length} fee{feesUpToMonth.length === 1 ? "" : "s"} ·{" "}
                <strong>Rs {monthTotal.toLocaleString()}</strong>
                {feesUpToMonth.length < filteredUnpaidFees.length && (
                  <span className="fee-v__month-note">
                    {" "}— {filteredUnpaidFees.length - feesUpToMonth.length} later fee
                    {filteredUnpaidFees.length - feesUpToMonth.length === 1 ? "" : "s"} not yet due, see Overall.
                  </span>
                )}
              </div>

              <div className="fee-v__groups">
                {monthGroups.map((g) => renderStudentGroup(g, activeUnpaidMonth + ":"))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "all" && (
        <div className="fee-v__unpaid">
          <div className="fee-v__filters">
            <div className="fee-v__year-filters" role="group" aria-label="Filter by class year">
              {['1st Year', '2nd Year', 'Both'].map((y) => (
                <button
                  key={y}
                  onClick={() => setYearFilter(y)}
                  className={"fee-v__year-btn " + (yearFilter === y ? "fee-v__year-btn--active" : "")}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="fee-v__filters-right">
              <div className="fee-v__view-toggle" role="group" aria-label="Collection view">
                <button
                  onClick={() => setTxView("overall")}
                  className={"fee-v__view-btn " + (txView === "overall" ? "fee-v__view-btn--active" : "")}
                >
                  Overall
                </button>
                <button
                  onClick={() => setTxView("monthly")}
                  className={"fee-v__view-btn " + (txView === "monthly" ? "fee-v__view-btn--active" : "")}
                >
                  Monthly
                </button>
              </div>
              <button
                onClick={downloadFullFeeRegister}
                disabled={downloadingRegister}
                className="fee-v__download-btn"
                title="Every student's total fee, paid month by month, and what is still pending"
              >
                <Download size={14} /> {downloadingRegister ? "Preparing..." : "Download Fee Register (.xlsx)"}
              </button>
            </div>
          </div>

          {txView === "monthly" && txMonths.length > 0 && (
            <div className="fee-v__month-picker">
              <span className="fee-v__month-picker-label">Month:</span>
              <div className="fee-v__month-chips">
                {txMonths.map((m) => (
                  <button
                    key={m}
                    onClick={() => setTxMonth(m)}
                    className={"fee-v__month-chip " + (m === activeTxMonth ? "fee-v__month-chip--active" : "")}
                  >
                    {monthLabelOf(m)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fee-v__summary">
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">Rs {collected.toLocaleString()}</p>
              <p className="fee-v__stat-label">
                {txView === "overall" ? "Collected (all time)" : `Collected in ${monthLabelOf(activeTxMonth)}`}
              </p>
            </div>
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">{payingStudents}</p>
              <p className="fee-v__stat-label">Students Paid</p>
            </div>
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">{shownSuccessful.length}</p>
              <p className="fee-v__stat-label">Payments Received</p>
            </div>
            <div className="fee-v__stat">
              <p className="fee-v__stat-value">{txMonths.length}</p>
              <p className="fee-v__stat-label">Months with Collection</p>
            </div>
          </div>

          <div className="fee-v__table-wrap">
            {shownTransactions.length === 0 ? (
              <p className="fee-v__empty">
                {txView === "overall" ? "No transactions yet" : `No transactions in ${monthLabelOf(activeTxMonth)}`}
              </p>
            ) : (
              <table className="fee-v__table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th>Undo</th>
                </tr>
              </thead>
              <tbody>
                {shownTransactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <p className="fee-v__student-name">
                        {t.fees && t.fees.students ? t.fees.students.name : "—"}
                      </p>
                      <p className="fee-v__roll">
                        {t.fees && t.fees.students ? t.fees.students.roll_no : ""}
                      </p>
                    </td>
                    <td>
                      {t.payment_method}
                      {t.recorded_by === "admin" && <span className="fee-v__admin-tag">Admin Entry</span>}
                    </td>
                    <td>Rs {t.amount ? t.amount.toLocaleString() : "—"}</td>
                    <td>{t.reference_number || "—"}</td>
                    <td>
                      {new Date(t.created_at).toLocaleDateString("en-PK", {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td>{statusBadge(t.status)}</td>
                    <td>
                      {t.proof_image_url ? (
                        <button
                          onClick={() => openReceipt(t.proof_image_url)}
                          className="fee-v__view"
                        >
                          <Eye size={14} /> View
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {t.status === "Success" || t.status === "Pending Verification" ? (
                        <button
                          onClick={() => undoTransaction(t)}
                          disabled={undoingTxnId === t.id}
                          className="fee-v__undo"
                          title="Wrong entry? Undo this payment and re-open the fee"
                        >
                          <RotateCcw size={13} /> {undoingTxnId === t.id ? "Undoing..." : "Undo"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}