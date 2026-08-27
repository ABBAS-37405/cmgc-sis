import "./RosterNote.css";

/**
 * Why this sheet is shorter than the class.
 *
 * A group is not a subject list. Humanities offers three combinations and only
 * one of them takes Mathematics, so a Maths sheet for Humanities is a handful of
 * girls, not the whole class — and a teacher who counts thirty-one where she
 * knows there are forty needs that said out loud, or she will assume the screen
 * is broken and go looking for the missing names.
 *
 * The second half is the more important one. A girl whose `subject_combination`
 * was never recorded cannot be placed either way, so she is **kept on the sheet**
 * and named here: leaving her out would hide her from marks entry entirely and
 * nothing on screen would ever say why. Same principle as `notMarked` never
 * printing as 0 — the safe direction is to show too much and explain it.
 *
 * Shared by Class Tests and Assignments rather than written twice, so the two
 * can never end up explaining the same rule differently.
 */
export default function RosterNote({ subject, split }) {
  const hidden = split?.notTaking || 0;
  const unknown = split?.unknown || [];
  if (hidden === 0 && unknown.length === 0) return null;

  return (
    <div className="roster-note" role="status">
      {hidden > 0 && (
        <p className="roster-note__line">
          <strong>{hidden}</strong> student{hidden === 1 ? "" : "s"} in this class{" "}
          {hidden === 1 ? "does" : "do"} not take <strong>{subject}</strong> and{" "}
          {hidden === 1 ? "is" : "are"} not on this sheet.
        </p>
      )}

      {unknown.length > 0 && (
        <p className="roster-note__line roster-note__line--warn">
          <strong>{unknown.length}</strong> {unknown.length === 1 ? "girl has" : "girls have"} no
          subject combination on record, so {unknown.length === 1 ? "she is" : "they are"} listed to
          be safe: {unknown.map((s) => s.name).join(", ")}. Set it from{" "}
          <strong>Students → Edit</strong> and {unknown.length === 1 ? "she" : "they"} will be placed
          correctly from then on.
        </p>
      )}
    </div>
  );
}
