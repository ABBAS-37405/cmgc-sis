/**
 * One month's payslip as a PDF.
 *
 * Same two disciplines as `reportPdf.js`, for the same reasons:
 *
 * - **jsPDF is imported dynamically**, never at module top level. It and
 *   autotable are ~400 kB together; a static import would pull the whole PDF
 *   engine into the teacher-portal chunk for every teacher who never opens her
 *   payslip, and into the admin chunk for every admin who never downloads one.
 * - **Nothing here reaches `supabaseClient`.** The caller passes a finished
 *   `calc` from `payroll.js`, so this file can be driven from plain Node against
 *   fixture data — the only way any of it gets exercised in a repo with no test
 *   runner.
 *
 * The slip prints the *working*, not just the total: how many days were worked,
 * what one day is worth, and which days were charged. A payslip that states only
 * a figure is the one that gets argued about.
 */

import { isPerDayType } from "./payroll";

const ACCENT = [29, 78, 216];
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];
const LINE = [226, 232, 240];
const MARGIN = 16;

let pdfLib = null;
async function loadPdfLib() {
  if (!pdfLib) {
    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    pdfLib = { jsPDF, autoTable: autoTableModule.default };
  }
  return pdfLib;
}

/** The crest, fetched once. A missing logo must never stop a slip being produced. */
let logoPromise = null;
function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch("/logo.png")
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob) return null;
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      })
      .catch(() => null);
  }
  return logoPromise;
}

const money = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString("en-PK")}`;
const days = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
const longDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" }) : "—";

const tableTheme = (extra = {}) => ({
  theme: "grid",
  margin: { left: MARGIN, right: MARGIN },
  styles: { fontSize: 9.5, cellPadding: 2.4, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
  headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 9.5, fontStyle: "bold" },
  alternateRowStyles: { fillColor: [248, 250, 252] },
  ...extra,
});

/**
 * @param person   the `teachers` / `staff` row (name, designation, employment type)
 * @param calc     the finished object from `computeSalary()`
 * @param monthText  "August 2026"
 * @param roleLabel  "Teacher", "Security Guard", ...
 * @param status / paidAmount / paidOn / notes  the payment record, if any
 * @returns a Blob — the caller decides whether to download it or attach it
 */
export async function buildPayslipPdf(person, calc, {
  monthText = "",
  roleLabel = "",
  status = "Unpaid",
  paidAmount = 0,
  paidOn = null,
  notes = "",
} = {}) {
  const { jsPDF, autoTable } = await loadPdfLib();
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const width = doc.internal.pageSize.getWidth();

  /* ---------------------------------------------------------- header */

  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, width, 26, "F");

  if (logo) {
    try {
      doc.addImage(logo, "PNG", MARGIN, 4.5, 17, 17);
    } catch {
      // A crest that will not decode must not cost us the slip.
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Community Model Girls College", logo ? MARGIN + 21 : MARGIN, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Salary Slip — ${monthText}`, logo ? MARGIN + 21 : MARGIN, 19);

  let y = 36;

  /* ------------------------------------------------- employee details */

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(person?.name || "—", MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const subtitle = [
    roleLabel,
    person?.department,
    `${calc.employmentType} employee`,
  ].filter(Boolean).join("  ·  ");
  doc.text(subtitle, MARGIN, y + 5.5);
  y += 13;

  autoTable(doc, {
    ...tableTheme({ startY: y, styles: { ...tableTheme().styles, fontSize: 9 } }),
    head: [["Employee Details", ""]],
    body: [
      ["Month", monthText],
      ["Designation", roleLabel || "—"],
      ["Employment type", calc.employmentType],
      person?.joining_date ? ["Joining date", longDate(person.joining_date)] : null,
      person?.cnic ? ["CNIC", person.cnic] : null,
      person?.phone ? ["Contact", person.phone] : null,
    ].filter(Boolean),
    columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } },
  });
  y = doc.lastAutoTable.finalY + 7;

  /* ----------------------------------------------------- attendance */

  const corrected = calc.presentDaysOverride !== null && calc.presentDaysOverride !== undefined;

  const attendanceBody = [
    ["Working days in month", days(calc.workingDays)],
    [corrected ? "Present  (corrected by the office)" : "Present", days(calc.presentDays)],
    ["Leave", days(calc.leaveDays)],
    ["Absent", days(calc.absentDays)],
  ];
  // Said on the slip, not just on the office's screen. Otherwise the Present row
  // and the deduction below it are computed from two different numbers and the
  // slip cannot be checked against anybody's own record of the month.
  if (corrected) {
    attendanceBody.push(["Register had recorded", days(calc.registerPresentDays)]);
  }
  if (calc.halfDays > 0) attendanceBody.push(["Half days", days(calc.halfDays)]);
  attendanceBody.push(["Holidays / weekly off", days(calc.holidayDays)]);
  // Shown rather than hidden: it is the admin's cue that the register is
  // incomplete, and the employee's reassurance that it cost her nothing.
  if (calc.unmarkedDays > 0) attendanceBody.push(["Not marked in register", days(calc.unmarkedDays)]);

  autoTable(doc, {
    ...tableTheme({ startY: y }),
    head: [["Attendance", ""]],
    body: attendanceBody,
    columnStyles: { 0: { cellWidth: 90 }, 1: { halign: "right" } },
  });
  y = doc.lastAutoTable.finalY + 7;

  /* -------------------------------------------------- the arithmetic */

  const salaryBody = [];
  // Regular and Fix Pay are both the monthly shape and print the identical
  // working; only Visiting is per day. `isPerDayType` is the one definition of
  // that, and payroll.js imports nothing, so this file stays Node-drivable.
  if (isPerDayType(calc.employmentType)) {
    salaryBody.push(
      ["Rate per day", money(calc.perDayRate)],
      ["Paid days", days(calc.paidDays)],
      [`Earned  (${days(calc.paidDays)} x ${money(calc.perDayRate)})`, money(calc.baseAmount)]
    );
  } else {
    salaryBody.push(
      ["Monthly salary", money(calc.baseAmount)],
      [`One day's pay  (${money(calc.baseAmount)} / ${days(calc.workingDays)} working days)`, money(calc.perDayRate)],
      ["Leave / absent days", days(calc.absenceDays)],
      ["Allowed free", days(calc.freeDays)],
      [
        calc.chargeableDays > 0
          ? `Deduction  (${days(calc.chargeableDays)} x ${money(calc.perDayRate)})`
          : "Deduction",
        calc.chargeableDays > 0 ? `- ${money(calc.absenceDeduction)}` : "Nil",
      ]
    );
  }
  if (calc.bonus > 0) salaryBody.push(["Allowance / bonus", `+ ${money(calc.bonus)}`]);
  if (calc.otherDeduction > 0) salaryBody.push(["Other deduction", `- ${money(calc.otherDeduction)}`]);

  autoTable(doc, {
    ...tableTheme({ startY: y }),
    head: [["Salary Calculation", "Amount"]],
    body: salaryBody,
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: "right" } },
  });
  y = doc.lastAutoTable.finalY + 6;

  /* ------------------------------------------------------ net + status */

  doc.setFillColor(...ACCENT);
  doc.roundedRect(MARGIN, y, width - MARGIN * 2, 14, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("NET PAYABLE", MARGIN + 5, y + 9);
  doc.setFontSize(14);
  doc.text(money(calc.netPayable), width - MARGIN - 5, y + 9.5, { align: "right" });
  y += 21;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  let statusLine;
  if (status === "Paid") statusLine = `Status: PAID — ${money(paidAmount)} on ${longDate(paidOn)}`;
  else if (status === "Partially Paid") {
    statusLine = `Status: PARTIALLY PAID — ${money(paidAmount)} received, ${money(calc.netPayable - paidAmount)} outstanding`;
  } else statusLine = "Status: PAYMENT PENDING";
  doc.text(statusLine, MARGIN, y);
  y += 7;

  if (notes && notes.trim()) {
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    const wrapped = doc.splitTextToSize(`Note: ${notes.trim()}`, width - MARGIN * 2);
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 5 + 2;
  }

  /* --------------------------------------------------------- footer */

  y = Math.max(y + 12, doc.internal.pageSize.getHeight() - 40);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + 55, y);
  doc.line(width - MARGIN - 55, y, width - MARGIN, y);
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Employee Signature", MARGIN, y + 5);
  doc.text("Principal / Accounts", width - MARGIN, y + 5, { align: "right" });

  doc.setFontSize(8);
  doc.text(
    `Generated ${longDate(new Date())} · Computer-generated slip. If any figure does not match your own record, contact the college office.`,
    width / 2,
    doc.internal.pageSize.getHeight() - 12,
    { align: "center", maxWidth: width - MARGIN * 2 }
  );

  return doc.output("blob");
}

/** Downloads a built payslip under a predictable name. */
export function downloadPayslip(blob, personName, monthKey) {
  const safe = String(personName || "payslip").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Payslip_${safe}_${monthKey}.pdf`;
  link.click();
  URL.revokeObjectURL(link.href);
}
