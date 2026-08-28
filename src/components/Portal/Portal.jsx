import { useState, useEffect, useRef, lazy, Suspense } from "react";
import LoginPage from "../Login/LoginPage";
import Sidebar from "../Sidebar/Sidebar";
import Overview from "../Overview/Overview";
import StudentNotices from "../StudentNotices/StudentNotices";
import Attendance from "../Attendance/Attendance";
import Results from "../Results/Results";
import Fee from "../Fee/Fee";
import ClassTests from "../ClassTests/ClassTests";
import Assignments from "../Assignments/Assignments";
import MyForm from "../MyForm/MyForm";
import Lms from "../Lms/Lms";
import MyPerformance from "../Performance/MyPerformance";
import Reports from "../Reports/Reports";
import TabNav from "../TabNav/TabNav";
import { useLmsAlerts } from "../LmsAlert/useLmsAlerts";
import TestAlert from "../TestAlert/TestAlert";
import { useTestAlert } from "../TestAlert/useTestAlert";
// A student signing in should not be made to wait for the admin and teacher
// portals, which are far bigger than everything she can actually see.
const AdminPortal = lazy(() => import("../AdminPortal/AdminPortal"));
const TeacherPortal = lazy(() => import("../TeacherPortal/TeacherPortal"));
import { supabase, forgetAuthToken } from "../../lib/supabaseClient";
import { pushStep, useTabHistory } from "../../lib/backStack";
import { storedSession, rememberSession, rememberTab, clearSession } from "../../lib/session";
import { restoreSession } from "../../lib/sessionRestore";
import { preloadPortalFor } from "../../lib/preload";
import "./Portal.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * How long a sign-out may hang before the portal closes anyway.
 *
 * `supabase.auth.signOut()` is a network call with no timeout of its own, and
 * this project has already watched Supabase Auth take a request and never answer
 * it — the same failure the sign-in timeout in `LoginPage` exists for. Awaiting
 * it here is what made the Logout button do nothing at all: the state below it
 * never ran, so nothing on screen changed and the admin was left pressing a
 * button that looked broken.
 *
 * Short on purpose. Nothing the admin can see depends on the answer; the screen
 * is hers back either way, and the fallback below is what makes that honest.
 */
const SIGN_OUT_TIMEOUT_MS = 4000;
const TIMED_OUT = Symbol("sign-out-timeout");

/**
 * Ends the Supabase Auth session, and never keeps anybody waiting for it.
 *
 * A hung request and a failed one look identical from the portal, and in both
 * cases supabase-js has *not* removed the stored session — it does that only
 * after the server answers. A live refresh token left behind while our own
 * marker says the session is over is a logout in appearance only, which is the
 * one thing `session.js` and `supabaseClient.js` agree must not happen. So
 * whichever way it goes wrong, the token is dropped locally.
 *
 * Never throws, so the caller can fire it and move on.
 */
async function revokeAuthSession() {
  let timer;
  try {
    const result = await Promise.race([
      supabase.auth.signOut(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), SIGN_OUT_TIMEOUT_MS); }),
    ]);
    if (result !== TIMED_OUT && !result?.error) return;
  } catch {
    // A rejection here is the same story as an error in the result.
  } finally {
    clearTimeout(timer);
  }
  forgetAuthToken();
}

export default function Portal({ onExit }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [role, setRole] = useState("student");
  const [studentData, setStudentData] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);
  const [teacherData, setTeacherData] = useState(null);
  const loginStep = useRef(null);

  // True only while a remembered session is being turned back into a logged-in
  // portal. Seeded synchronously from storage so the login screen is never shown
  // for the moment the lookup takes — signing in again is exactly what she should
  // not have to do.
  const [restoring, setRestoring] = useState(() => Boolean(storedSession()));

  useEffect(() => {
    if (!restoring) return undefined;
    let dropped = false;

    /*
     * Her portal's code starts downloading now, next to the two round trips that
     * decide whether she may have it — not after them. The marker already says
     * which portal is coming, and against this project a session check plus a
     * profile read is ~400ms of nothing but waiting, which is long enough to fetch
     * the whole admin chunk in. If the restore then fails she lands on the login
     * page having downloaded something she does not use; that is the cheaper half
     * of the trade, and only for someone who was signed in on this browser before.
     */
    preloadPortalFor(storedSession()?.role);

    restoreSession().then((session) => {
      if (dropped) return;
      if (session) {
        setRole(session.role);
        if (session.role === "admin") setAdminProfile(session.data);
        else if (session.role === "teacher") setTeacherData(session.data);
        else setStudentData(session.data);
        // Only the student portal's tab is held here; the other two own theirs.
        if (session.role === "student" && session.tab) setActiveTab(session.tab);
        setLoggedIn(true);
      }
      // Whatever happened, stop waiting: a session that could not be restored
      // leaves her on the login page rather than on a spinner.
      setRestoring(false);
    });

    return () => { dropped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Her tab, so a refresh in Fee comes back to Fee. Written only while signed in,
  // so it can never resurrect a tab after a logout has cleared the session.
  useEffect(() => {
    if (loggedIn && role === "student") rememberTab(activeTab);
  }, [loggedIn, role, activeTab]);

  // Back moves between tabs a screen at a time, in the order she visited them.
  const goToTab = useTabHistory(activeTab, setActiveTab);

  /*
   * What her teachers have put up since she last looked.
   *
   * Owned here rather than inside Overview because two things show it — the
   * notice on her first screen and the count on the LMS nav item — and they must
   * never disagree. It costs one query, and only for a student: the hook does
   * nothing without an id, so an admin or a teacher signing in never runs it.
   */
  const lmsAlerts = useLmsAlerts(role === "student" && loggedIn ? studentData : null);
  // Destructured so the effect below depends on a number and a stable callback.
  // The hook returns a fresh object each render, so depending on `lmsAlerts`
  // itself would re-run it every time anything in the portal re-rendered.
  const { count: newLmsCount, seen: markLmsSeen } = lmsAlerts;

  // Opening the tab is what marks them read: there is nothing to dismiss once
  // she is looking at the material itself.
  useEffect(() => {
    if (activeTab === "lms" && newLmsCount > 0) markLmsSeen();
  }, [activeTab, newLmsCount, markLmsSeen]);

  /*
   * The next weekly test, decided for her own class only.
   *
   * A null viewer key while an admin or a teacher is signed in is what keeps
   * this hook idle for them — the schedule is not even fetched: their own
   * portals raise their own box, for both classes rather than one.
   */
  const testAlert = useTestAlert({
    viewerKey: role === "student" && loggedIn ? studentData?.id : null,
    year: studentData?.year_of_study,
  });

  /**
   * Signing in is one screen deep, so Back from the portal's first tab lands on
   * the login page — not straight out to the website.
   *
   * `r` is passed rather than read from state: this runs from a closure created
   * during the same handler that set `role`, where the state variable is still
   * the old one.
   */
  const signOutToLogin = (r) => {
    // Admins and teachers are both real Supabase Auth sessions; students are not.
    // Deliberately not awaited: telling the server is slow and can hang, and the
    // screen must never wait on it — see `revokeAuthSession` above.
    if (r === "admin" || r === "teacher") revokeAuthSession();
    // Signing out is the one thing that must outlive the page, or a reload would
    // put back the session she just left.
    clearSession();
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
        throw new Error(text || "Failed to change password.", { cause: parseError });
      }

      if (!response.ok) throw new Error(result?.error || "Failed to change password.");
      setStudentData((prev) => prev ? ({ ...prev, password }) : prev);
      alert("Your password has been updated successfully.");
    } catch (err) {
      alert("Could not change password: " + err.message);
    }
  };

  const handleLogin = (r, id, data) => {
    // Written before anything renders, so a reload one second later finds it.
    rememberSession(r, data);
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
  const handleLogout = () => {
    signOutToLogin(role);
    loginStep.current = null;
    onExit && onExit();
  };

  if (restoring) return <div className="app-loading">Signing you back in…</div>;
  // onRoleHint: picking "Admin" or "Teacher" is the earliest honest signal of which
  // portal is coming, and it arrives a form-filling ahead of the sign-in request.
  if (!loggedIn) return <LoginPage onLogin={handleLogin} onBack={onExit} onRoleHint={preloadPortalFor} />;
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
      {/* Her own class's paper, worked out from her group and the combination she
          picked at admission — the sheet's "MATHS/BIO/CVS" is not an answer. */}
      {testAlert.open && (
        <TestAlert
          test={testAlert.test}
          total={testAlert.total}
          year={studentData?.year_of_study}
          student={{ group: studentData?.program, combination: studentData?.subject_combination }}
          onClose={testAlert.close}
          onOpenSchedule={() => { testAlert.close(); goToTab("notices"); }}
        />
      )}
      <Sidebar
        active={activeTab}
        setActive={goToTab}
        onLogout={handleLogout}
        userLabel={`${studentData?.name || "Student"} (${role})`}
        badges={lmsAlerts.count > 0 ? { lms: lmsAlerts.count } : null}
      />
      <main className="portal__main">
        {activeTab === "overview" && (
          <Overview
            student={studentData}
            onNavigate={goToTab}
            onChangePassword={changeStudentPassword}
            lmsAlert={lmsAlerts.showBanner
              ? { items: lmsAlerts.items, onOpen: () => goToTab("lms"), onDismiss: lmsAlerts.dismiss }
              : null}
          />
        )}
        {activeTab === "notices" && <StudentNotices />}
        {activeTab === "attendance" && <Attendance studentId={studentData?.id} />}
        {activeTab === "classtests" && <ClassTests studentId={studentData?.id} />}
        {activeTab === "assignments" && <Assignments student={studentData} />}
        {activeTab === "lms" && <Lms student={studentData} />}
        {activeTab === "results" && <Results studentId={studentData?.id} />}
        {activeTab === "fee" && <Fee studentId={studentData?.id} />}
        {activeTab === "performance" && <MyPerformance student={studentData} />}
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