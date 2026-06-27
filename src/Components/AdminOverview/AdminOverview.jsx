import { Users, Wallet, Bell, CalendarCheck } from "lucide-react";
import "./AdminOverview.css";

export default function AdminOverview() {
  const stats = [
    { label: "Total Students", value: 248, icon: Users, cls: "admin-stat--blue" },
    { label: "Pending Fee Verifications", value: 12, icon: Wallet, cls: "admin-stat--amber" },
    { label: "Notices Posted", value: 5, icon: Bell, cls: "admin-stat--purple" },
    { label: "Today's Attendance", value: "Not Marked", icon: CalendarCheck, cls: "admin-stat--red" },
  ];
  return (
    <div className="admin-overview">
      {stats.map((s) => (
        <div key={s.label} className="admin-overview__card">
          <div className={`admin-overview__icon ${s.cls}`}><s.icon size={18} /></div>
          <p className="admin-overview__value">{s.value}</p>
          <p className="admin-overview__label">{s.label}</p>
        </div>
      ))}
    </div>
  );
}