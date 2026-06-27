import { useState } from "react";
import { Check } from "lucide-react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./EnterResults.css";

export default function EnterResults() {
  const [student, setStudent] = useState("Ayesha Khan");
  const [marks, setMarks] = useState({ Physics: "", Chemistry: "", Mathematics: "", English: "" });
  const [saved, setSaved] = useState(false);

  return (
    <div className="enter-results">
      <h3>Enter Exam Result</h3>
      <select value={student} onChange={(e) => setStudent(e.target.value)}>
        <option>Ayesha Khan</option><option>Fatima Noor</option><option>Zainab Ali</option><option>Sana Riaz</option>
      </select>
      {Object.keys(marks).map((subject) => (
        <div key={subject} className="enter-results__row">
          <label>{subject}</label>
          <input type="number" value={marks[subject]} onChange={(e) => { setMarks({ ...marks, [subject]: e.target.value }); setSaved(false); }} placeholder="/ 100" />
        </div>
      ))}
      <button onClick={() => setSaved(true)} className="enter-results__save">Save Result</button>
      {saved && <p className="enter-results__confirm"><Check size={12} /> Saved for this session</p>}
      <div className="enter-results__footer"><WorkingOnIt text="Permanent save to database — pending Supabase connection" /></div>
    </div>
  );
}