import { useState } from "react";
import AdminSidebar from "../AdminSidebar/AdminSidebar";
import AdminOverview from "../AdminOverview/AdminOverview";
import StudentsList from "../StudentsList/StudentsList";
import MarkAttendance from "../MarkAttendance/MarkAttendance";
import EnterResults from "../EnterResults/EnterResults";
import FeeVerification from "../FeeVerification/FeeVerification";
import Notices from "../Notices/Notices";
import LmsManage from "../LmsManage/LmsManage";
import Teachers from "../Teachers/Teachers";
import MonthlyReports from "../MonthlyReports/MonthlyReports";
import ManageAdmins from "../ManageAdmins/ManageAdmins";
import { hasPermission, allowedProgramsFor } from "../../lib/adminAuth";
import { useTabHistory } from "../../lib/backStack";
import "./AdminPortal.css";

export default function AdminPortal({ adminProfile, onExit }) {
  const [active, setActive] = useState("overview");
  const allowedPrograms = allowedProgramsFor(adminProfile);
  // Back walks the tabs she has actually visited, newest first.
  const goToTab = useTabHistory(active, setActive);

  return (
    <div className="admin-portal">
      <AdminSidebar active={active} setActive={goToTab} onLogout={onExit} adminProfile={adminProfile} />
      <main className="admin-portal__main">
        {active === "overview" && <AdminOverview />}
        {active === "students" && hasPermission(adminProfile, "students") && <StudentsList allowedPrograms={allowedPrograms} />}
        {active === "attendance" && hasPermission(adminProfile, "attendance") && <MarkAttendance allowedPrograms={allowedPrograms} />}
        {active === "results" && hasPermission(adminProfile, "results") && <EnterResults allowedPrograms={allowedPrograms} />}
        {active === "fee" && hasPermission(adminProfile, "fee") && <FeeVerification />}
        {active === "notices" && hasPermission(adminProfile, "notices") && <Notices />}
        {/* teacher={null} puts it in full-range mode: every subject the allowed
            groups offer, rather than one teacher's own list. */}
        {active === "lms" && hasPermission(adminProfile, "lms") && <LmsManage teacher={null} allowedPrograms={allowedPrograms} />}
        {active === "teachers" && hasPermission(adminProfile, "teachers") && <Teachers allowedPrograms={allowedPrograms} />}
        {active === "reports" && hasPermission(adminProfile, "reports") && <MonthlyReports allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {active === "admins" && adminProfile?.is_super_admin && <ManageAdmins adminProfile={adminProfile} />}
      </main>
    </div>
  );
}