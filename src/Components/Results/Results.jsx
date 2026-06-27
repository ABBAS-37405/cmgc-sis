import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./Results.css";

export default function Results() {
  const subjects = [
    { name: "Physics", marks: 82, total: 100 },
    { name: "Chemistry", marks: 78, total: 100 },
    { name: "Mathematics", marks: 91, total: 100 },
    { name: "English", marks: 85, total: 100 },
  ];
  const totalMarks = subjects.reduce((a, s) => a + s.marks, 0);
  const totalOf = subjects.reduce((a, s) => a + s.total, 0);
  const percentage = Math.round((totalMarks / totalOf) * 100);
  const examSchedule = [
    { date: "July 2", subject: "Physics", time: "9:00 AM", room: "Room 4" },
    { date: "July 4", subject: "Chemistry", time: "9:00 AM", room: "Room 4" },
  ];

  return (
    <div className="results">
      <div className="results__card">
        <div className="results__header">
          <h3>Mid-Term Result</h3>
          <span className="results__badge">🥈 2nd Position</span>
        </div>
        {subjects.map((s) => (
          <div key={s.name} className="results__row">
            <span className="results__muted">{s.name}</span>
            <span>{s.marks} / {s.total}</span>
          </div>
        ))}
        <div className="results__total">
          <span>Total ({percentage}%)</span>
          <span className="results__total-value">{totalMarks} / {totalOf}</span>
        </div>
        <button className="results__download">Download Result Slip</button>
      </div>

      <div className="results__card">
        <h3>Upcoming Exam Schedule</h3>
        {examSchedule.map((e) => (
          <div key={e.subject} className="results__row">
            <span>{e.subject}</span>
            <span className="results__muted">{e.date}, {e.time} — {e.room}</span>
          </div>
        ))}
      </div>
      <WorkingOnIt text="Live results from database — pending Supabase connection" />
    </div>
  );
}