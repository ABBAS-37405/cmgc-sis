import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import AdminSidebar from "../AdminSidebar/AdminSidebar";
import AdminOverview from "../AdminOverview/AdminOverview";
/*
 * Every tab but the first is fetched when it is opened.
 *
 * Statically imported, all twelve of them were one 258 kB chunk with 89 kB of
 * CSS behind it, and an admin signing in to record a fee waited for the payroll
 * screens, the report generator, the storage sweeper and the charts before her
 * first screen appeared. Now the portal opens with the Overview and each tab
 * arrives on the click that asks for it — or a moment earlier, on the hover:
 * `ADMIN_TAB_LOADERS` is what the sidebar warms, the same trick `preload.js`
 * plays with the portals themselves.
 *
 * `lazy()` and the preloader must share one loader per screen. Two `import()`
 * calls with the same specifier resolve to the same module, but writing the
 * specifier twice is how they drift.
 */
const ADMIN_TAB_LOADERS = {
  students: () => import("../StudentsList/StudentsList"),
  progress: () => import("../StudentProgress/StudentProgress"),
  attendance: () => import("../MarkAttendance/MarkAttendance"),
  results: () => import("../EnterResults/EnterResults"),
  fee: () => import("../FeeVerification/FeeVerification"),
  notices: () => import("../Notices/Notices"),
  lms: () => import("../LmsManage/LmsManage"),
  teachers: () => import("../Teachers/Teachers"),
  reports: () => import("../MonthlyReports/MonthlyReports"),
  storage: () => import("../StorageCleanup/StorageCleanup"),
  admins: () => import("../ManageAdmins/ManageAdmins"),
};

/** Warms one tab's code. Failures are swallowed: this is only a head start. */
const preloadAdminTab = (id) => { ADMIN_TAB_LOADERS[id]?.().catch(() => {}); };

const StudentsList = lazy(ADMIN_TAB_LOADERS.students);
const StudentProgress = lazy(ADMIN_TAB_LOADERS.progress);
const MarkAttendance = lazy(ADMIN_TAB_LOADERS.attendance);
const EnterResults = lazy(ADMIN_TAB_LOADERS.results);
const FeeVerification = lazy(ADMIN_TAB_LOADERS.fee);
const Notices = lazy(ADMIN_TAB_LOADERS.notices);
const LmsManage = lazy(ADMIN_TAB_LOADERS.lms);
const Teachers = lazy(ADMIN_TAB_LOADERS.teachers);
const MonthlyReports = lazy(ADMIN_TAB_LOADERS.reports);
const ManageAdmins = lazy(ADMIN_TAB_LOADERS.admins);
const StorageCleanup = lazy(ADMIN_TAB_LOADERS.storage);
import { fetchUsage, runSafeSweep } from "../../lib/storageSweep";
import { needsSweep, percentFull } from "../../lib/storageCleanup";
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

  /*
   * Storage housekeeping, without anyone having to remember to do it.
   *
   * One RPC when the portal opens. Below the threshold that is the end of it;
   * above it, the safe sweep runs on its own — files whose LMS material was
   * already removed, documents of rejected applications, orphaned profile
   * pictures — none of which is visible to anybody, so none of it needs asking.
   *
   * If it is still full afterwards, the only thing left is a teacher's live
   * material, and that is never taken automatically. The strip below is how she
   * finds out, since otherwise the first sign would be an upload failing in the
   * middle of an admission.
   */
  const [storageFull, setStorageFull] = useState(null);

  useEffect(() => {
    if (!adminProfile?.is_super_admin) return;
    let live = true;

    (async () => {
      const first = await fetchUsage();
      // A missing function (the SQL not pasted yet) or a refused read must not
      // put a warning on screen — it says nothing about how full storage is.
      if (!live || first.error || !needsSweep(first.bytes)) return;

      const report = await runSafeSweep();
      if (!live) return;
      setStorageFull(needsSweep(report.after) ? report.after : null);
    })();

    return () => { live = false; };
  }, [adminProfile]);

  return (
    <div className="admin-portal">
      <AdminSidebar
        active={active}
        setActive={goToTab}
        onLogout={onExit}
        adminProfile={adminProfile}
        onItemHover={preloadAdminTab}
      />
      <main className="admin-portal__main">
        {/* Inside main, not beside it: .admin-portal is a flex row, so a sibling
            here would sit next to the sidebar as a third column. */}
        {storageFull !== null && active !== "storage" && (
          <button type="button" className="admin-portal__storage-warn" onClick={() => goToTab("storage")}>
            Storage is {percentFull(storageFull)}% full and the automatic cleanup has freed all it safely can.
            Open <strong>Storage</strong> to free more.
          </button>
        )}
        {/* One boundary around every tab rather than one each: only ever one is
            on screen, and a fallback per branch would be eleven copies of the
            same sentence. Overview is inside it too but is not lazy, so it
            never shows the fallback. */}
        <Suspense fallback={<div className="admin-portal__loading">Loading…</div>}>
        {active === "overview" && <AdminOverview />}
        {active === "students" && hasPermission(adminProfile, "students") && <StudentsList allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {/* Read-only: one student's attendance, tests, exams, assignments and fee
            in one place. adminProfile is passed rather than a list of flags,
            because the screen hides the two sections RLS would answer with
            silence (attendance and results) instead of showing them as zero. */}
        {active === "progress" && hasPermission(adminProfile, "students") && <StudentProgress allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {/* adminProfile is what puts "out of the register" and the Out of Attendance
            tab on screen — super admin only. The teacher portal passes none, so its
            copy of this screen is the register and nothing else. */}
        {active === "attendance" && hasPermission(adminProfile, "attendance") && <MarkAttendance allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {active === "results" && hasPermission(adminProfile, "results") && <EnterResults allowedPrograms={allowedPrograms} />}
        {active === "fee" && hasPermission(adminProfile, "fee") && <FeeVerification />}
        {/* Unscoped by allowedPrograms on purpose: `notices` has no audience
            column — a notice goes to the whole college, the public board and
            every student's Notices tab alike. */}
        {active === "notices" && hasPermission(adminProfile, "notices") && <Notices />}
        {/* teacher={null} puts it in full-range mode: every subject the allowed
            groups offer, rather than one teacher's own list. */}
        {active === "lms" && hasPermission(adminProfile, "lms") && <LmsManage teacher={null} allowedPrograms={allowedPrograms} />}
        {active === "teachers" && hasPermission(adminProfile, "teachers") && <Teachers allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {active === "reports" && hasPermission(adminProfile, "reports") && <MonthlyReports allowedPrograms={allowedPrograms} adminProfile={adminProfile} />}
        {active === "storage" && adminProfile?.is_super_admin && <StorageCleanup />}
        {active === "admins" && adminProfile?.is_super_admin && <ManageAdmins adminProfile={adminProfile} />}
        </Suspense>
      </main>
    </div>
  );
}