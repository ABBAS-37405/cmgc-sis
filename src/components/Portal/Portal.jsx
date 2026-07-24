import { useState } from "react";
import LoginPage from "../Login/LoginPage";
import Sidebar from "../Sidebar/Sidebar";
import Overview from "../Overview/Overview";
import Attendance from "../Attendance/Attendance";
import Results from "../Results/Results";
import Fee from "../Fee/Fee";
import AdminPortal from "../AdminPortal/AdminPortal";
import { supabase } from "../../lib/supabaseClient";
import "./Portal.css";

export default function Portal({ onExit }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [role, setRole] = useState("student");
  const [studentData, setStudentData] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);

  const handleLogin = (r, id, data) => {
    setRole(r);
    if (r === "admin") {
      setAdminProfile(data);
    } else {
      setStudentData(data);
    }
    setLoggedIn(true);
  };

  const handleLogout = async () => {
    if (role === "admin") await supabase.auth.signOut();
    setLoggedIn(false);
    setActiveTab("overview");
    setStudentData(null);
    setAdminProfile(null);
    onExit && onExit();
  };

  if (!loggedIn) return <LoginPage onLogin={handleLogin} onBack={onExit} />;
  if (role === "admin") return <AdminPortal adminProfile={adminProfile} onExit={handleLogout} />;

  return (
    <div className="portal">
      <Sidebar
        active={activeTab}
        setActive={setActiveTab}
        onLogout={handleLogout}
        userLabel={`${studentData?.name || "Student"} (${role})`}
      />
      <main className="portal__main">
        {activeTab === "overview" && <Overview student={studentData} />}
        {activeTab === "attendance" && <Attendance studentId={studentData?.id} />}
        {activeTab === "results" && <Results studentId={studentData?.id} />}
        {activeTab === "fee" && <Fee studentId={studentData?.id} />}
      </main>
    </div>
  );
}