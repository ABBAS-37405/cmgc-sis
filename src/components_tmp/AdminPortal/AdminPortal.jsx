import { useState } from "react";
import { AlertCircle } from "lucide-react";
import AdminSidebar from "../AdminSidebar/AdminSidebar";
import AdminOverview from "../AdminOverview/AdminOverview";
import StudentsList from "../StudentsList/StudentsList";
import MarkAttendance from "../MarkAttendance/MarkAttendance";
import EnterResults from "../EnterResults/EnterResults";
import FeeVerification from "../FeeVerification/FeeVerification";
import Notices from "../Notices/Notices";
import "./AdminPortal.css";

export default function AdminPortal({ onExit }) {
  const [active, setActive] = useState("overview");

  return (
    <div className="admin-portal">
      <AdminSidebar active={active} setActive={setActive} onLogout={onExit} />
      <main className="admin-portal__main">
        <div className="admin-portal__notice">
          <AlertCircle size={14} /> This is a preview with sample data — nothing here is saved permanently yet.
        </div>
        {active === "overview" && <AdminOverview />}
        {active === "students" && <StudentsList />}
        {active === "attendance" && <MarkAttendance />}
        {active === "results" && <EnterResults />}
        {active === "fee" && <FeeVerification />}
        {active === "notices" && <Notices />}
      </main>
    </div>
  );
}