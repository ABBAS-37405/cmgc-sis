/**
 * The weekly class test schedule, and every decision made from it.
 *
 * The schedule itself lives in the `test_schedule` table and is edited from
 * **Notices → Test Schedule** (`supabase_test_schedule.sql`). This file holds
 * the arithmetic — which test is next, whose papers those are, how many days
 * away, and whether to raise the box at all — plus the college's own 2026-27
 * sheet as a **fallback**, for the window between a frontend deploy and the SQL
 * being pasted into the dashboard. Same reasoning as `fetchRoster` retrying on
 * `42703`: a screen that goes blank because a migration has not been run yet is
 * the worse failure.
 *
 * It **imports only `academics.js`**, which is itself pure, so all of it can be
 * driven from plain Node — the usual discipline in this repo for the parts that
 * quietly go wrong. Everything that reaches Supabase is in `testScheduleDb.js`.
 * The storage helpers at the bottom guard their own access, so they are safe
 * where there is no `window`.
 */

import { studiedSubjects } from "./studentSubjects";

export const SCHEDULE_TITLE = "Weekly Test Schedule";

/** The sheet's two columns, spelled as `students.year_of_study` spells them. */
export const CLASS_YEARS = ["1st Year", "2nd Year"];

/**
 * How far ahead a test is announced every day. Tests fall roughly every six to
 * eight days, so this is very nearly "the run-up to whichever test is next" all
 * through the term.
 *
 * Outside it a test is still announced — once, when it becomes the next one —
 * and then left alone. See `shouldTell`.
 */
export const NOTICE_WINDOW_DAYS = 7;

// --------------------------------------------------------------------------
// The fallback sheet
// --------------------------------------------------------------------------

/** The sheet's abbreviations, spelled the way `academics.js` spells them. */
const SUBJECT_OF_CODE = {
  MATHS: "Mathematics",
  BIO: "Biology",
  CVS: "Civics",
  CHE: "Chemistry",
  COMP: "Computer Science",
  EDU: "Education",
  ISL: "Islamiat",
  TQ: "Tarjama Tul Quran",
  PS: "Pakistan Studies",
  URDU: "Urdu",
  PHY: "Physics",
  ECO: "Economics",
  SOC: "Sociology",
  ENG: "English",
};

/**
 * The two papers-of-the-day sets the 2026-27 sheet alternates between, written
 * in the college's own shorthand. Each entry is one paper on the day, and the
 * slashes are a choice **between groups**, not one the girl makes: of
 * MATHS/BIO/CVS a Pre-Medical student sits Biology and nothing else.
 */
const SLOT_SETS = {
  A: ["MATHS/BIO/CVS", "CHE/COMP/EDU", "ISL/TQ/PS"],
  B: ["URDU", "PHY/ECO/SOC", "ENG"],
};

const expand = (set) =>
  set
    ? SLOT_SETS[set].map((slot) =>
        slot.split("/").map((code) => SUBJECT_OF_CODE[code.trim()] || code.trim()),
      )
    : null;

/** date, 1st year set, 2nd year set. `null` means that class sits nothing. */
const FALLBACK_ROWS = [
  ["2026-09-04", null, "A"],
  ["2026-09-05", null, "B"],
  ["2026-09-11", "B", "A"],
  ["2026-09-19", "A", "B"],
  ["2026-09-25", "B", "A"],
  ["2026-10-03", "A", "B"],
  ["2026-10-09", "B", "A"],
  ["2026-10-17", "A", "B"],
  ["2026-10-23", "B", "A"],
  ["2026-10-31", "A", "B"],
  ["2026-11-06", "B", "A"],
  ["2026-11-14", "A", "B"],
  ["2026-11-20", "B", "A"],
  ["2026-11-28", "A", "B"],
  ["2027-01-01", "B", "A"],
  ["2027-01-09", "A", "B"],
  ["2027-01-15", "B", "A"],
  ["2027-01-23", "A", "B"],
  ["2027-01-29", "B", "A"],
  ["2027-02-06", "A", "B"],
  ["2027-02-12", "B", "A"],
  ["2027-02-20", "A", "B"],
  ["2027-02-26", "B", "A"],
  ["2027-03-06", "A", "B"],
  ["2027-03-12", "B", "A"],
  ["2027-03-20", "A", "B"],
  ["2027-03-26", "B", "A"],
];

// --------------------------------------------------------------------------
// Normalising
// --------------------------------------------------------------------------

const cleanPapers = (papers) => {
  if (!Array.isArray(papers)) return null;
  const kept = papers
    .map((paper) => (Array.isArray(paper) ? paper.map((s) => String(s).trim()).filter(Boolean) : []))
    .filter((paper) => paper.length > 0);
  return kept.length > 0 ? kept : null;
};

/**
 * Rows from `test_schedule` into the shape the rest of this file works in.
 *
 * **The test number is derived, never stored.** It is the row's position in date
 * order, which is exactly what the printed sheet's TNO column is — so an office
 * that moves a date can never end up with two tests numbered 4, and nothing has
 * to be renumbered by hand. A class that sits only some of them still sees the
 * college's numbering, because that is the number on the sheet in her hand.
 *
 * A row whose papers are empty for both classes is dropped rather than shown as
 * a test day with nothing on it.
 */
export function normaliseSchedule(rows) {
  return (rows || [])
    .map((r) => ({
      id: r.id,
      date: String(r.test_date || r.date || "").slice(0, 10),
      // What the office wants said alongside — a syllabus, what to bring. Carried
      // through to the box on every portal, so it is never only in the office.
      note: r.note || null,
      papers: {
        "1st Year": cleanPapers(r.first_year_papers ?? r.papers?.["1st Year"]),
        "2nd Year": cleanPapers(r.second_year_papers ?? r.papers?.["2nd Year"]),
      },
    }))
    .filter((t) => t.date && (t.papers["1st Year"] || t.papers["2nd Year"]))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t, i) => ({ ...t, no: i + 1 }));
}

/** The college's 2026-27 sheet, used only when the table cannot be read. */
export const FALLBACK_SCHEDULE = normaliseSchedule(
  FALLBACK_ROWS.map(([date, first, second]) => ({
    test_date: date,
    first_year_papers: expand(first),
    second_year_papers: expand(second),
  })),
);

// --------------------------------------------------------------------------
// Subjects
// --------------------------------------------------------------------------

/**
 * One paper, worked out for one girl.
 *
 * A paper lists what the whole college sits in that period; only one of them is
 * hers. Narrowing it is the difference between "Mathematics / Biology / Civics"
 * — which tells her nothing — and "Biology", which is the answer she opened the
 * portal for.
 *
 * The narrowing is an intersection with what she actually studies, never a
 * guess: where more than one candidate survives (a 1st year sits both Islamiat
 * and Tarjama Tul Quran) it names both, and where none does it hands back the
 * paper exactly as the office entered it. `narrowed` says which happened, so the
 * screen can keep the published wording beside hers rather than replace it.
 */
export function resolveSlot(subjects, { group, year, combination } = {}) {
  const names = (Array.isArray(subjects) ? subjects : [subjects])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const published = names.join(" / ");
  if (!group) return { subjects: names, text: published, published, narrowed: false };

  const studied = studiedSubjects(group, year, combination);
  const hers = names.filter((n) => studied.includes(n));
  // No overlap at all means the office listed a subject this group does not
  // take. Say what was entered rather than print an empty line.
  if (hers.length === 0) return { subjects: names, text: published, published, narrowed: false };

  return {
    subjects: hers,
    text: hers.join(" / "),
    published,
    narrowed: hers.length < names.length,
  };
}

/**
 * Every paper one class sits that day. `student` is optional — without it (a
 * teacher, an admin) the papers read exactly as the office entered them.
 */
export function slotsFor(test, year, student) {
  const papers = test?.papers?.[year];
  if (!papers) return [];
  return papers.map((paper) => resolveSlot(paper, { ...student, year }));
}

/** True when this class sits a paper on that test day. */
export const classSits = (test, year) => Boolean(test?.papers?.[year]);

// --------------------------------------------------------------------------
// Dates. Sliced and rebuilt through Date.UTC, never handed to
// `new Date("2026-09-04")` — that is UTC midnight, which lands on the 3rd for
// anyone east of Greenwich. The same trap `monthKeyOf` avoids in accounts.js.
// --------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Today where the girl is sitting, as YYYY-MM-DD. */
export function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const utcOf = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};

/** Whole days from `from` to `to`. Both sides are built the same way, so no drift. */
export function daysBetween(from, to) {
  return Math.round((utcOf(to) - utcOf(from)) / 86400000);
}

export function formatTestDate(key) {
  const [y, m, d] = String(key).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * The weekday, worked out from the date rather than stored beside it. The
 * college's sheet carries a DAY column; a stored copy of it is one more thing
 * that can disagree with the date it sits next to, and the office would have to
 * remember to change both.
 */
export function dayName(dateKey) {
  const at = utcOf(dateKey);
  return Number.isNaN(at) ? "" : DAY_NAMES[new Date(at).getUTCDay()];
}

/** "Today", "Tomorrow", "in 3 days" — the part she actually reads. */
export function describeWhen(test, today = todayKey()) {
  const days = daysBetween(today, test.date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

// --------------------------------------------------------------------------
// Which test is next
// --------------------------------------------------------------------------

/**
 * The next test that has not been sat yet — the day itself counts, because a
 * girl opening her portal on a test morning wants that morning's paper, not the
 * one after it. Passing a `year` skips the days her class does not sit at all.
 *
 * Returns null once the schedule is finished, which is the honest answer: there
 * is no next test, and the box does not appear.
 */
export function upcomingTest(schedule, today = todayKey(), year) {
  return (
    (schedule || []).find((t) => t.date >= today && (!year || classSits(t, year))) || null
  );
}

/** True while the test is close enough to be announced every day. */
export function withinNoticeWindow(test, today = todayKey(), window = NOTICE_WINDOW_DAYS) {
  if (!test) return false;
  const days = daysBetween(today, test.date);
  return days >= 0 && days <= window;
}

/**
 * Whether to raise the box at all. Two rules, because a schedule has two quite
 * different moments in it.
 *
 * **A test that has just become the next one is announced, however far off it
 * is.** A girl whose first paper is a fortnight away should be told that on the
 * day she can still do something about it, not a week before it.
 *
 * **After that it goes quiet until the last week**, and then asks once a day.
 * The day before the paper is exactly when the reminder earns its place, and a
 * box dismissed a fortnight earlier would otherwise never be seen again.
 *
 * `told` is what this viewer was last shown — `{ date, day }` — or null for a
 * browser that has never raised it. Keyed on the test's **date** rather than its
 * number, because the number is a position and the office moving one date would
 * otherwise silently re-announce every test after it.
 */
export function shouldTell(test, told, today = todayKey(), window = NOTICE_WINDOW_DAYS) {
  if (!test) return false;
  // Never for a test already sat: `upcomingTest` will not return one, but the
  // caller may be holding a stale object across midnight.
  if (daysBetween(today, test.date) < 0) return false;

  if (!told || told.date !== test.date) return true;
  return withinNoticeWindow(test, today, window) && told.day !== today;
}

// --------------------------------------------------------------------------
// "What was she last told". Guarded rather than assumed: a browser with storage
// disabled should lose the memory, never the portal.
// --------------------------------------------------------------------------

const SEEN_KEY = "cmgc-test-alert";

const readAll = () => {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

/**
 * What this viewer was last shown, or null. Keyed per viewer, because a shared
 * family phone signs two sisters in and they are not in the same class.
 */
export function readTold(viewerKey) {
  if (!viewerKey || typeof window === "undefined") return null;
  const row = readAll()[viewerKey];
  return row && typeof row.date === "string" ? row : null;
}

export function rememberTold(viewerKey, testDate, today = todayKey()) {
  if (!viewerKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({ ...readAll(), [viewerKey]: { date: testDate, day: today } }),
    );
  } catch {
    // Full, or disabled. The box simply shows again on the next load, which is
    // the harmless direction to fail in.
  }
}
