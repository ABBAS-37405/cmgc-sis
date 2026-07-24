import { useState } from "react";
import { AlertCircle } from "lucide-react";
import AdminSidebar from "../AdminSidebar/AdminSidebar";
import AdminOverview from "../AdminOverview/AdminOverview";
import StudentsList from "../StudentsList/StudentsList";
import MarkAttendance from "../MarkAttendance/MarkAttendance";
import EnterResults from "../EnterResults/EnterResults";
import FeeVerification from "../FeeVerification/FeeVerification";
import Notices from "../Notices/Notices";
import ManageAdmins from "../ManageAdmins/ManageAdmins";
import { hasPermission, allowedProgramsFor } from "../../lib/adminAuth";
import "./AdminPortal.css";

export default function AdminPortal({ adminProfile, onExit }) {
  const [active, setActive] = useState("overview");
  const allowedPrograms = allowedProgramsFor(adminProfile);

  return (
    <div className="admin-portal">
      <AdminSidebar active={active} setActive={setActive} onLogout={onExit} adminProfile={adminProfile} />
      <main className="admin-portal__main">
        <div className="admin-portal__notice">
          <AlertCircle size={14} /> This is a preview with sample data — nothing here is saved permanently yet.
        </div>
        {active === "overview" && <AdminOverview />}
        {active === "students" && hasPermission(adminProfile, "students") && <StudentsList allowedPrograms={allowedPrograms} />}
        {active === "attendance" && hasPermission(adminProfile, "attendance") && <MarkAttendance allowedPrograms={allowedPrograms} />}
        {active === "results" && hasPermission(adminProfile, "results") && <EnterResults allowedPrograms={allowedPrograms} />}
        {active === "fee" && hasPermission(adminProfile, "fee") && <FeeVerification />}
        {active === "notices" && hasPermission(adminProfile, "notices") && <Notices />}
        {active === "admins" && adminProfile?.is_super_admin && <ManageAdmins adminProfile={adminProfile} />}
      </main>
    </div>
  );
}