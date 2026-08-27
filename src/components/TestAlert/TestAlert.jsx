import { useEffect } from "react";
import { CalendarClock, X } from "lucide-react";
import {
  slotsFor,
  classSits,
  describeWhen,
  formatTestDate,
  dayName,
  daysBetween,
  todayKey,
  CLASS_YEARS,
  SCHEDULE_TITLE,
} from "../../lib/testSchedule";
import "./TestAlert.css";

/**
 * The box that opens on a portal: the next weekly test, its date, and the papers
 * on it.
 *
 * A dialog rather than a strip on the overview, because it is the one thing on
 * the screen that is time-critical — a paper on Friday is no use noticed on
 * Saturday — and because the office asked for it to be the first thing seen.
 * Everything about *when* it appears is in `useTestAlert`; this only draws it.
 *
 * `student` (group and subject combination) turns the sheet's "MATHS/BIO/CVS"
 * into her own paper. Without it — a teacher, an admin — both classes are shown
 * exactly as published, which is what a staff member needs anyway: she is not in
 * one of the two classes, she is invigilating both.
 */
export default function TestAlert({ test, total, year, student, onClose, onOpenSchedule }) {
  // Escape closes it, like any other dialog. Bound while it is on screen only.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!test) return null;

  // todayKey(), never toISOString(): that is UTC, and in Pakistan it is still
  // yesterday's date until five in the morning.
  const days = daysBetween(todayKey(), test.date);
  const imminent = days <= 1;
  // A student sees her own class; staff see both, and only the classes that
  // actually sit that day — 1st year had no paper for the first two tests.
  const classes = (year ? [year] : CLASS_YEARS).filter((y) => classSits(test, y));

  return (
    <div
      className="test-alert"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
    >
      <div className="test-alert__box" role="dialog" aria-modal="true" aria-labelledby="test-alert-title">
        <button type="button" className="test-alert__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="test-alert__head">
          <span className="test-alert__icon"><CalendarClock size={20} /></span>
          <div>
            <p className="test-alert__eyebrow">{SCHEDULE_TITLE}</p>
            <h3 className="test-alert__title" id="test-alert-title">
              {days === 0 ? "Your test is today" : "Your next test"}
            </h3>
          </div>
        </div>

        <p className={"test-alert__when" + (imminent ? " test-alert__when--soon" : "")}>
          <strong>{dayName(test.date)}, {formatTestDate(test.date)}</strong>
          <span className="test-alert__countdown">{describeWhen(test)}</span>
        </p>

        {classes.map((y) => {
          const slots = slotsFor(test, y, year ? student : null);
          return (
            <div key={y} className="test-alert__class">
              {/* The class heading is only worth its line when both are shown. */}
              {!year && <p className="test-alert__class-name">{y}</p>}
              <ul className="test-alert__subjects">
                {slots.map((slot, i) => (
                  <li key={i} className="test-alert__subject">
                    <span className="test-alert__paper">Paper {i + 1}</span>
                    <span className="test-alert__name">{slot.text}</span>
                    {/* The published wording is kept beside anything narrowed for
                        her, never instead of it: the sheet on the notice board is
                        what the college signed, and she should be able to find
                        her paper on it. */}
                    {slot.narrowed && (
                      <span className="test-alert__published">from {slot.published}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {/* Whatever the office added — the syllabus, what to bring. Rendered
            after the papers because it qualifies them rather than replaces them. */}
        {test.note && <p className="test-alert__note">{test.note}</p>}

        <div className="test-alert__foot">
          <span className="test-alert__count">Test {test.no}{total ? ` of ${total}` : ""}</span>
          <div className="test-alert__actions">
            {onOpenSchedule && (
              <button type="button" className="test-alert__link" onClick={onOpenSchedule}>
                Full schedule
              </button>
            )}
            <button type="button" className="test-alert__ok" onClick={onClose}>Got it</button>
          </div>
        </div>
      </div>
    </div>
  );
}
