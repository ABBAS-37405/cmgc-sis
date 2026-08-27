import { useState, useEffect, useMemo } from "react";
import { Trash2, Pencil, Plus, X, Check } from "lucide-react";
import { ALL_SUBJECTS } from "../../lib/academics";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import { formatTestDate, dayName, todayKey, daysBetween, CLASS_YEARS } from "../../lib/testSchedule";
import { fetchSchedule, saveTest, deleteTest } from "../../lib/testScheduleDb";
import "./TestScheduleAdmin.css";

/**
 * The weekly test schedule, as the office keeps it.
 *
 * This is the source of the box every portal raises on open. It lives beside
 * Post Notices rather than in a tab of its own for two reasons: the same person
 * does both — the schedule has always been published as a notice with the
 * spreadsheet attached — and the write policy on `test_schedule` is the very
 * same `admin_can_notices()` the notice board uses, so a separate tab would need
 * a permission key nobody would ever hold separately.
 *
 * **A paper is a list of subjects, not one subject.** The college's sheet writes
 * a day's first paper as "MATHS/BIO/CVS": one period, sat by every group at
 * once, in whichever of those three subjects is hers. So each paper here is a
 * set of ticks, and the portal narrows it to the one subject a given girl
 * actually sits, from her group and her subject combination.
 */
export default function TestScheduleAdmin() {
  const [schedule, setSchedule] = useState([]);
  const [source, setSource] = useState("database");
  const [needsMigration, setNeedsMigration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    const result = await fetchSchedule();
    setSchedule(result.schedule);
    setSource(result.source);
    setNeedsMigration(result.needsMigration);
    // A fallback that is not the missing table is worth naming: it means the
    // read was refused, and nothing edited here would be saved either.
    setError(result.source === "fallback" && !result.needsMigration ? result.error || "" : "");
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const today = todayKey();
  const nextIndex = useMemo(() => schedule.findIndex((t) => t.date >= today), [schedule, today]);

  /**
   * A new row, pre-filled by swapping the last test's two classes over.
   *
   * The college's sheet alternates: whatever 1st year sat last time, 2nd year
   * sits this time, and the other way round. Pre-filling that turns entering a
   * term into picking dates, and it is only a starting point — every tick can be
   * changed before saving.
   */
  const blankRow = () => {
    const last = schedule[schedule.length - 1];
    return {
      id: null,
      date: "",
      firstYearPapers: last ? last.papers["2nd Year"] || [] : [[], [], []],
      secondYearPapers: last ? last.papers["1st Year"] || [] : [[], [], []],
      note: "",
    };
  };

  const startEdit = (test) =>
    setEditing({
      id: test.id,
      date: test.date,
      firstYearPapers: test.papers["1st Year"] || [],
      secondYearPapers: test.papers["2nd Year"] || [],
      note: test.note || "",
    });

  const remove = async (test) => {
    if (!window.confirm(
      `Remove the test on ${formatTestDate(test.date)}?\n\n` +
      "The portals stop announcing it and move on to the next one. Nothing already recorded is touched — " +
      "this schedule is only what the alert reads from, not where marks are kept."
    )) return;

    const { error: dbError, removed } = await deleteTest(test.id);
    if (dbError) return setError(dbError);
    if (!removed) return setError(WRITE_BLOCKED_HINT);
    setError("");
    // Re-read rather than splice the row out, for the same reason as save():
    // the numbers are positions, so removing one renames every test after it.
    await load();
  };

  const save = async (draft) => {
    if (!draft.date) return setError("Pick the date of the test.");

    const { error: dbError, blocked } = await saveTest(draft);
    if (dbError) return setError(dbError);
    if (blocked) return setError(WRITE_BLOCKED_HINT);

    setError("");
    setEditing(null);
    // Re-read rather than splice the one row in: the test numbers are positions
    // in date order, so saving a date changes what every row after it is called.
    await load();
  };

  return (
    <div className="tsa">
      <div className="tsa__intro">
        <p className="tsa__lead">
          This is what every portal announces on open — a student sees her own class&apos;s papers,
          worked out from her group; a teacher and an admin see both classes.
        </p>
        {source === "database" && (
          <p className="tsa__meta">
            {schedule.length} test{schedule.length === 1 ? "" : "s"}
            {nextIndex >= 0
              ? ` · next is Test ${schedule[nextIndex].no} on ${formatTestDate(schedule[nextIndex].date)}`
              : " · none of them is still ahead, so nothing is being announced"}
          </p>
        )}
      </div>

      {/* The two ways this screen can be showing something other than the table.
          They are opposite instructions, so they are said separately. */}
      {needsMigration && (
        <p className="tsa__warn">
          The <strong>test_schedule</strong> table does not exist yet, so what is listed below is the
          2026-27 sheet built into the app — the portals are announcing that, and nothing here can be
          saved. Run <strong>supabase_test_schedule.sql</strong> in the Supabase SQL editor; it creates
          the table and seeds it with exactly these rows.
        </p>
      )}
      {source === "fallback" && !needsMigration && (
        <p className="tsa__warn">
          The schedule could not be read from the database, so the built-in sheet is shown. Sign out and
          in again before changing anything — an edit made now would not be saved.
        </p>
      )}
      {error && <p className="tsa__error">{error}</p>}

      {!editing && source === "database" && (
        <button type="button" className="tsa__add" onClick={() => setEditing(blankRow())}>
          <Plus size={14} /> Add a test
        </button>
      )}

      {editing && (
        <TestForm
          draft={editing}
          onChange={setEditing}
          onSave={() => save(editing)}
          onCancel={() => { setEditing(null); setError(""); }}
        />
      )}

      {loading ? (
        <p className="tsa__empty">Loading…</p>
      ) : schedule.length === 0 ? (
        <p className="tsa__empty">
          The schedule is empty, so no portal is announcing a test. Add the first one above.
        </p>
      ) : (
        <div className="tsa__table-wrap">
          <table className="tsa__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                {CLASS_YEARS.map((y) => <th key={y}>{y}</th>)}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {schedule.map((t, i) => {
                const past = daysBetween(today, t.date) < 0;
                return (
                  <tr
                    key={t.id || t.date}
                    className={
                      "tsa__row" +
                      (past ? " tsa__row--past" : "") +
                      (i === nextIndex ? " tsa__row--next" : "")
                    }
                  >
                    <td className="tsa__no">{t.no}</td>
                    <td className="tsa__date">
                      <strong>{formatTestDate(t.date)}</strong>
                      <span>{dayName(t.date)}</span>
                      {i === nextIndex && <span className="tsa__badge">Next</span>}
                      {t.note && <span className="tsa__note">{t.note}</span>}
                    </td>
                    {CLASS_YEARS.map((y) => (
                      <td key={y} className="tsa__papers">
                        {t.papers[y]
                          ? t.papers[y].map((paper, n) => (
                              <span key={n} className="tsa__paper">{paper.join(" / ")}</span>
                            ))
                          : <span className="tsa__none">No paper</span>}
                      </td>
                    ))}
                    <td className="tsa__actions">
                      {source === "database" && (
                        <>
                          <button type="button" onClick={() => startEdit(t)} aria-label={`Edit the test on ${formatTestDate(t.date)}`}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" className="tsa__del" onClick={() => remove(t)} aria-label={`Remove the test on ${formatTestDate(t.date)}`}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

const KEYS = { "1st Year": "firstYearPapers", "2nd Year": "secondYearPapers" };

function TestForm({ draft, onChange, onSave, onCancel }) {
  const setPapers = (year, papers) => onChange({ ...draft, [KEYS[year]]: papers });

  const usable = draft.date &&
    (draft.firstYearPapers.some((p) => p.length > 0) || draft.secondYearPapers.some((p) => p.length > 0));

  return (
    <div className="tsa__form">
      <div className="tsa__form-head">
        <h3>{draft.id ? "Edit test" : "Add a test"}</h3>
        <button type="button" onClick={onCancel} aria-label="Cancel"><X size={16} /></button>
      </div>

      <div className="tsa__fields">
        <label className="tsa__field">
          <span>Date</span>
          <input type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} />
        </label>
        <label className="tsa__field tsa__field--wide">
          <span>Note (optional)</span>
          <input
            type="text"
            value={draft.note}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            placeholder="Syllabus, what to bring — shown in the box on every portal"
          />
        </label>
      </div>

      <div className="tsa__classes">
        {CLASS_YEARS.map((year) => (
          <ClassPapers
            key={year}
            year={year}
            papers={draft[KEYS[year]]}
            onChange={(papers) => setPapers(year, papers)}
          />
        ))}
      </div>

      <div className="tsa__form-foot">
        <p className="tsa__form-hint">
          A class with no paper ticked simply does not sit that day — that is how the sheet shows
          1st year for the first two tests of the year.
        </p>
        <div className="tsa__form-actions">
          <button type="button" className="tsa__cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="tsa__save" onClick={onSave} disabled={!usable}>
            <Check size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One class's papers for one test day: a set of ticks per paper.
 *
 * Papers are added and removed rather than fixed at three, because nothing about
 * the schedule promises three — a revision week could be one.
 */
function ClassPapers({ year, papers, onChange }) {
  const rows = papers.length > 0 ? papers : [[]];

  const toggle = (index, subject) => {
    const next = rows.map((paper, i) => {
      if (i !== index) return paper;
      return paper.includes(subject) ? paper.filter((s) => s !== subject) : [...paper, subject];
    });
    onChange(next);
  };

  return (
    <fieldset className="tsa__class">
      <legend>{year}</legend>

      {rows.map((paper, i) => (
        <div key={i} className="tsa__paper-row">
          <div className="tsa__paper-head">
            <span>Paper {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, n) => n !== i))}
              aria-label={`Remove paper ${i + 1} for ${year}`}
            >
              <X size={12} />
            </button>
          </div>
          <div className="tsa__chips">
            {ALL_SUBJECTS.map((subject) => (
              <button
                key={subject}
                type="button"
                aria-pressed={paper.includes(subject)}
                className={"tsa__chip" + (paper.includes(subject) ? " tsa__chip--on" : "")}
                onClick={() => toggle(i, subject)}
              >
                {subject}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button type="button" className="tsa__add-paper" onClick={() => onChange([...rows, []])}>
        <Plus size={12} /> Add a paper
      </button>
      {rows.every((p) => p.length === 0) && (
        <p className="tsa__class-empty">Nothing ticked — {year} sits no paper this day.</p>
      )}
    </fieldset>
  );
}
