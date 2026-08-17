import { useState, useMemo, useEffect } from "react";
import AdminSidebar from "../AdminSidebar/AdminSidebar";
import AdminOverview from "../AdminOverview/AdminOverview";
import StudentsList from "../StudentsList/StudentsList";
import StudentProgress from "../StudentProgress/StudentProgress";
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
import { canSeeAdminTab } from "../../lib/adminNav";
import { storedSession, rememberTab } from "../../lib/session";
import "./AdminPortal.css";

export default function AdminPortal({ adminProfile, onExit }) {
  // The tab she was on before the page reloaded, but only if she may still see it:
  // a permission withdrawn in the meantime would otherwise restore her to a blank
  // main area, since every branch below is guarded by that same permission.
  const [active, setActive] = useState(() => {
    const tab = storedSession()?.tab;
    return tab && canSeeAdminTab(adminProfile, tab) ? tab : "overview";
  });

  useEffect(() => { rememberTab(active); }, [active]);

  /*
   * Memoised, because `allowedProgramsFor` builds a new array every time and this
   * one is passed to nearly every tab. App re-renders whenever the page crosses a
   * scroll threshold (it tracks scrollY for the landing page, and that effect sits
   * above the early return that swaps in the portal), so an unmemoised array meant
   * a fresh identity mid-scroll — and any child that keyed a fetch on it reloaded
   * itself while the admin was reading. That is exactly what made Student Report
   * flicker: the list blanked, the page height collapsed, the scroll bounced to
   * the top and crossed the threshold again.
   */
  const allowedPrograms = useMemo(() => allowedProgramsFor(adminProfile), [adminProfile]);
  // Back walks the tabs she has actually visited, newest first.
  const goToTab = useTabHistory(active, setActive);

  return (
    <div className="admin-portal">
      <AdminSidebar active={active} setActive={goToTab} onLogout={onExit} adminProfile={adminProfile} />
      <main className="admin-portal__main">
        {active === "overview" && <AdminOverview />}
        {active === "students" && hasPermission(adminProfile, "students") && <StudentsList allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {/* Read-only: one student's attendance, tests, exams, assignments and fee
            in one place. adminProfile is passed rather than a list of flags,
            because the screen hides the two sections RLS would answer with
            silence (attendance and results) instead of showing them as zero. */}
        {active === "progress" && hasPermission(adminProfile, "students") && <StudentProgress allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {active === "attendance" && hasPermission(adminProfile, "attendance") && <MarkAttendance allowedPrograms={allowedPrograms} />}
        {active === "results" && hasPermission(adminProfile, "results") && <EnterResults allowedPrograms={allowedPrograms} />}
        {active === "fee" && hasPermission(adminProfile, "fee") && <FeeVerification />}
        {/* Unscoped by allowedPrograms on purpose: `notices` has no audience
            column — a notice goes to the whole college, the public board and
            every student's Notices tab alike. */}
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