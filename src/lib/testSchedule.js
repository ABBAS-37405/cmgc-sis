/**
 * "Agla test kab hai?" — read off the weekly test schedule notice.
 *
 * The office posts the week's test schedule as an ordinary notice: a title, and
 * a body with a line per subject. Nothing in `notices` is structured — there is
 * no date column, and there should not be one, because the same table carries a
 * holiday announcement and a fee deadline. So the upcoming date is *derived*
 * from the text, exactly the way `lmsAlerts.js` derives "something new" rather
 * than storing it. No table, no SQL, no migration.
 *
 * It **imports nothing** — same discipline as `session.js`, `accounts.js` and
 * `payroll.js`, and for the same reason: date parsing is the part that quietly
 * goes wrong (a 31st of February, a year that rolls over in December, a lesson
 * timing "10-12" read as the 10th of December), and this repo has no test
 * runner, so it has to be drivable from plain Node against fixtures.
 *
 * Two rules it follows, both borrowed from the report code:
 *
 * - **Dates are built from their own parts, never `new Date(string)`.** An ISO
 *   string is parsed as UTC midnight and lands on the previous day for anyone
 *   east of Greenwich — the same trap `monthKeyOf` avoids in `accounts.js`.
 * - **Nothing is announced that was not actually found.** If the schedule is a
 *   photograph attached to the notice, there is no date in the text and this
 *   returns null. A banner is worth having only while it is right.
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** `sept` is the one abbreviation that is not simply the first three letters. */
const MONTH_WORD = "(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)";

const monthIndexOf = (word) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  return MONTHS.findIndex((m) => m.startsWith(w === "sept" ? "sep" : w));
};

/**
 * A schedule beyond this is not the week's test list — it is a mistyped year,
 * and "next test: 12 March 2027" on the home page is worse than no banner.
 */
export const MAX_AHEAD_DAYS = 120;

/** Local midnight. Whole days are the only comparison this file makes. */
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const DAY_MS = 24 * 60 * 60 * 1000;

const TEST_RE = /\btests?\b/i;
const PLAN_RE = /\b(schedule|scheduled|date\s*sheet|datesheet|timetable|time\s*table|weekly|plan)\b/i;

/**
 * Which notices are a test schedule.
 *
 * Deliberately narrow: it wants "test" *and* a scheduling word, so a result
 * announcement or a fee notice that happens to mention a test never claims the
 * banner. The category is not the test — the office files these under Exam,
 * Academic and General interchangeably.
 */
export function isTestSchedule(notice) {
  const text = `${notice?.title || ""} ${notice?.body || ""}`;
  return TEST_RE.test(text) && PLAN_RE.test(text);
}

/**
 * Every date this line can be read to contain, as `{ y, m, d }` with a 0-based
 * month. `baseYear` fills in a year nobody wrote down.
 *
 * Four written forms, because the office uses all four: `2026-09-05`,
 * `05/09/2026` (day first, as Pakistan writes it), `5 September` and
 * `September 5`. A bare `10-12` is **not** a date here — that is a lesson
 * timing, and requiring either a slash or a year is what keeps it out.
 */
export function datesInLine(line, baseYear) {
  const found = [];
  const add = (y, m, d) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return;
    const probe = new Date(y, m, d);
    // Rejects the 31st of a 30-day month instead of rolling it into the next.
    if (probe.getFullYear() !== y || probe.getMonth() !== m || probe.getDate() !== d) return;
    found.push({ y, m, d });
  };

  let rest = line;

  // 2026-09-05 — taken out of the line so the numeric pass below cannot read
  // its tail ("09-05") as a second, different date.
  rest = rest.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_, y, m, d) => {
    add(Number(y), Number(m) - 1, Number(d));
    return " ";
  });

  // 05/09/2026, 5/9/26, 05/09 — and 05-09-2026, but never a bare 10-12.
  rest = rest.replace(
    /\b(\d{1,2})\s*([/.-])\s*(\d{1,2})(?:\s*\2\s*(\d{2,4}))?\b/g,
    (whole, d, sep, m, y) => {
      if (!y && sep !== "/") return whole; // a range or a timing, not a date
      let year = baseYear;
      if (y) year = y.length <= 2 ? 2000 + Number(y) : Number(y);
      add(year, Number(m) - 1, Number(d));
      return " ";
    }
  );

  // 5 September 2026 / 5th Sep
  //
  // `(?!\d)` after the day is what stops "February 2026" being read as the 20th
  // of February with a stray "26" left over — a day is one or two digits and the
  // next character has to prove it.
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\s+${MONTH_WORD}[a-z]*\\.?,?(?:\\s*(\\d{4})(?!\\d))?`, "gi");
  rest.replace(dayFirst, (_, d, mon, y) => {
    add(y ? Number(y) : baseYear, monthIndexOf(mon), Number(d));
    return " ";
  });

  // September 5, 2026 / Sep 5
  const monthFirst = new RegExp(`\\b${MONTH_WORD}[a-z]*\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?,?(?:\\s*(\\d{4})(?!\\d))?`, "gi");
  rest.replace(monthFirst, (_, mon, d, y) => {
    add(y ? Number(y) : baseYear, monthIndexOf(mon), Number(d));
    return " ";
  });

  return found;
}

/** The line with its dates and weekday names removed — what is left is the subject. */
function stripDates(line) {
  return line
    .replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, " ")
    .replace(/\b\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?\b/g, " ")
    .replace(new RegExp(`\\b\\d{1,2}(?!\\d)(?:st|nd|rd|th)?\\s+${MONTH_WORD}[a-z]*\\.?,?(?:\\s*\\d{4}(?!\\d))?`, "gi"), " ")
    .replace(new RegExp(`\\b${MONTH_WORD}[a-z]*\\.?\\s+\\d{1,2}(?!\\d)(?:st|nd|rd|th)?,?(?:\\s*\\d{4}(?!\\d))?`, "gi"), " ")
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,.()|]+|[\s\-–—:,.()|]+$/g, "")
    .trim();
}

/**
 * The earliest test date still to come, across every schedule notice.
 *
 * `notices` arrives newest-first from `fetchNotices`, and the comparison is
 * strict, so when two notices name the same day the newer one wins — a
 * corrected schedule posted this morning beats last week's.
 *
 * Returns `{ date, dateKey, line, notice, daysAway }` or null. `line` is the
 * schedule's own sentence with the date taken out of it, so the banner can name
 * the subject beside the day; a date sitting on a line of its own leaves that
 * empty and the caller falls back to the notice title.
 */
export function nextTestFrom(notices, now = new Date()) {
  const today = startOfDay(now);
  const limit = today.getTime() + MAX_AHEAD_DAYS * DAY_MS;
  let best = null;

  for (const notice of notices || []) {
    if (!isTestSchedule(notice)) continue;

    // A schedule written in late December names days in January without a year.
    // Reading those into the year it was posted would date them eleven months
    // in the past and hide the banner exactly when it is needed.
    const posted = notice.created_at ? new Date(notice.created_at) : now;
    const baseYear = Number.isNaN(posted.getTime()) ? now.getFullYear() : posted.getFullYear();

    const lines = `${notice.title || ""}\n${notice.body || ""}`.split(/\r?\n/);

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      for (const part of datesInLine(line, baseYear)) {
        let when = new Date(part.y, part.m, part.d);
        // Year rolled over: a bare "3 January" on a notice posted in December.
        if (when.getTime() < today.getTime() - 30 * DAY_MS) {
          when = new Date(part.y + 1, part.m, part.d);
        }
        const t = when.getTime();
        if (t < today.getTime() || t > limit) continue;
        if (best && t >= best.date.getTime()) continue;

        best = {
          date: when,
          dateKey: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`,
          line: stripDates(line),
          notice,
          daysAway: Math.round((t - today.getTime()) / DAY_MS),
        };
      }
    }
  }

  return best;
}

/* ------------------------------------------------------------------ *
 * The same question, asked of an attached spreadsheet
 * ------------------------------------------------------------------ */

/**
 * The newest schedule notice whose attachment is a spreadsheet, or null.
 *
 * Only `.xlsx` — a PDF or a photograph of the notice board cannot be read, and
 * pretending otherwise would download a file for nothing. `.xls` is the old
 * binary format and is not a zip at all.
 */
export function scheduleAttachment(notices) {
  for (const notice of notices || []) {
    if (!isTestSchedule(notice)) continue;
    const name = notice.file_name || notice.file_url || "";
    if (notice.file_url && /\.xlsx(\?|$)/i.test(name)) return notice;
  }
  return null;
}

const DAY_NAME = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)/i;

/** Column headings that label the row rather than say what is being tested. */
const NOT_A_SUBJECT = /^(t\s*no|tno|sr|s\.?\s*no|no|date|day|dated)$/i;

/**
 * The next test date out of a schedule spreadsheet.
 *
 * The college's own file is a grid — `TNO | DATE | DAY | XI | XII` — with the
 * dates written as ordinary text ("04 Sep 2026"), so the same `datesInLine` that
 * reads the notice body reads a cell. Nothing here assumes those column names,
 * though: the DATE column is found by its heading, and if there is no such
 * heading every cell is tried instead.
 *
 * The row's other cells become the label, prefixed by their own heading, which
 * is what turns "04 Sep 2026" into "XI: URDU · XII: ENG" — the thing a girl
 * actually wants off the home page.
 *
 * `rows` comes from `readXlsxGrid`. Returns the same shape as `nextTestFrom`.
 */
export function nextTestFromGrid(rows, notice, now = new Date()) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const today = startOfDay(now);
  const limit = today.getTime() + MAX_AHEAD_DAYS * DAY_MS;

  const posted = notice?.created_at ? new Date(notice.created_at) : now;
  const baseYear = Number.isNaN(posted.getTime()) ? now.getFullYear() : posted.getFullYear();

  // The heading row is whichever row says "DATE". Without one, every cell is a
  // candidate and the row carries no labels — still enough for a date.
  let headerAt = -1;
  let dateCol = -1;
  for (let r = 0; r < rows.length && headerAt < 0; r++) {
    const c = (rows[r] || []).findIndex((cell) => /^dated?$/i.test((cell || "").trim()));
    if (c >= 0) { headerAt = r; dateCol = c; }
  }
  const headings = headerAt >= 0 ? rows[headerAt] : [];

  let best = null;

  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cells = dateCol >= 0 ? [[dateCol, row[dateCol] || ""]] : row.map((v, i) => [i, v || ""]);

    for (const [, raw] of cells) {
      for (const part of datesInLine(String(raw), baseYear)) {
        let when = new Date(part.y, part.m, part.d);
        if (when.getTime() < today.getTime() - 30 * DAY_MS) {
          when = new Date(part.y + 1, part.m, part.d);
        }
        const t = when.getTime();
        if (t < today.getTime() || t > limit) continue;
        if (best && t >= best.date.getTime()) continue;

        best = {
          date: when,
          dateKey: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`,
          line: rowLabel(row, headings, dateCol),
          notice,
          daysAway: Math.round((t - today.getTime()) / DAY_MS),
        };
      }
    }
  }

  return best;
}

/** "XI: URDU · XII: ENG" — the row minus its number, its date and its weekday. */
function rowLabel(row, headings, dateCol) {
  const parts = [];

  row.forEach((raw, i) => {
    const value = (raw || "").trim();
    if (!value || i === dateCol) return;
    // A dash is how a schedule says "this class has nothing that day".
    if (/^[-–—.]+$/.test(value)) return;
    // The serial number column, and the weekday beside the date.
    if (/^\d+$/.test(value)) return;
    if (DAY_NAME.test(value) && value.length <= 9) return;
    if (datesInLine(value, 2000).length) return;

    const head = (headings[i] || "").trim();
    // Whitespace inside a cell is the sheet lining subjects up in columns.
    const tidy = value.replace(/\s{2,}/g, " ");
    parts.push(head && !NOT_A_SUBJECT.test(head) ? `${head}: ${tidy}` : tidy);
  });

  return parts.join(" · ");
}

/** A countdown reads faster than a date, so the date itself gets the second line. */
export function whenLabel(daysAway) {
  if (daysAway <= 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

export function longDay(date) {
  return date.toLocaleDateString("en-PK", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
