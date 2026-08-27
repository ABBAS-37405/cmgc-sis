/**
 * Everything that reaches Supabase for the weekly test schedule.
 *
 * Split from `testSchedule.js` the same way `sessionRestore.js` is split from
 * `session.js` and `noticesAdmin.js` from `notices.js`: the deciding half —
 * which test is next, whose papers those are, whether to raise the box — imports
 * nothing and can be driven from plain Node, and this half is the only thing
 * that knows a database exists.
 *
 * The writes are exported from the same module as the read rather than a third
 * file, because Rollup drops unused exports: the student portal's chunk imports
 * `fetchSchedule` and carries none of the rest.
 */

import { supabase } from "./supabaseClient";
import { normaliseSchedule, FALLBACK_SCHEDULE } from "./testSchedule";

const COLUMNS = "id, test_date, first_year_papers, second_year_papers, note";

/**
 * "The table is not there yet", in the two shapes it actually arrives in.
 *
 * PostgREST answers a missing table with **`PGRST205`** ("Could not find the
 * table 'public.test_schedule' in the schema cache"), not with Postgres's own
 * `42P01` — checking only the latter, which is the obvious guess, would treat a
 * database with no migration run as an unexplained failure. `42P01` is kept
 * because it is what comes back from an RPC or a stale connection that reaches
 * Postgres directly. A stale schema cache reports `PGRST205` too, and falling
 * back is the right answer there as well.
 */
const isMissingTable = (error) => error?.code === "PGRST205" || error?.code === "42P01";

/**
 * The whole schedule, in date order.
 *
 * **A failed read falls back to the built-in sheet; an empty table does not.**
 * They are opposite facts and must not collapse into one another. The table not
 * being there yet (the SQL not pasted into the dashboard) or a refused
 * read says nothing about what the schedule is, and a box that disappears
 * because a deploy landed before a migration is the worse failure. A table that
 * is genuinely empty is an office that cleared it, and last year's sheet
 * reappearing would be worse than nothing at all.
 *
 * `source` is what the admin screen reports out loud, so nobody edits rows that
 * are not the ones being shown.
 */
export async function fetchSchedule() {
  const { data, error } = await supabase.from("test_schedule").select(COLUMNS).order("test_date");

  if (error) {
    return {
      schedule: FALLBACK_SCHEDULE,
      source: "fallback",
      needsMigration: isMissingTable(error),
      error: error.message,
    };
  }

  return { schedule: normaliseSchedule(data), source: "database", needsMigration: false, error: null };
}

/**
 * One test day, inserted or updated.
 *
 * `.select()` and an empty result treated as failure, because **a write RLS
 * refuses comes back a plain success with zero rows** — the rule from CLAUDE.md.
 * The two causes here are an expired admin session (the request went out as
 * anon) and an admin without the `notices` permission.
 */
export async function saveTest({ id, date, firstYearPapers, secondYearPapers, note }) {
  const row = {
    test_date: date,
    first_year_papers: firstYearPapers?.length ? firstYearPapers : null,
    second_year_papers: secondYearPapers?.length ? secondYearPapers : null,
    note: note?.trim() || null,
  };

  const query = id
    ? supabase.from("test_schedule").update(row).eq("id", id)
    : supabase.from("test_schedule").insert(row);

  const { data, error } = await query.select(COLUMNS);
  if (error) return { error: describeWriteError(error), row: null };
  if (!data || data.length === 0) return { error: null, row: null, blocked: true };
  return { error: null, row: data[0] };
}

export async function deleteTest(id) {
  const { data, error } = await supabase.from("test_schedule").delete().eq("id", id).select("id");
  if (error) return { error: error.message, removed: false };
  // Zero rows back from a delete is the silent RLS refusal again.
  return { error: null, removed: Boolean(data && data.length > 0) };
}

/**
 * The one error worth translating: two tests entered on the same day.
 *
 * `test_date` is unique, so this is what the office sees when it types a date
 * that is already on the schedule — and "duplicate key value violates unique
 * constraint" is not a sentence anybody in an office should have to read.
 */
function describeWriteError(error) {
  if (error?.code === "23505") {
    return "There is already a test on that date. Edit that row instead of adding a second one.";
  }
  if (isMissingTable(error)) {
    return "The test_schedule table does not exist yet — run supabase_test_schedule.sql in the Supabase SQL editor.";
  }
  return error?.message || "Could not save.";
}
