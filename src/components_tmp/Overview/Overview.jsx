import { CalendarCheck, Clock, Wallet, Award, Bell } from "lucide-react";
import "./Overview.css";

export default function Overview({ student }) {
  const stats = [
    { label: "Attendance", value: `${student.attendance}%`, icon: CalendarCheck, cls: "stat--green" },
    { label: "Next Exam", value: student.nextExam, icon: Clock, cls: "stat--amber" },
    { label: "Fee Status", value: student.feeStatus, icon: Wallet, cls: "stat--blue" },
    { label: "GPA", value: student.gpa, icon: Award, cls: "stat--purple" },
  ];
  const timetable = [
    { time: "8:00 - 8:45", subject: "Physics" },
    { time: "8:45 - 9:30", subject: "Chemistry" },
    { time: "9:30 - 10:15", subject: "Mathematics" },
    { time: "10:30 - 11:15", subject: "English" },
  ];
  const announcements = [
    { title: "Mid-term exams start Monday", date: "2 days ago" },
    { title: "Sports gala registration open", date: "5 days ago" },
  ];

  return (
    <div className="overview">
      <div className="overview__welcome">
        <p>Welcome back,</p>
        <h2>{student.name}</h2>
        <p className="overview__meta">{student.program} • Roll No: {student.roll}</p>
      </div>

      <div className="overview__stats">
        {stats.map((s) => (
          <div key={s.label} className="overview__stat-card">
            <div className={`overview__stat-icon ${s.cls}`}><s.icon size={18} /></div>
            <p className="overview__stat-value">{s.value}</p>
            <p className="overview__stat-label">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="overview__grid">
        <div className="overview__card">
          <h3>Today's Timetable</h3>
          {timetable.map((t) => (
            <div key={t.subject} className="overview__row">
              <span className="overview__muted">{t.time}</span>
              <span>{t.subject}</span>
            </div>
          ))}
        </div>
        <div className="overview__card">
          <h3><Bell size={14} /> Announcements</h3>
          {announcements.map((a) => (
            <div key={a.title} className="overview__announcement">
              <p>{a.title}</p>
              <p className="overview__muted">{a.date}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}