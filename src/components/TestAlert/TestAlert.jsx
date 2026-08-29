import { useState, useEffect } from "react";
import { fetchNotices } from "../../lib/notices";
import {
  nextTestFrom, nextTestFromGrid, scheduleAttachment, whenLabel, longDay,
} from "../../lib/testSchedule";
import "./TestAlert.css";

/**
 * The next test, blinking at the top of the home page.
 *
 * The weekly test schedule is posted as an ordinary notice, and a notice sits
 * far enough down the landing page that a girl scrolling for the admission form
 * never reaches it. This lifts one fact out of it — the very next test date —
 * into the hero, where nothing else competes with it.
 *
 * It adds **no table, no column and no SQL**: `lib/testSchedule.js` reads the
 * date out of what the office already posts. Which notice, and which date, is
 * that file's job and is documented there.
 *
 * **The date usually lives in the attachment, not in the notice.** The college's
 * own schedule notice says "PLEASE OPEN THE FILE ATTACHED" and carries an .xlsx
 * of the whole year — so when the text yields nothing, the spreadsheet is
 * fetched and read (`lib/xlsxRead.js`, no zip library, `import()`ed only at that
 * point so a page with no schedule pays nothing for it). Asking the office to
 * type the dates a second time is the kind of rule nobody remembers in week nine
 * of the term.
 *
 * Three more things about it:
 *
 * - **It shows nothing rather than something wrong.** No schedule notice, no
 *   readable date, every date already past — it renders null and the hero looks
 *   exactly as it did before. A banner nobody can trust is worse than no banner,
 *   the same rule as `notMarked` never printing as 0.
 * - **The blink is not the accent colour.** A visitor can set the accent to any
 *   hue with `AccentPicker`, and the hero gradient is built from it — a warning
 *   painted in that same hue would disappear into its own background on some of
 *   them. The amber and white it alternates between are fixed for exactly the
 *   reason chart series colours are (see the Charts section of CLAUDE.md).
 * - **Anyone who asked for less motion gets a steady box.** Same
 *   `prefers-reduced-motion` courtesy the hero typewriter already extends, and
 *   here it matters more: a blink is the kind of motion that is a genuine
 *   problem for some readers, not merely a preference.
 */
export default function TestAlert({ onOpenNotices }) {
  const [next, setNext] = useState(null);

  useEffect(() => {
    let live = true;

    const load = async () => {
      const { notices } = await fetchNotices("public");
      if (!live) return;

      // The written notice first: it is already here, and an office that did
      // type the dates out means them to be the ones announced.
      const inText = nextTestFrom(notices);
      if (inText) return setNext(inText);

      const withFile = scheduleAttachment(notices);
      if (!withFile) return;

      const grid = await readSchedule(withFile.file_url);
      if (!live || !grid) return;
      setNext(nextTestFromGrid(grid, withFile));
    };

    load();
    return () => { live = false; };
  }, []);

  if (!next) return null;

  // The notice title is the fallback: a date on a line of its own leaves nothing
  // behind once the date is stripped out of it.
  const what = next.line || next.notice?.title || "Test";

  return (
    <button
      type="button"
      className="testalert"
      onClick={onOpenNotices}
      title="See the full schedule on the notice board"
    >
      <span className="testalert__flag">📝 Next Test</span>
      <span className="testalert__body">
        <span className="testalert__when">
          {whenLabel(next.daysAway)} — {longDay(next.date)}
        </span>
        <span className="testalert__what">{what}</span>
      </span>
    </button>
  );
}

/**
 * The attachment, as a grid. Every failure is silent and ends in no banner:
 * the file is a courtesy the home page is reading over the office's shoulder,
 * and an error message about a spreadsheet helps nobody standing on it.
 */
async function readSchedule(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const { readXlsxGrid } = await import("../../lib/xlsxRead");
    return await readXlsxGrid(await res.arrayBuffer());
  } catch {
    return null;
  }
}
