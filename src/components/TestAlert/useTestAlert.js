import { useState, useEffect, useMemo, useCallback } from "react";
import {
  upcomingTest,
  shouldTell,
  readTold,
  rememberTold,
  todayKey,
} from "../../lib/testSchedule";
import { fetchSchedule } from "../../lib/testScheduleDb";

/**
 * The weekly-test box, decided for whoever has just opened a portal.
 *
 * Every portal calls this and every portal gets the same rule, which is the
 * whole reason it is a hook rather than three copies of an effect: the schedule
 * advancing, the once-per-test announcement and the daily run-up reminder are
 * one behaviour, and a second implementation of them would drift within a term.
 *
 * `year` narrows it to a student's own class; a teacher or an admin passes none
 * and gets the next test the college sits, whichever class sits it.
 *
 * One query on open, and the box waits for it rather than guessing from the
 * built-in sheet and correcting itself — announcing the wrong paper for a second
 * is worse than announcing the right one a moment later. `shouldTell` lives in
 * `lib/testSchedule.js` rather than here, so the decision can be driven from
 * plain Node.
 */
export function useTestAlert({ viewerKey, year } = {}) {
  const today = todayKey();
  const [schedule, setSchedule] = useState(null);

  useEffect(() => {
    if (!viewerKey) return undefined;
    let live = true;
    // A failed read falls back to the built-in sheet inside fetchSchedule; an
    // empty table comes back as an empty schedule and raises nothing.
    fetchSchedule().then(({ schedule: rows }) => { if (live) setSchedule(rows); });
    return () => { live = false; };
  }, [viewerKey]);

  const test = useMemo(
    () => (schedule ? upcomingTest(schedule, today, year) : null),
    [schedule, today, year],
  );

  /*
   * Whether to raise it is worked out during render, not in an effect that then
   * sets state — that is a second render for a question already answerable from
   * what we have. The read of "what was she last told" is memoised on the same
   * deps as the decision, so the write below cannot turn round and un-decide it.
   */
  const wanted = useMemo(
    () => Boolean(test && viewerKey && shouldTell(test, readTold(viewerKey), today)),
    [test, viewerKey, today],
  );

  const [dismissed, setDismissed] = useState(false);

  // The effect does one thing: tell localStorage what the render decided. Marked
  // as told when it opens rather than when it closes — a girl who reloads
  // instead of closing has still been told, and should not be told twice.
  useEffect(() => {
    if (wanted && test) rememberTold(viewerKey, test.date, today);
  }, [wanted, test, viewerKey, today]);

  const close = useCallback(() => setDismissed(true), []);

  // `total` is what makes "Test 4 of 27" honest: the count of the schedule that
  // was actually read, not a constant that a deploy could leave behind.
  return { test, total: schedule?.length || 0, open: wanted && !dismissed, close, today };
}
