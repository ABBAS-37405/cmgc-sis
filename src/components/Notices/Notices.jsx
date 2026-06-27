import { useState } from "react";
import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./Notices.css";

const INITIAL = [
  { title: "Mid-term exams start Monday", category: "Exam" },
  { title: "Sports gala registration open", category: "Event" },
];

export default function Notices() {
  const [notices, setNotices] = useState(INITIAL);
  const [newTitle, setNewTitle] = useState("");
  const [category, setCategory] = useState("General");

  const addNotice = () => {
    if (!newTitle.trim()) return;
    setNotices([{ title: newTitle, category }, ...notices]);
    setNewTitle("");
  };

  return (
    <div className="notices">
      <div className="notices__form">
        <h3>Post New Notice</h3>
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Notice title..." />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option>General</option><option>Exam</option><option>Holiday</option><option>Event</option>
        </select>
        <button onClick={addNotice}>Post Notice</button>
        <div className="notices__working"><WorkingOnIt text="Permanent save — pending Supabase connection" /></div>
      </div>
      <div className="notices__list">
        <h3>All Notices</h3>
        {notices.map((n, i) => (
          <div key={i} className="notices__row">
            <p>{n.title}</p>
            <span>{n.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
}