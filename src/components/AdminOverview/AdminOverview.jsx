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

  /*
   * Ten counts and one list, fired together rather than one after another.
   *
   * Each of these used to be its own `await`, so the first screen an admin sees
   * cost ten round trips end to end — a second and a half of "..." on a good
   * connection, longer on a phone. They do not depend on each other, so nothing
   * was gained by making them queue. Every one is `head: true`, so the database
   * returns a count and no rows.
   */
  const fetchStats = async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    const countOf = (table, build = (q) => q) =>
      build(supabase.from(table).select("*", { count: "exact", head: true }));

    const attendanceToday = (status) =>
      countOf("attendance", (q) => (status ? q.eq("date", today).eq("status", status) : q.eq("date", today)));

    const [
      { count: studentsCount },
      { count: firstYearCount },
      { count: secondYearCount },
      { count: pendingCount },
      { count: noticesCount },
      { count: attendanceCount },
      { count: presentCount },
      { count: absentCount },
      { count: leaveCount },
      { data: recentApps },
    ] = await Promise.all([
      countOf("students", (q) => q.is("deleted_at", null)),
      countOf("students", (q) => q.is("deleted_at", null).eq("year_of_study", "1st Year")),
      countOf("students", (q) => q.is("deleted_at", null).eq("year_of_study", "2nd Year")),
      countOf("applications", (q) => q.is("deleted_at", null).eq("status", "Pending")),
      countOf("notices"),
      attendanceToday(null),
      attendanceToday("Present"),
      attendanceToday("Absent"),
      attendanceToday("Leave"),
      supabase
        .from("applications")
        .select("id, student_name, program, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, []);

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