import { CalendarCheck, Clock, Wallet, Award, Bell } from "lucide-react";
import "./Overview.css";

export default function Overview({ student }) {
  const stats = [
    { label: "Program", value: student?.program || "—", icon: Award, cls: "stat--purple" },
    { label: "Roll Number", value: student?.roll_no || "—", icon: Clock, cls: "stat--amber" },
    { label: "Phone", value: student?.phone || "—", icon: Wallet, cls: "stat--blue" },
    { label: "Attendance", value: "View →", icon: CalendarCheck, cls: "stat--green" },
  ];

  return (
    <div className="overview">
      <div className="overview__welcome">
        <div className="overview__welcome-content">
          <div>
            <p>Welcome back,</p>
            <h2>{student?.name || "Student"}</h2>
            <p className="overview__meta">{student?.program} • Roll No: {student?.roll_no}</p>
          </div>
          {student?.profile_picture_url && (
            <img src={student.profile_picture_url} alt={student.name} className="overview__profile-pic" />
          )}
        </div>
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

      <div className="overview__card">
        <h3><Bell size={14} /> Important</h3>
        <p className="overview__muted">Use the sidebar to check your Attendance, Results, and Fee status.</p>
      </div>
    </div>
  );
}