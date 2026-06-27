import { useState, useEffect } from "react";
import { Users, CheckCircle, GraduationCap, Award } from "lucide-react";
import "./Stats.css";

const TARGETS = [
  { label: "Students", value: 2000, suffix: "+", icon: Users },
  { label: "Pass Rate", value: 98, suffix: "%", icon: CheckCircle },
  { label: "Programs", value: 4, suffix: "", icon: GraduationCap },
  { label: "Years of Excellence", value: 15, suffix: "+", icon: Award },
];

export default function Stats() {
  const [counts, setCounts] = useState(TARGETS.map(() => 0));

  useEffect(() => {
    const timers = TARGETS.map((tg, i) =>
      setInterval(() => {
        setCounts((prev) => {
          const next = [...prev];
          if (next[i] < tg.value) next[i] = Math.min(next[i] + Math.ceil(tg.value / 40), tg.value);
          return next;
        });
      }, 30)
    );
    return () => timers.forEach(clearInterval);
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