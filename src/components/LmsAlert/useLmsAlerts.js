import { useState, useEffect, useCallback, useRef } from "react";
import { fetchMaterialsForStudent } from "../../lib/lms";
import {
  newMaterialsSince, readLmsSeen, writeLmsSeen, firstVisitSeenAt,
} from "../../lib/lmsAlerts";

/**
 * The machine behind the "new material" notice, kept next to its banner exactly
 * like `useWhatsAppQueue` is.
 *
 * One query when her portal opens — the same query her LMS tab already runs, so
 * it returns her group and her year and nothing else. Everything after that is
 * arithmetic in `lmsAlerts.js`.
 *
 * `seen()` is what the LMS tab calls: opening the tab *is* reading them, so
 * nothing has to be dismissed for the badge to go away. `dismiss()` is the
 * separate case of "not now" — it clears the banner without claiming she has
 * read anything, so the badge stays and it returns next time she signs in.
 */
export function useLmsAlerts(student) {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  // Survives the tab changes that re-run nothing else here.
  const studentId = student?.id || null;
  const loadedFor = useRef(null);

  useEffect(() => {
    if (!studentId || loadedFor.current === studentId) return undefined;
    loadedFor.current = studentId;
    let live = true;

    (async () => {
      const lastSeen = readLmsSeen(studentId);

      // First time this browser has had her signed in: stamp now and announce
      // nothing, rather than calling a term's worth of material unread.
      if (!lastSeen) {
        writeLmsSeen(studentId, firstVisitSeenAt());
        return;
      }

      const materials = await fetchMaterialsForStudent(student);
      if (!live) return;
      setItems(newMaterialsSince(materials, lastSeen));
    })();

    return () => { live = false; };
    // `student` is deliberately not a dependency: it is a whole row and a new
    // object identity on every render would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  /** She has opened the LMS — everything showing is now read. */
  const seen = useCallback(() => {
    if (!studentId) return;
    writeLmsSeen(studentId);
    setItems([]);
    setDismissed(false);
  }, [studentId]);

  /** "Not now": the banner goes, the badge stays, it is back next sign-in. */
  const dismiss = useCallback(() => setDismissed(true), []);

  return { items, count: items.length, showBanner: !dismissed && items.length > 0, seen, dismiss };
}
