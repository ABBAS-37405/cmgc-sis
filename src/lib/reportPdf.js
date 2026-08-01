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

  renderReport(doc, autoTable, report, logo);
  drawFooter(doc);

  return doc.output("blob");
}

/** One student's report onto whatever page the doc is currently on. */
function renderReport(doc, autoTable, report, logo) {
  let y = drawHeader(doc, report, logo);
  y = drawStudentBlock(doc, autoTable, report, y);
  y = drawAttendance(doc, autoTable, report, y);
  y = drawTests(doc, autoTable, report, y);
  y = drawAssignments(doc, autoTable, report, y);
  y = drawResult(doc, autoTable, report, y);
  drawFee(doc, autoTable, report, y);
}

export function reportFileName(report) {
  const safe = (report.student.roll_no || report.student.name || "student").replace(/[^\w-]/g, "-");
  return `${safe}-${report.month}.pdf`;
}

/**
 * Saves a generated Blob to the admin's computer.
 *
 * Two details that look like noise and are not: Firefox ignores a click on an
 * anchor that is not in the document, and revoking the object URL in the same
 * tick cancels the download it just started.
 */
export function saveBlob(blob, fileName) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}

/* ----------------------------------------------------- the whole class */

/**
 * Every student in one document: a class summary sheet, then each girl's full
 * report starting on its own page.
 *
 * `onProgress` is not decoration — forty reports take long enough that a silent
 * button looks broken. The await inside the loop yields to the browser so the
 * counter actually repaints instead of freezing until the end.
 */
export async function buildAllReportsPdf(reports, { onProgress } = {}) {
  const { jsPDF, autoTable } = await loadPdfLib();
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  drawClassSummary(doc, autoTable, reports, logo);

  for (let i = 0; i < reports.length; i += 1) {
    doc.addPage();
    renderReport(doc, autoTable, reports[i], logo);
    if (onProgress) onProgress(i + 1, reports.length);
    await Promise.resolve();
  }

  drawFooter(doc);
  return doc.output("blob");
}

/** The same reports as separate PDFs inside one ZIP, named by roll number. */
export async function buildReportsZip(reports, { onProgress } = {}) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  for (let i = 0; i < reports.length; i += 1) {
    const blob = await buildReportPdf(reports[i]);
    // An ArrayBuffer, not the Blob itself: JSZip only recognises Blob in a
    // browser, and handing it one anywhere else fails with "Can't read the data".
    zip.file(reportFileName(reports[i]), await blob.arrayBuffer());
    if (onProgress) onProgress(i + 1, reports.length);
  }

  return zip.generateAsync({ type: "blob" });
}

/** The at-a-glance sheet: one line per girl, so a whole class reads on one page. */
function drawClassSummary(doc, autoTable, reports, logo) {
  const first = reports[0];
  drawBandHeader(doc, {
    title: "Community Model Girls College",
    subtitle: "Monthly Performance — Class Summary",
    right: first ? first.monthLabel : "",
    logo,
  });

  autoTable(doc, {
    ...tableTheme(),
    startY: 38,
    head: [["#", "Roll No.", "Name", "Group / Class", "Attendance", "Class Tests", "Assignments", "Fee Balance"]],
    body: reports.map((r, i) => [
      i + 1,
      r.student.roll_no || "—",
      r.student.name || "—",
      `${r.student.program || "—"} · ${r.student.year_of_study || "—"}`,
      r.attendance.marked > 0 ? `${r.attendance.present}/${r.attendance.marked} (${pctText(r.attendance.percent)})` : "—",
      r.tests.percent !== null ? `${r.tests.obtained}/${r.tests.total} (${pctText(r.tests.percent)})` : "—",
      r.assignments.set > 0 ? `${r.assignments.submitted}/${r.assignments.set}` : "—",
      r.fee.balance > 0 ? money(r.fee.balance) : "Clear",
    ]),
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 30 },
      3: { cellWidth: 32, fontSize: 8 },
      4: { cellWidth: 26, halign: "center" },
      5: { cellWidth: 26, halign: "center" },
      6: { cellWidth: 20, halign: "center" },
      7: { cellWidth: 24, halign: "right" },
    },
    // Below 75% attendance and any outstanding fee are the two things the office
    // acts on, so they are coloured rather than left to be scanned for.
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const r = reports[data.row.index];
      if (data.column.index === 4 && r.attendance.percent !== null && r.attendance.percent < 75) {
        data.cell.styles.textColor = [153, 27, 27];
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 7 && r.fee.balance > 0) {
        data.cell.styles.textColor = [153, 27, 27];
      }
    },
  });

  const y = doc.lastAutoTable.finalY + 6;
  const withAtt = reports.filter((r) => r.attendance.percent !== null);
  const avgAtt = withAtt.length
    ? withAtt.reduce((a, r) => a + r.attendance.percent, 0) / withAtt.length
    : null;
  const below75 = withAtt.filter((r) => r.attendance.percent < 75).length;
  const owing = reports.filter((r) => r.fee.balance > 0);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    [
      `Students: ${reports.length}`,
      `Average attendance: ${pctText(avgAtt)}`,
      `Below 75%: ${below75}`,
      `Fee outstanding: ${owing.length} student(s), ${money(owing.reduce((a, r) => a + r.fee.balance, 0))}`,
    ].join("     ·     "),
    MARGIN,
    y
  );
}

/* -------------------------------------------------------- test result sheet */

/**
 * One class test: the result sheet first, then a page per girl.
 *
 * The sheet is what goes on the notice board and into the file; the individual
 * pages are what go home. Both are built from the same rows, so a mark can never
 * disagree between them.
 */
export async function buildTestReportPdf(report, { onProgress } = {}) {
  const { jsPDF, autoTable } = await loadPdfLib();
  const logo = await loadLogo();
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  drawTestSheet(doc, autoTable, report, logo);

  // Unmarked girls get no page — there is nothing to tell them yet.
  const printable = report.rows.filter((r) => !r.notMarked);
  for (let i = 0; i < printable.length; i += 1) {
    doc.addPage();
    drawTestSlip(doc, autoTable, report, printable[i], logo);
    if (onProgress) onProgress(i + 1, printable.length);
    await Promise.resolve();
  }

  drawFooter(doc);
  return doc.output("blob");
}

function testCaption(test, groups) {
  return `${test.subject} · ${test.title} · ${groups.join(", ")} ${test.year_of_study} · out of ${test.total_marks}`;
}

function drawTestSheet(doc, autoTable, report, logo) {
  const { test, groups, rows, stats } = report;

  drawBandHeader(doc, {
    title: "Community Model Girls College",
    subtitle: "Class Test — Result Sheet",
    right: shortDate(test.test_date) + " " + new Date(test.test_date).getFullYear(),
    logo,
  });

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`${test.subject} — ${test.title}`, MARGIN, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`${groups.join(", ")} · ${test.year_of_study} · Total marks: ${test.total_marks}`, MARGIN, 43.5);

  let y = 49;

  if (stats.taken > 0) {
    autoTable(doc, {
      ...tableTheme(),
      startY: y,
      head: [["Strength", "Appeared", "Absent", "Highest", "Lowest", "Average", "Passed", "Failed"]],
      body: [[
        stats.strength,
        stats.taken,
        stats.absent,
        stats.highest,
        stats.lowest,
        `${stats.average.toFixed(1)} (${pctText(stats.averagePercent)})`,
        stats.passed,
        stats.failed,
      ]],
      styles: { ...tableTheme().styles, halign: "center" },
      headStyles: { ...tableTheme().headStyles, halign: "center" },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Position order, then the girls with no mark at the bottom.
  const ordered = [...rows].sort((a, b) => {
    if (a.position && b.position) return a.position - b.position;
    if (a.position) return -1;
    if (b.position) return 1;
    return (a.student.name || "").localeCompare(b.student.name || "");
  });

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Pos.", "Roll No.", "Name", "Marks", "%", "Grade", "Remarks"]],
    body: ordered.map((r) => [
      r.position ?? "—",
      r.student.roll_no || "—",
      r.student.name || "—",
      r.isAbsent ? "Absent" : r.notMarked ? "Not marked" : `${r.obtained}/${stats.total || test.total_marks}`,
      pctText(r.percent),
      r.grade,
      r.remarks || "",
    ]),
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: 30 },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 15, halign: "center", fontStyle: "bold" },
      6: { fontSize: 8, textColor: MUTED },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const r = ordered[data.row.index];
      const failed = r.percent !== null && r.percent < (stats.passPercent ?? 33);
      if (failed && (data.column.index === 4 || data.column.index === 5)) {
        data.cell.styles.textColor = [153, 27, 27];
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 3 && (r.isAbsent || r.notMarked)) {
        data.cell.styles.textColor = MUTED;
        data.cell.styles.fontStyle = "italic";
      }
    },
  });

  y = doc.lastAutoTable.finalY + 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Pass mark: ${stats.passPercent ?? 33}%.   Grades: A+ 80+, A 70+, B 60+, C 50+, D 40+, E 33+, F below 33.` +
      (stats.notMarked > 0 ? `   ${stats.notMarked} student(s) not yet marked.` : ""),
    MARGIN,
    y
  );
}

/** One girl's page: her mark, where she stands, and what the class did. */
function drawTestSlip(doc, autoTable, report, row, logo) {
  const { test, groups, stats } = report;

  drawBandHeader(doc, {
    title: "Community Model Girls College",
    subtitle: "Class Test Report",
    right: shortDate(test.test_date) + " " + new Date(test.test_date).getFullYear(),
    logo,
  });

  autoTable(doc, {
    ...tableTheme(),
    startY: 38,
    body: [
      ["Name", row.student.name || "—", "Roll No.", row.student.roll_no || "—"],
      ["Group", row.student.program || "—", "Class", row.student.year_of_study || "—"],
      ["Father's Name", row.student.father_name || "—", "Test Date", shortDate(test.test_date)],
    ],
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 32 },
      2: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 32 },
    },
  });

  let y = doc.lastAutoTable.finalY + 8;

  doc.setTextColor(...ACCENT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(testCaption(test, groups), MARGIN, y);
  y += 6;

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [["Marks Obtained", "Total Marks", "Percentage", "Grade", "Position in Class"]],
    body: [[
      row.isAbsent ? "Absent" : row.obtained,
      test.total_marks,
      pctText(row.percent),
      row.grade,
      row.position ? `${row.position} of ${stats.taken}` : "—",
    ]],
    styles: { ...tableTheme().styles, halign: "center", fontSize: 11, cellPadding: 4 },
    headStyles: { ...tableTheme().headStyles, halign: "center" },
    columnStyles: { 3: { fontStyle: "bold" } },
  });

  y = doc.lastAutoTable.finalY + 8;

  if (stats.taken > 0) {
    doc.setTextColor(...ACCENT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("How the class did", MARGIN, y);
    y += 5;

    autoTable(doc, {
      ...tableTheme(),
      startY: y,
      head: [["Class Highest", "Class Average", "Class Lowest", "Appeared", "Passed"]],
      body: [[
        stats.highest,
        `${stats.average.toFixed(1)} (${pctText(stats.averagePercent)})`,
        stats.lowest,
        stats.taken,
        `${stats.passed} of ${stats.taken}`,
      ]],
      styles: { ...tableTheme().styles, halign: "center" },
      headStyles: { ...tableTheme().headStyles, halign: "center" },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (row.remarks) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text("Teacher's remarks", MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(row.remarks, CONTENT_W), MARGIN, y);
    y += 10;
  }

  // Somewhere for a parent to sign before the slip comes back.
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y + 14, MARGIN + 60, y + 14);
  doc.line(PAGE_W - MARGIN - 60, y + 14, PAGE_W - MARGIN, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Parent's signature", MARGIN, y + 18);
  doc.text("Class teacher", PAGE_W - MARGIN, y + 18, { align: "right" });
}

/* ------------------------------------------------------------------ header */

/** The accent band every document opens with. Returns the y to carry on from. */
function drawBandHeader(doc, { title, subtitle, right, logo }) {
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
  doc.text(title, textX, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(subtitle, textX, 20.5);

  if (right) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(right, PAGE_W - MARGIN, 20.5, { align: "right" });
  }

  return 38;
}

function drawHeader(doc, report, logo) {
  return drawBandHeader(doc, {
    title: "Community Model Girls College",
    subtitle: "Monthly Performance Report",
    right: report.monthLabel,
    logo,
  });
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
