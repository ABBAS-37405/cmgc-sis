import { CalendarCheck, Clock, Wallet, Award, Bell, GraduationCap, Lock } from "lucide-react";
import LmsAlert from "../LmsAlert/LmsAlert";
import "./Overview.css";

export default function Overview({ student, onNavigate, onChangePassword, lmsAlert = null }) {
  // Enrolment defaults to 1st Year everywhere else in the app, so a missing
  // value is shown the same way here rather than as a dash.
  const classYear = student?.year_of_study || "1st Year";

  const stats = [
    { label: "Program", value: student?.program || "—", icon: Award, cls: "stat--purple" },
    { label: "Class", value: classYear, icon: GraduationCap, cls: "stat--rose" },
    { label: "Roll Number", value: student?.roll_no || "—", icon: Clock, cls: "stat--amber" },
    { label: "Phone", value: student?.phone || "—", icon: Wallet, cls: "stat--blue" },
    // The only card that goes anywhere — it opens the Attendance tab.
    { label: "Attendance", value: "View →", icon: CalendarCheck, cls: "stat--green", goTo: "attendance" },
  ];

  return (
    <div className="overview">
      {/* Above the welcome card on purpose: it is the one thing here that is new
          since she last signed in, and everything below it will still be true
          tomorrow. */}
      {lmsAlert && (
        <LmsAlert items={lmsAlert.items} onOpen={lmsAlert.onOpen} onDismiss={lmsAlert.onDismiss} />
      )}

      <div className="overview__welcome">
        <div className="overview__welcome-content">
          <div>
            <p>Welcome back,</p>
            <h2>{student?.name || "Student"}</h2>
            <p className="overview__meta">{student?.program} • {classYear} • Roll No: {student?.roll_no}</p>
          </div>
          <div className="overview__actions">
            {onChangePassword && (
              <button type="button" className="overview__change-pass" onClick={onChangePassword}>
                <Lock size={14} /> Change Password
              </button>
            )}
            {student?.profile_picture_url && (
              <img src={student.profile_picture_url} alt={student.name} className="overview__profile-pic" loading="lazy" decoding="async" />
            )}
          </div>
        </div>
      </div>

      <div className="overview__stats">
        {stats.map((s) => {
          const body = (
            <>
              <div className={`overview__stat-icon ${s.cls}`}><s.icon size={18} /></div>
              <p className="overview__stat-value">{s.value}</p>
              <p className="overview__stat-label">{s.label}</p>
            </>
          );
          // A real <button> for the one that navigates, so it is reachable by
          // keyboard and reads as clickable to a screen reader.
          return s.goTo ? (
            <button
              key={s.label}
              type="button"
              className="overview__stat-card overview__stat-card--link"
              onClick={() => onNavigate && onNavigate(s.goTo)}
            >
              {body}
            </button>
          ) : (
            <div key={s.label} className="overview__stat-card">{body}</div>
          );
        })}
      </div>

      <div className="overview__card">
        <h3><Bell size={14} /> Important</h3>
        {/* The nav is a left sidebar on desktop but a fixed bar along the bottom
            below 1024px, so the wording swaps at exactly that breakpoint —
            "sidebar" would point at nothing on a phone. */}
        <p className="overview__muted">
          Use the{" "}
          <span className="overview__nav-hint overview__nav-hint--wide">sidebar on the left</span>
          <span className="overview__nav-hint overview__nav-hint--narrow">menu at the bottom of the screen</span>
          {" "}to check your Attendance, Class Tests, Assignments, Results and Fee status.
        </p>
      </div>
    </div>
  );
}