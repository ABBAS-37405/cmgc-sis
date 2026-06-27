import { useState } from "react";
import { Search, Plus } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./StudentsList.css";

const STUDENTS = [
  { roll: "CMGC-2026-045", name: "Ayesha Khan", program: "FSc Pre-Medical", attendance: 92, fee: "Unpaid" },
  { roll: "CMGC-2026-046", name: "Fatima Noor", program: "ICS", attendance: 88, fee: "Paid" },
  { roll: "CMGC-2026-047", name: "Zainab Ali", program: "FA", attendance: 95, fee: "Paid" },
  { roll: "CMGC-2026-048", name: "Sana Riaz", program: "ICOM", attendance: 79, fee: "Unpaid" },
];

export default function StudentsList() {
  const [search, setSearch] = useState("");
  const filtered = STUDENTS.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()) || s.roll.includes(search));

  return (
    <div className="students-list">
      <div className="students-list__toolbar">
        <div className="students-list__search">
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or roll no..." />
        </div>
        <button className="students-list__add"><Plus size={15} /> Add Student</button>
      </div>
      <div className="students-list__table-wrap">
        <table className="students-list__table">
          <thead><tr><th>Roll No</th><th>Name</th><th>Program</th><th>Attendance</th><th>Fee</th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.roll}>
                <td>{s.roll}</td>
                <td className="students-list__name">{s.name}</td>
                <td>{s.program}</td>
                <td>{s.attendance}%</td>
                <td><span className={`students-list__badge ${s.fee === "Paid" ? "students-list__badge--paid" : "students-list__badge--unpaid"}`}>{s.fee}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="students-list__footer"><WorkingOnIt text="Add/Edit student — pending Supabase connection" /></div>
    </div>
  );
}