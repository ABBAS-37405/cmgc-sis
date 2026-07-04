import { supabase } from "../../lib/supabaseClient";
import { useState } from "react";
import LoginPage from "../Login/LoginPage";
import Sidebar from "../Sidebar/Sidebar";
import Overview from "../Overview/Overview";
import Attendance from "../Attendance/Attendance";
import Results from "../Results/Results";
import Fee from "../Fee/Fee";
import AdminPortal from "../AdminPortal/AdminPortal";
import "./Portal.css";

export default function Portal({ onExit }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [role, setRole] = useState("student");

  const student = {
    name: "Ayesha Khan",
    roll: "CMGC-2026-045",
    program: "FSc Pre-Medical",
    attendance: 92,
    nextExam: "July 2",
    feeStatus: "Unpaid",
    gpa: "3.7",
  };

  const handleLogin = (r) => { setRole(r); setLoggedIn(true); };
const handleLogout = async () => {
  await supabase.auth.signOut();
  setLoggedIn(false);
  setActiveTab("overview");
  onExit && onExit();
};

  if (!loggedIn) return <LoginPage onLogin={handleLogin} onBack={onExit} />;

  if (role === "admin") {
    return <AdminPortal onExit={handleLogout} />;
  }

  return (
    <div className="portal">
      <Sidebar active={activeTab} setActive={setActiveTab} onLogout={handleLogout} userLabel={`${student.name} (${role})`} />
      <main className="portal__main">
        {activeTab === "overview" && <Overview student={student} />}
        {activeTab === "attendance" && <Attendance />}
        {activeTab === "results" && <Results />}
        {activeTab === "fee" && <Fee />}
      </main>
    </div>
  );
}