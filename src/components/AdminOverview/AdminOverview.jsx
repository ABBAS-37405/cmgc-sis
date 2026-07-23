import { useState, useEffect } from "react";
import { Users, Wallet, Bell, CalendarCheck, UserCheck, UserX, UserMinus } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import "./AdminOverview.css";

export default function AdminOverview() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    firstYearStudents: 0,
    secondYearStudents: 0,
    pendingApplications: 0,
    totalNotices: 0,
    todayAttendance: "Not Marked",
    presentToday: 0,
    absentToday: 0,
    leaveToday: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentApplications, setRecentApplications] = useState([]);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    // Total students
    const { count: studentsCount } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true });

    const { count: firstYearCount } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("year_of_study", "1st Year");

    const { count: secondYearCount } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("year_of_study", "2nd Year");

    // Pending applications
    const { count: pendingCount } = await supabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("status", "Pending");

    // Total notices
    const { count: noticesCount } = await supabase
      .from("notices")
      .select("*", { count: "exact", head: true });

    // Today's attendance
    const { count: attendanceCount } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("date", today);

    const { count: presentCount } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("date", today)
      .eq("status", "Present");

    const { count: absentCount } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("date", today)
      .eq("status", "Absent");

    const { count: leaveCount } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("date", today)
      .eq("status", "Leave");

    // Recent applications (last 5)
    const { data: recentApps } = await supabase
      .from("applications")
      .select("id, student_name, program, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    setStats({
      totalStudents: studentsCount || 0,
      firstYearStudents: firstYearCount || 0,
      secondYearStudents: secondYearCount || 0,
      pendingApplications: pendingCount || 0,
      totalNotices: noticesCount || 0,
      todayAttendance: attendanceCount > 0 ? `${attendanceCount} Records` : "Not Marked",
      presentToday: presentCount || 0,
      absentToday: absentCount || 0,
      leaveToday: leaveCount || 0,
    });

    if (recentApps) setRecentApplications(recentApps);
    setLoading(false);
  };

  const statCards = [
    { label: "Total 1st Year", value: loading ? "..." : stats.firstYearStudents, icon: Users, cls: "admin-stat--blue" },
    { label: "Total 2nd Year", value: loading ? "..." : stats.secondYearStudents, icon: Users, cls: "admin-stat--green" },
    { label: "Grand Total", value: loading ? "..." : stats.totalStudents, icon: Users, cls: "admin-stat--purple" },
    { label: "Pending Applications", value: loading ? "..." : stats.pendingApplications, icon: Wallet, cls: "admin-stat--amber" },
    { label: "Notices Posted", value: loading ? "..." : stats.totalNotices, icon: Bell, cls: "admin-stat--red" },
    { label: "Today's Attendance", value: loading ? "..." : stats.todayAttendance, icon: CalendarCheck, cls: "admin-stat--teal" },
    { label: "Present Today", value: loading ? "..." : stats.presentToday, icon: UserCheck, cls: "admin-stat--green" },
    { label: "Absent Today", value: loading ? "..." : stats.absentToday, icon: UserX, cls: "admin-stat--red" },
    { label: "Leave Today", value: loading ? "..." : stats.leaveToday, icon: UserMinus, cls: "admin-stat--amber" },
  ];

  const statusColor = (status) => {
    if (status === "Approved") return "admin-overview__badge--approved";
    if (status === "Rejected") return "admin-overview__badge--rejected";
    return "admin-overview__badge--pending";
  };

  return (
    <div className="admin-overview">
      <div className="admin-overview__stats">
        {statCards.map((s) => (
          <div key={s.label} className="admin-overview__card">
            <div className={`admin-overview__icon ${s.cls}`}><s.icon size={18} /></div>
            <p className="admin-overview__value">{s.value}</p>
            <p className="admin-overview__label">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="admin-overview__recent">
        <h3>Recent Applications</h3>
        {recentApplications.length === 0 ? (
          <p className="admin-overview__empty">No applications yet</p>
        ) : (
          <div className="admin-overview__table-wrap">
            <table className="admin-overview__table">
              <thead>
                <tr><th>Name</th><th>Program</th><th>Date</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentApplications.map((a) => (
                  <tr key={a.id}>
                    <td>{a.student_name}</td>
                    <td>{a.program}</td>
                    <td>{new Date(a.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short" })}</td>
                    <td><span className={`admin-overview__badge ${statusColor(a.status)}`}>{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}