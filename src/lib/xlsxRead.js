/**
 * Reading an .xlsx back — the mirror of `xlsx.js`, which writes one.
 *
 * It exists for exactly one screen: the office posts the weekly test schedule as
 * a spreadsheet and types "PLEASE OPEN THE FILE ATTACHED" in the notice itself,
 * so the dates the home page wants to announce are inside the attachment and
 * nowhere else. Rather than ask the office to type them twice — which is a rule
 * nobody remembers in week nine of the term — the banner reads the sheet.
 *
 * Two things keep it small enough to justify on the landing page:
 *
 * - **No zip library.** JSZip is 96 kB, and `xlsx.js` already `import()`s it only
 *   inside the download handler for that reason. Unzipping is `DecompressionStream`,
 *   which every browser this college's phones run has had for years, plus about
 *   forty lines of central-directory walking. A browser without it simply gets no
 *   banner — `readXlsxGrid` returns null and the caller renders nothing.
 * - **No XML parser.** The parts are read with regexes, the same way `xlsx.js`
 *   assembles them by hand. This is a deliberately partial reader: shared strings,
 *   inline strings and plain values off the first worksheet, which is all a
 *   schedule ever is.
 *
 * Like every other library in `src/lib` that does arithmetic rather than IO, it
 * **imports nothing** and reaches no DOM API beyond `DecompressionStream`, so the
 * whole of it is drivable from plain Node against a real spreadsheet — which is
 * how it was checked, since this repo has no test runner.
 */

/** Cheap XML entity decode. OOXML only ever writes these five. */
const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
   .replace(/&amp;/g, "&");

/** "B4" → 1. Column letters are base-26 with no zero. */
export function columnIndexOf(ref) {
  const letters = /^([A-Z]+)/.exec(ref || "")?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The entries of a zip, by name, as Uint8Arrays.
 *
 * It walks the **central directory** rather than the local headers, and that is
 * not a preference: LibreOffice — which is what wrote the college's own schedule
 * — streams its entries and leaves the sizes in the local header as zero, with
 * the real ones in a data descriptor after the data. Reading local headers gives
 * a zero-length deflate stream and an inflate error.
 */
async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // End of central directory: last 22 bytes, plus up to 64 kB of zip comment.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = {};

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // 0xffffffff means the real value is in a zip64 extra field. A spreadsheet
    // that large is not a test schedule; give up rather than guess.
    if (compSize === 0xffffffff || localAt === 0xffffffff) return null;

    const lNameLen = view.getUint16(localAt + 26, true);
    const lExtraLen = view.getUint16(localAt + 28, true);
    const start = localAt + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + compSize);

    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = await inflateRaw(data);
    // Anything else (deflate64, bzip2) is not something Excel or LibreOffice writes.

    p += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") throw new Error("no DecompressionStream");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const text = (part) => (part ? new TextDecoder().decode(part) : "");

/** `<si>` blocks, each one flattened to a single string. */
function sharedStrings(xml) {
  const list = [];
  for (const [, si] of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let s = "";
    for (const [, t] of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += decode(t);
    list.push(s);
  }
  return list;
}

/**
 * The first worksheet as an array of rows, each an array of cell strings.
 *
 * Blank cells are empty strings and short rows are not padded — a caller reads
 * by index and treats a missing cell as blank, which is what the grid means.
 * Returns null for anything that is not a readable spreadsheet, because the one
 * caller renders nothing rather than guessing.
 */
export async function readXlsxGrid(buffer) {
  let files;
  try {
    files = await unzip(buffer);
  } catch {
    return null;
  }
  if (!files) return null;

  const sheetName = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) return null;

  const strings = sharedStrings(text(files["xl/sharedStrings.xml"]));
  const xml = text(files[sheetName]);
  const rows = [];

  for (const [, rowXml] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const [, attrs, inner] of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const at = columnIndexOf(/r="([A-Z]+\d+)"/.exec(attrs)?.[1]);
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || "n";
      let value = "";

      if (type === "s") {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]);
        value = strings[idx] ?? "";
      } else if (type === "inlineStr") {
        for (const [, t] of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) value += decode(t);
      } else {
        value = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || "");
      }

      if (at >= 0) cells[at] = value.trim();
      else cells.push(value.trim());
    }
    // A row of nothing but formatting carries no cells worth keeping.
    rows.push(Array.from(cells, (c) => c || ""));
  }

  return rows;
}
