import { useState, lazy, Suspense } from "react";
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
import TabNav from "../TabNav/TabNav";
// A student signing in should not be made to wait for the admin and teacher
// portals, which are far bigger than everything she can actually see.
const AdminPortal = lazy(() => import("../AdminPortal/AdminPortal"));
const TeacherPortal = lazy(() => import("../TeacherPortal/TeacherPortal"));
import { supabase } from "../../lib/supabaseClient";
import "./Portal.css";

export default function Portal({ onExit }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [role, setRole] = useState("student");
  const [studentData, setStudentData] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);
  const [teacherData, setTeacherData] = useState(null);

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
  };

  const handleLogout = async () => {
    // Admins and teachers are both real Supabase Auth sessions; students are not.
    if (role === "admin" || role === "teacher") await supabase.auth.signOut();
    setLoggedIn(false);
    setActiveTab("overview");
    setStudentData(null);
    setAdminProfile(null);
    setTeacherData(null);
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
        setActive={setActiveTab}
        onLogout={handleLogout}
        userLabel={`${studentData?.name || "Student"} (${role})`}
      />
      <main className="portal__main">
        {activeTab === "overview" && <Overview student={studentData} onNavigate={setActiveTab} />}
        {activeTab === "attendance" && <Attendance studentId={studentData?.id} />}
        {activeTab === "classtests" && <ClassTests studentId={studentData?.id} />}
        {activeTab === "assignments" && <Assignments student={studentData} />}
        {activeTab === "lms" && <Lms student={studentData} />}
        {activeTab === "results" && <Results studentId={studentData?.id} />}
        {activeTab === "fee" && <Fee studentId={studentData?.id} />}
        {activeTab === "myform" && <MyForm student={studentData} />}

        {/* Rendered here rather than inside each tab, so every screen gets the
            chain from one place. Overview is skipped because its Attendance
            card already carries her to the next screen. */}
        {activeTab !== "overview" && <TabNav current={activeTab} setActive={setActiveTab} />}
      </main>
    </div>
  );
}