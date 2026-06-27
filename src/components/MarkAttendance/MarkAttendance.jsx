import { useState } from "react";
import { Check } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./MarkAttendance.css";

const INITIAL = [
  { roll: "CMGC-2026-045", name: "Ayesha Khan", status: "present" },
  { roll: "CMGC-2026-046", name: "Fatima Noor", status: "present" },
  { roll: "CMGC-2026-047", name: "Zainab Ali", status: "absent" },
  { roll: "CMGC-2026-048", name: "Sana Riaz", status: "leave" },
];

export default function MarkAttendance() {
  const [records, setRecords] = useState(INITIAL);
  const [saved, setSaved] = useState(false);

  const setStatus = (roll, status) => {
    setRecords(records.map((r) => (r.roll === roll ? { ...r, status } : r)));
    setSaved(false);
  };

  return (
    <div className="mark-attendance">
      <div className="mark-attendance__header">
        <h3>Mark Attendance — Today</h3>
        <select>
          <option>FSc Pre-Medical</option><option>ICS</option><option>FA</option><option>ICOM</option>
        </select>
      </div>
      {records.map((r) => (
        <div key={r.roll} className="mark-attendance__row">
          <div>
            <p className="mark-attendance__name">{r.name}</p>
            <p className="mark-attendance__roll">{r.roll}</p>
          </div>
          <div className="mark-attendance__buttons">
            <button onClick={() => setStatus(r.roll, "present")} className={`mark-attendance__btn mark-attendance__btn--present ${r.status === "present" ? "mark-attendance__btn--active" : ""}`}>Present</button>
            <button onClick={() => setStatus(r.roll, "absent")} className={`mark-attendance__btn mark-attendance__btn--absent ${r.status === "absent" ? "mark-attendance__btn--active" : ""}`}>Absent</button>
            <button onClick={() => setStatus(r.roll, "leave")} className={`mark-attendance__btn mark-attendance__btn--leave ${r.status === "leave" ? "mark-attendance__btn--active" : ""}`}>Leave</button>
          </div>
        </div>
      ))}
      <button onClick={() => setSaved(true)} className="mark-attendance__save">Save Attendance</button>
      {saved && <p className="mark-attendance__confirm"><Check size={12} /> Saved for this session</p>}
      <div className="mark-attendance__footer"><WorkingOnIt text="Permanent save to database — pending Supabase connection" /></div>
    </div>
  );
}