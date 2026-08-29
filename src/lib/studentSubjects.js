/**
 * What one particular girl studies — as opposed to what her group offers.
 *
 * A group is the floor, not the answer. FA-IT offers two elective combinations
 * and Humanities three, so "Humanities" does not say whether Mathematics or
 * Civics is hers; the combination she picked at admission does, and it is
 * carried on her student record as `students.subject_combination`.
 *
 * Everything that asks "does she sit this subject" goes through this file, so
 * there is one definition of it: marks entry for a class test, an assignment
 * sheet, her exam marks sheet, and a printed test report.
 *
 * **Split from `academics.js` for bundle reasons, not tidiness.** That file is
 * reached from the landing page (the public Programs section), so anything in it
 * ships to a first-time visitor; this logic is only ever needed inside the
 * portals, and leaving it there measured **+703 bytes on a landing bundle held
 * at ~431 kB**. Exactly the `session.js` / `sessionRestore.js` and
 * `notices.js` / `noticesAdmin.js` split, for exactly the same reason.
 *
 * It imports only `academics.js`, which is pure, so all of it can be driven from
 * plain Node.
 */

import { GROUP_COMBINATIONS, subjectsFor, compulsoryFor, groupHasChoice } from "./academics";

/**
 * The electives she actually chose, read out of the stored string.
 *
 * `subject_combination` is a readable line ("Economics, Education, Mathematics"),
 * so it is parsed defensively: anything in it that is not an elective this group
 * offers is dropped. An empty result means nothing usable was recorded, which is
 * a different thing from "she chose nothing" — see `subjectStatusFor`.
 */
function pickedElectives(group, combination) {
  if (!combination) return [];
  const electives = new Set((GROUP_COMBINATIONS[group] || []).flat());
  return String(combination)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => electives.has(s));
}

/**
 * Everything this particular girl studies: her own electives plus the compulsory
 * subjects of her year.
 *
 * Falls back to the group's whole list when no combination was recorded —
 * showing more than she takes is a harmless over-answer, showing a subject she
 * does not sit is not.
 */
export function studiedSubjects(group, year, combination) {
  const picked = pickedElectives(group, combination);
  return picked.length > 0 ? [...picked, ...compulsoryFor(year)] : subjectsFor(group, year);
}

/**
 * Whether this student sits this subject — `"yes"`, `"no"` or `"unknown"`.
 *
 * Three states rather than two, and the third is the important one. A student
 * enrolled before `subject_combination` existed, or added by hand without one,
 * carries no combination at all; in a group that offers a choice there is then
 * no way to tell. **Leaving her out would hide her from marks entry entirely**
 * and nobody would ever see why — her marks simply would not exist. So
 * `"unknown"` is reported separately and every caller includes her, with the
 * screen saying that her combination is not on record.
 *
 * The same principle as `notMarked` never printing as 0, and as the storage
 * sweep never deleting on the strength of a failed read: the safe direction is
 * to show too much and say so, never to quietly show too little.
 */
export function subjectStatusFor(student, subject) {
  if (!subject) return "yes";

  const group = student?.program;
  const year = student?.year_of_study;
  if (!group || !GROUP_COMBINATIONS[group]) return "unknown";

  // Year-narrowed, so a 2nd year is not counted as sitting Islamiat.
  if (!subjectsFor(group, year).includes(subject)) return "no";
  // Compulsory and offered to her year: hers whatever she chose.
  if (compulsoryFor(year).includes(subject)) return "yes";
  // One combination means the group's list is her list.
  if (!groupHasChoice(group)) return "yes";

  const picked = pickedElectives(group, student?.subject_combination);
  if (picked.length === 0) return "unknown";
  return picked.includes(subject) ? "yes" : "no";
}

/** True unless she is definitely not sitting it — `"unknown"` counts as taking. */
export const takesSubject = (student, subject) => subjectStatusFor(student, subject) !== "no";

/**
 * A roster split for one subject: who to show, who to leave out, and who is only
 * being shown because her combination was never recorded.
 *
 * `taking` includes `unknown`, so it is the list to render; `unknown` is carried
 * alongside purely so the screen can say why those rows are there.
 */
export function splitBySubject(students, subject) {
  const taking = [];
  const notTaking = [];
  const unknown = [];

  (students || []).forEach((s) => {
    const status = subjectStatusFor(s, subject);
    if (status === "no") return notTaking.push(s);
    if (status === "unknown") unknown.push(s);
    taking.push(s);
  });

  return { taking, notTaking, unknown };
}
