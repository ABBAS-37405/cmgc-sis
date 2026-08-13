import { useState, useEffect } from "react";
import { Users, CheckCircle, GraduationCap, Award } from "lucide-react";
import { PROGRAMS } from "../../lib/academics";
import "./Stats.css";

const TARGETS = [
  { label: "Students", value: 2000, suffix: "+", icon: Users },
  { label: "Pass Rate", value: 98, suffix: "%", icon: CheckCircle },
  // Counted from the group definitions, not typed in — this said 4 long after
  // FA-IT and Humanities took the real number to 6.
  { label: "Programs", value: PROGRAMS.length, suffix: "", icon: GraduationCap },
  { label: "Years of Excellence", value: 15, suffix: "+", icon: Award },
];

const DURATION = 1200;

/** Someone who has asked their device for less motion gets the finished number. */
const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function Stats() {
  const [counts, setCounts] = useState(() =>
    prefersReducedMotion() ? TARGETS.map((t) => t.value) : TARGETS.map(() => 0)
  );

  /*
   * One animation frame loop that stops when it is finished.
   *
   * This used to be four setIntervals at 30ms — 133 state updates a second —
   * and none of them was ever cleared: the callback returned a fresh array on
   * every tick whether the number had changed or not, so React kept re-rendering
   * for as long as the page was open. On a phone that is the whole landing page
   * competing with the visitor's scroll, hours after the counters finished.
   *
   * Now it runs for 1.2 seconds, eases out, and cancels itself.
   */
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;

    let frame = 0;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min((now - start) / DURATION, 1);
      const eased = 1 - (1 - t) ** 3;
      setCounts(TARGETS.map((tg) => Math.round(tg.value * eased)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="stats">
      <div className="stats__grid">
        {TARGETS.map((tg, i) => (
          <div key={tg.label} className="stats__card">
            <tg.icon className="stats__icon" size={28} />
            <div className="stats__value">{counts[i]}{tg.suffix}</div>
            <div className="stats__label">{tg.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}