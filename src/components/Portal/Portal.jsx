import { useState, useRef, lazy, Suspense } from "react";
import LoginPage from "../Login/LoginPage";
import Sidebar from "../Sidebar/Sidebar";
import Overview from "../Overview/Overview";
import Attendance from "../Attendance/Attendance";
import Results from "../Results/Results";
import Fee from "../Fee/Fee";
import ClassTests from "../ClassTests/ClassTests";
import Assignments from "../Assignments/Assignments";
import MyForm from "../MyForm/MyForm";
import Lms from "../Lms/Lms";
import Reports from "../Reports/Reports";
import TabNav from "../TabNav/TabNav";
// A student signing in should not be made to wait for the admin and teacher
// portals, which are far bigger than everything she can actually see.
const AdminPortal = lazy(() => import("../AdminPortal/AdminPortal"));
const TeacherPortal = lazy(() => import("../TeacherPortal/TeacherPortal"));
import { supabase } from "../../lib/supabaseClient";
import { pushStep, useTabHistory } from "../../lib/backStack";
import "./Portal.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function Portal({ onExit }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [role, setRole] = useState("student");
  const [studentData, setStudentData] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);
  const [teacherData, setTeacherData] = useState(null);
  const loginStep = useRef(null);

  // Back moves between tabs a screen at a time, in the order she visited them.
  const goToTab = useTabHistory(activeTab, setActiveTab);

  /**
   * Signing in is one screen deep, so Back from the portal's first tab lands on
   * the login page — not straight out to the website.
   *
   * `r` is passed rather than read from state: this runs from a closure created
   * during the same handler that set `role`, where the state variable is still
   * the old one.
   */
  const signOutToLogin = async (r) => {
    // Admins and teachers are both real Supabase Auth sessions; students are not.
    if (r === "admin" || r === "teacher") await supabase.auth.signOut();
    setLoggedIn(false);
    setActiveTab("overview");
    setStudentData(null);
    setAdminProfile(null);
    setTeacherData(null);
  };

  const changeStudentPassword = async () => {
    if (!studentData?.id) return;

    const current = window.prompt("Enter your current password:", "");
    if (current === null) return;
    const currentPassword = current.trim();
    if (currentPassword.length === 0) {
      alert("Current password is required.");
      return;
    }

    const next = window.prompt("Enter your new password (minimum 6 characters):", "");
    if (next === null) return;
    const password = next.trim();
    if (password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/student/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: studentData.id,
          rollNo: studentData.roll_no,
          currentPassword,
          password,
        }),
      });
      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        const text = await response.text();
        throw new Error(text || "Failed to change password.");
      }

      if (!response.ok) throw new Error(result?.error || "Failed to change password.");
      setStudentData((prev) => prev ? ({ ...prev, password }) : prev);
      alert("Your password has been updated successfully.");
    } catch (err) {
      alert("Could not change password: " + err.message);
    }
  };

  const handleLogin = (r, id, data) => {
    setRole(r);
    if (r === "admin") {
      setAdminProfile(data);
    } else if (r === "teacher") {
      setTeacherData(data);
    } else {
      setStudentData(data);
    }
    setLoggedIn(true);

    // Asked rather than done, because a stray back press here costs an admin her
    // session in the middle of a piece of work.
    loginStep.current = pushStep({
      undo: () => signOutToLogin(r),
      confirm: {
        signOut: true,
        title: "Sign out of the portal?",
        body: "Going back from here closes your portal session and returns you to the login screen.",
        confirmLabel: "Yes, sign out",
        cancelLabel: "Stay signed in",
      },
    });
  };

  /**
   * The Logout button, which goes further than Back does: out of the portal and
   * back to the website. `onExit` truncates the whole stack from the portal
   * down, so the tab steps and the login step above it go with it.
   */
  const handleLogout = async () => {
    await signOutToLogin(role);
    loginStep.current = null;
    onExit && onExit();
  };

  if (!loggedIn) return <LoginPage onLogin={handleLogin} onBack={onExit} />;
  if (role === "admin") {
    return (
      <Suspense fallback={<div className="app-loading">Loading admin portal…</div>}>
        <AdminPortal adminProfile={adminProfile} onExit={handleLogout} />
      </Suspense>
    );
  }
  if (role === "teacher") {
    return (
      <Suspense fallback={<div className="app-loading">Loading teacher portal…</div>}>
        <TeacherPortal teacher={teacherData} onLogout={handleLogout} />
      </Suspense>
    );
  }

  return (
    <div className="portal">
      <Sidebar
        active={activeTab}
        setActive={goToTab}
        onLogout={handleLogout}
        userLabel={`${studentData?.name || "Student"} (${role})`}
      />
      <main className="portal__main">
        {activeTab === "overview" && <Overview student={studentData} onNavigate={goToTab} onChangePassword={changeStudentPassword} />}
        {activeTab === "attendance" && <Attendance studentId={studentData?.id} />}
        {activeTab === "classtests" && <ClassTests studentId={studentData?.id} />}
        {activeTab === "assignments" && <Assignments student={studentData} />}
        {activeTab === "lms" && <Lms student={studentData} />}
        {activeTab === "results" && <Results studentId={studentData?.id} />}
        {activeTab === "fee" && <Fee studentId={studentData?.id} />}
        {activeTab === "reports" && <Reports student={studentData} />}
        {activeTab === "myform" && <MyForm student={studentData} />}

        {/* Rendered here rather than inside each tab, so every screen gets the
            chain from one place. Overview is skipped because its Attendance
            card already carries her to the next screen. */}
        {activeTab !== "overview" && <TabNav current={activeTab} setActive={goToTab} />}
      </main>
    </div>
  );
}