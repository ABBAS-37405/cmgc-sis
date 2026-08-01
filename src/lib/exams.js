/**
 * The kinds of examination the college records marks for.
 *
 * `EnterResults` builds `results.exam_name` by pinning one of these to a date
 * ("Pre-Board Exam - 15 August 2026") or, for a monthly test, to a month
 * ("Monthly Test - August 2026"). Nothing in the database constrains that
 * column, so this list is the only definition there is — renaming an entry
 * orphans every row already saved under the old name.
 *
 * Kept out of academics.js deliberately: that file is about what each group
 * studies and is reached from the landing page, while exam vocabulary is only
 * ever needed inside the admin portal's lazy chunk.
 */

export const CLASS_TEST_EXAM_TYPE = "Class Test";

export const EXAM_TYPES = [
  CLASS_TEST_EXAM_TYPE,
  "Monthly Test",
  "Bi-Monthly",
  "Send-Up Exam",
  "Pre-Board Exam",
];

/**
 * Everything an Exam Report may cover.
 *
 * Class tests are excluded on purpose: they live in their own table, carry
 * several tests per subject rather than one mark, and already have two screens
 * of their own (the Monthly tab summarises them, the Test Reports tab prints
 * them). An "exam report" here always means a term examination.
 */
export const REPORTABLE_EXAM_TYPES = EXAM_TYPES.filter((t) => t !== CLASS_TEST_EXAM_TYPE);

/**
 * The exam type a stored name belongs to.
 *
 * Names are `"<type> - <date or month>"`, so the type is a prefix match. Longest
 * first, because a shorter type that prefixes a longer one would otherwise claim
 * its rows. Anything unrecognised — a name typed before this list existed —
 * returns null rather than being forced into the wrong group.
 */
export function examTypeOf(name) {
  if (!name) return null;
  const match = [...EXAM_TYPES]
    .sort((a, b) => b.length - a.length)
    .find((t) => name === t || name.startsWith(`${t} -`));
  return match || null;
}
