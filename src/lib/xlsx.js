// A minimal .xlsx writer — enough of SpreadsheetML for the sheets this app hands
// out, and nothing more.
//
// Why not CSV: a CSV has no column widths, no frozen header, no merged cells and
// no bold, so the attendance sheet arrived in Google Sheets as a wall of text
// that had to be re-formatted by hand every month. An .xlsx opens in Sheets
// (File → Import, or just drop it in Drive) already laid out.
//
// Why not a library: an xlsx is a zip of five small XML parts, and JSZip is
// already a dependency for the reports ZIP. SheetJS is ~900 kB for the same
// result. Like reportPdf.js this module imports nothing that reaches
// supabaseClient, and JSZip is import()ed inside the call rather than at module
// top level so it never lands in a chunk for someone who downloads nothing.

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

// Style ids, in the order they are written into cellXfs below. Pass one as a
// cell's `s`.
export const S = {
  PLAIN: 0,
  TITLE: 1,   // bold, 14pt — the college name
  LABEL: 2,   // bold — a caption line
  HEAD: 3,    // bold, tinted, boxed, centred — a column heading
  HEAD_OFF: 4, // same, but tinted red — a Sunday column
  BAND: 5,    // bold, grey — a group separator row
  TEXT: 6,    // boxed, left — a body cell
  CENTER: 7,  // boxed, centred — a body cell
};

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 0 -> A, 25 -> Z, 26 -> AA
export function columnRef(index) {
  let ref = "";
  let n = index;
  while (n >= 0) {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  }
  return ref;
}

export const cellRef = (row, col) => `${columnRef(col)}${row + 1}`;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CONTENT_TYPES = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `${XML_HEAD}
<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `${XML_HEAD}
<styleSheet xmlns="${NS_MAIN}">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E7F5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7D6D6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
</styleSheet>`;

const workbookXml = (sheetName) => `${XML_HEAD}
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<sheets><sheet name="${esc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

// A cell is a primitive (number -> numeric, anything else -> text) or
// { v, s } to carry a style. null/undefined/"" writes nothing at all, which is
// what keeps a blank sheet's file small.
function cellXml(cell, row, col) {
  const value = cell && typeof cell === "object" ? cell.v : cell;
  const style = cell && typeof cell === "object" ? cell.s : undefined;
  const hasValue = value !== null && value !== undefined && value !== "";
  if (!hasValue && style === undefined) return "";

  const ref = cellRef(row, col);
  const s = style === undefined ? "" : ` s="${style}"`;
  if (!hasValue) return `<c r="${ref}"${s}/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml({ rows, columns = [], freeze, merges = [] }) {
  const cols = columns.length
    ? `<cols>${columns
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  // A frozen pane keeps the headings and the Name column on screen while
  // scrolling into the far end of the month.
  const pane = freeze
    ? `<pane xSplit="${freeze.col || 0}" ySplit="${freeze.row || 0}" topLeftCell="${cellRef(
        freeze.row || 0,
        freeze.col || 0,
      )}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/>`
    : "";

  const body = rows
    .map((row, r) => {
      const cells = (row || []).map((cell, c) => cellXml(cell, r, c)).join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : `<row r="${r + 1}"/>`;
    })
    .join("");

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  return `${XML_HEAD}
<worksheet xmlns="${NS_MAIN}">
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${body}</sheetData>
${mergeXml}
<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

export async function buildXlsxBlob(sheet) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels").file(".rels", ROOT_RELS);
  zip.file("xl/workbook.xml", workbookXml(sheet.sheetName || "Sheet1"));
  zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
  zip.file("xl/styles.xml", STYLES);
  zip.file("xl/worksheets/sheet1.xml", sheetXml(sheet));
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}

export async function downloadXlsx(filename, sheet) {
  const blob = await buildXlsxBlob(sheet);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
