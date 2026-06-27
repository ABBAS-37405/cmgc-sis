import { useState } from "react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./Attendance.css";

export default function Attendance() {
  const [days] = useState(() =>
    Array.from({ length: 30 }, () => {
      const r = Math.random();
      return r > 0.85 ? "leave" : r > 0.15 ? "present" : "absent";
    })
  );
  const present = days.filter((d) => d === "present").length;
  const absent = days.filter((d) => d === "absent").length;
  const leave = days.filter((d) => d === "leave").length;
  const percent = Math.round((present / days.length) * 100);

  return (
    <div className="attendance">
      <div className="attendance__summary">
        <div className="attendance__stat"><p className="attendance__num attendance__num--green">{present}</p><p>Present</p></div>
        <div className="attendance__stat"><p className="attendance__num attendance__num--red">{absent}</p><p>Absent</p></div>
        <div className="attendance__stat"><p className="attendance__num attendance__num--amber">{leave}</p><p>Leave</p></div>
        <div className="attendance__stat"><p className="attendance__num attendance__num--blue">{percent}%</p><p>Overall</p></div>
      </div>
      <div className="attendance__calendar-card">
        <h3>This Month</h3>
        <div className="attendance__grid">
          {days.map((d, i) => (
            <div key={i} className={`attendance__day attendance__day--${d}`}>{i + 1}</div>
          ))}
        </div>
        <div className="attendance__legend">
          <span><i className="attendance__dot attendance__dot--green"></i> Present</span>
          <span><i className="attendance__dot attendance__dot--red"></i> Absent</span>
          <span><i className="attendance__dot attendance__dot--amber"></i> Leave</span>
        </div>
      </div>
      <WorkingOnIt text="Live attendance sync — pending Supabase connection" />
    </div>
  );
}