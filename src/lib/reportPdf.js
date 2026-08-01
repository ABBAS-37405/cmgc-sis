/**
 * Turning a monthly report into a PDF.
 *
 * jsPDF is imported dynamically, never at module top level. It and autotable are
 * ~400 kB together, and the admin portal is already a lazy chunk — a static
 * import here would pull the whole PDF engine into that chunk for every admin
 * who never opens the Reports tab. `loadPdfLib()` fetches it on first use and
 * keeps it for the rest of the session.
 */

const ACCENT = [29, 78, 216]; // --accent of the light theme, so the PDF matches the portal
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];
const LINE = [226, 232, 240];

const MARGIN = 14;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN * 2;

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

/**
 * The college logo as a data URL, fetched once.
 *
 * jsPDF cannot take a URL — it needs the bytes. A missing or unreadable logo
 * must never stop a report being produced, so every failure resolves to null and
 * the header simply renders without the crest.
 */
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
const pctText = (p) => (p === null || p === undefined ? "—" : `${p.toFixed(1)}%`);
const shortDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "short" }) : "";

/** Every table on the page shares this look, so the sections read as one document. */
const tableTheme = (extra = {}) => ({
  theme: "grid",
  margin: { left: MARGIN, right: MARGIN },
  styles: { fontSize: 9, cellPadding: 2.2, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
  headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 9, fontStyle: "bold" },
  alternateRowStyles: { fillColor: [248, 250, 252] },
  ...extra,
});

/**
 * Builds the PDF and hands back a Blob.
 *
 * A Blob rather than a download, because the same bytes are both uploaded to
 * storage (so the parent's WhatsApp link has something to point at) and offered
 * as a direct download. Producing it twice would be wasteful and could produce
 * two different files.
 */
export async function buildReportPdf(report) {
  const { jsPDF, autoTable } = await loadPdfLib();
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = drawHeader(doc, report, logo);
  y = drawStudentBlock(doc, autoTable, report, y);
  y = drawAttendance(doc, autoTable, report, y);
  y = drawTests(doc, autoTable, report, y);
  y = drawAssignments(doc, autoTable, report, y);
  y = drawResult(doc, autoTable, report, y);
  drawFee(doc, autoTable, report, y);
  drawFooter(doc);

  return doc.output("blob");
}

export function reportFileName(report) {
  const safe = (report.student.roll_no || report.student.name || "student").replace(/[^\w-]/g, "-");
  return `${safe}-${report.month}.pdf`;
}

/* ------------------------------------------------------------------ header */

function drawHeader(doc, report, logo) {
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, PAGE_W, 30, "F");

  if (logo) {
    // The generated logo is square; 16mm keeps it inside the band.
    try {
      doc.addImage(logo, "PNG", MARGIN, 7, 16, 16);
    } catch {
      // A logo that jsPDF cannot decode is not worth failing the report over.
    }
  }

  const textX = logo ? MARGIN + 21 : MARGIN;
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Community Model Girls College", textX, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Monthly Performance Report", textX, 20.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(report.monthLabel, PAGE_W - MARGIN, 20.5, { align: "right" });

  return 38;
}

function sectionTitle(doc, title, y) {
  doc.setTextColor(...ACCENT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y + 1.6, PAGE_W - MARGIN, y + 1.6);
  return y + 6;
}

/** Starts a new page when the next section would not fit. */
function ensureSpace(doc, y, needed) {
  if (y + needed > 275) {
    doc.addPage();
    return 20;
  }
  return y;
}

/* ------------------------------------------------------------ student info */

function drawStudentBlock(doc, autoTable, report, y) {
  const s = report.student;
  const rows = [
    ["Name", s.name || "—", "Roll No.", s.roll_no || "—"],
    ["Group", s.program || "—", "Class", s.year_of_study || "—"],
    ["Father's Name", s.father_name || "—", "Report Period", report.monthLabel],
  ];

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    body: rows,
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 32 },
      1: { cellWidth: CONTENT_W / 2 - 32 + 18 },
      2: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 32 },
    },
  });

  return doc.lastAutoTable.finalY + 8;
}

/* -------------------------------------------------------------- attendance */

function drawAttendance(doc, autoTable, report, y) {
  const a = report.attendance;
  y = ensureSpace(doc, y, 40);
  y = sectionTitle(doc, "Attendance", y);

  if (a.marked === 0) {
    return emptyNote(doc, "No attendance was marked for this month.", y);
  }

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Days Marked", "Present", "Absent", "Leave", "Attendance %"]],
    body: [[a.marked, a.present, a.absent, a.leave, pctText(a.percent)]],
    styles: { ...tableTheme().styles, halign: "center", fontSize: 10 },
    headStyles: { ...tableTheme().headStyles, halign: "center" },
    columnStyles: { 4: { fontStyle: "bold", textColor: a.percent >= 75 ? [22, 101, 52] : [153, 27, 27] } },
  });

  y = doc.lastAutoTable.finalY + 4;

  // The days she missed, because that is the first thing a parent asks about.
  if (a.absentDates.length > 0) {
    const text = a.absentDates.map((d) => `${shortDate(d.date)} (${d.status})`).join(",  ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    const wrapped = doc.splitTextToSize(`Days missed: ${text}`, CONTENT_W);
    doc.text(wrapped, MARGIN, y + 1);
    y += wrapped.length * 4 + 2;
  }

  return y + 5;
}

/* ------------------------------------------------------------- class tests */

function drawTests(doc, autoTable, report, y) {
  const t = report.tests;
  y = ensureSpace(doc, y, 40);
  y = sectionTitle(doc, "Class Tests", y);

  if (t.subjects.length === 0) {
    return emptyNote(doc, "No class tests were conducted for her this month.", y);
  }

  const body = t.subjects.map((s) => [
    s.subject,
    s.tests.length,
    s.absent || "—",
    `${s.obtained}/${s.total}`,
    pctText(s.percent),
    // Each test spelled out, so a low average can be traced to the test that caused it.
    s.tests.map((x) => (x.isAbsent ? `${x.title}: Abs` : `${x.title}: ${x.obtained ?? "—"}/${x.total}`)).join(", "),
  ]);

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Subject", "Tests", "Absent", "Marks", "%", "Test by test"]],
    body,
    foot: [["Overall", t.count, "", `${t.obtained}/${t.total}`, pctText(t.percent), ""]],
    footStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 12, halign: "center" },
      2: { cellWidth: 14, halign: "center" },
      3: { cellWidth: 20, halign: "center" },
      4: { cellWidth: 16, halign: "center", fontStyle: "bold" },
      5: { fontSize: 7.5, textColor: MUTED },
    },
  });

  return doc.lastAutoTable.finalY + 8;
}

/* ------------------------------------------------------------- assignments */

function drawAssignments(doc, autoTable, report, y) {
  const a = report.assignments;
  y = ensureSpace(doc, y, 40);
  y = sectionTitle(doc, "Assignments", y);

  if (a.set === 0) {
    return emptyNote(doc, "No assignments were due this month.", y);
  }

  const body = a.items.map((i) => [
    i.title,
    i.subject,
    shortDate(i.dueDate),
    i.submitted ? (i.late ? "Submitted (late)" : "Submitted") : "Not submitted",
    i.marks === null ? "—" : `${i.marks}/${i.totalMarks}`,
  ]);

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Assignment", "Subject", "Due", "Status", "Marks"]],
    body,
    columnStyles: {
      1: { cellWidth: 28 },
      2: { cellWidth: 18, halign: "center" },
      3: { cellWidth: 32, halign: "center" },
      4: { cellWidth: 20, halign: "center", fontStyle: "bold" },
    },
    // Anything not handed in is the point of the section — colour it so it is
    // impossible to miss at a glance.
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 3 && data.cell.raw === "Not submitted") {
        data.cell.styles.textColor = [153, 27, 27];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  y = doc.lastAutoTable.finalY + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const summary =
    `Set: ${a.set}   ·   Submitted: ${a.submitted}   ·   Not submitted: ${a.missing}   ·   Late: ${a.late}` +
    (a.percent !== null ? `   ·   Graded marks: ${a.obtained}/${a.total} (${a.percent.toFixed(1)}%)` : "");
  doc.text(summary, MARGIN, y + 1);

  return y + 8;
}

/* ------------------------------------------------------------ term results */

function drawResult(doc, autoTable, report, y) {
  const r = report.result;
  y = ensureSpace(doc, y, 40);
  y = sectionTitle(doc, "Term Examination", y);

  if (!r) {
    return emptyNote(doc, "No term examination result was recorded this month.", y);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(r.examName, MARGIN, y);
  y += 4;

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Subject", "Obtained", "Total", "%"]],
    body: r.subjects.map((s) => [s.subject, s.obtained, s.total, pctText((s.obtained / (s.total || 1)) * 100)]),
    foot: [["Total", r.obtained, r.total, pctText(r.percent)]],
    footStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: "bold" },
    columnStyles: {
      1: { cellWidth: 26, halign: "center" },
      2: { cellWidth: 26, halign: "center" },
      3: { cellWidth: 24, halign: "center", fontStyle: "bold" },
    },
  });

  return doc.lastAutoTable.finalY + 8;
}

/* ----------------------------------------------------------------- the fee */

function drawFee(doc, autoTable, report, y) {
  const f = report.fee;
  y = ensureSpace(doc, y, 40);
  y = sectionTitle(doc, "Fee Position", y);

  if (f.rows.length === 0) {
    return emptyNote(doc, "No fee had fallen due by the end of this month.", y);
  }

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Particular", "Due Date", "Amount", "Paid", "Balance", "Status"]],
    body: f.rows.map((r) => [
      r.label,
      shortDate(r.dueDate),
      money(r.due),
      money(r.paid),
      money(r.balance),
      r.status,
    ]),
    foot: [["Total", "", money(f.due), money(f.paid), money(f.balance), ""]],
    footStyles: { fillColor: [241, 245, 249], textColor: INK, fontStyle: "bold" },
    columnStyles: {
      1: { cellWidth: 20, halign: "center" },
      2: { cellWidth: 24, halign: "right" },
      3: { cellWidth: 24, halign: "right" },
      4: { cellWidth: 24, halign: "right" },
      5: { cellWidth: 28, halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5 && data.cell.raw !== "Paid") {
        data.cell.styles.textColor = [153, 27, 27];
      }
    },
  });

  y = doc.lastAutoTable.finalY + 4;

  if (f.balance > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(153, 27, 27);
    doc.text(`Outstanding balance: ${money(f.balance)}`, MARGIN, y + 1);
    y += 6;
  }

  return y;
}

/* ----------------------------------------------------------------- helpers */

function emptyNote(doc, text, y) {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(text, MARGIN, y + 1);
  return y + 9;
}

function drawFooter(doc) {
  const pages = doc.getNumberOfPages();
  const printed = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 283, PAGE_W - MARGIN, 283);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Generated on ${printed} · This is a computer-generated report and needs no signature.`, MARGIN, 288);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, 288, { align: "right" });
  }
}
