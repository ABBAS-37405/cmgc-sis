import { useState } from "react";
import ReportsPane from "./ReportsPane";
import TestReports from "./TestReports";
import Accounts from "./Accounts";
import { hasPermission } from "../../lib/adminAuth";
import "./MonthlyReports.css";

/**
 * The Reports tab: three screens over the same student data, and one over the
 * college's money.
 *
 *   Monthly    per girl, per month — attendance, class tests, assignments, fee
 *   Exam       per girl, for one term exam — its marksheet, plus the same context
 *   Test       per class, for one class test — a result sheet and slips
 *   Accounts   the college itself — fee income against salaries and expenses
 *
 * Monthly and Exam are the same screen (`ReportsPane`) with a different `mode`;
 * they differ only in whether an examination is part of the report. Test Reports
 * is genuinely different — it runs across a class rather than down a student —
 * so it is its own component. Accounts is different again: it is the only screen
 * in Reports that is not about a student at all.
 */
const TABS = [
  { id: "monthly", label: "Monthly Reports", sub: "One PDF per student for a month — attendance, class tests, assignments and fee position. Send it on WhatsApp, or download the whole class at once." },
  { id: "exam", label: "Exam Reports", sub: "One PDF per student for a term exam — its marksheet, with the same attendance, assignments and fee context. Same sending and downloads as monthly." },
  { id: "tests", label: "Test Reports", sub: "One class test at a time: the result sheet for the notice board, and a page per student to send home." },
  { id: "accounts", label: "Accounts", sub: "Fee income against salaries and running costs — net profit or loss for each month and for the whole year. Record bills, rent and other expenses here.", needs: "teachers" },
];

export default function MonthlyReports({ allowedPrograms = [], adminProfile }) {
  const [tab, setTab] = useState("monthly");

  /*
   * Accounts is offered only to an admin who also holds `teachers`, and that is
   * a correctness gate rather than a policy preference. Most of the expense side
   * is payroll, `staff_salaries` is gated on exactly that permission, and RLS
   * refuses a read silently — so an admin without it would be shown the whole
   * fee income against an empty wage bill and told the college is in profit.
   * The same gate gets a matching `expenses` policy in supabase_expenses.sql.
   */
  const visibleTabs = TABS.filter((t) => !t.needs || hasPermission(adminProfile, t.needs));
  const active = visibleTabs.find((t) => t.id === tab) || visibleTabs[0];

  return (
    <div className="mrep">
      <div className="mrep__head">
        <div>
          <h2 className="mrep__title">Reports</h2>
          <p className="mrep__sub">{active.sub}</p>
        </div>
      </div>

      <div className="mrep__tabs" role="tablist">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active.id === t.id}
            onClick={() => setTab(t.id)}
            className={`mrep__tab ${active.id === t.id ? "mrep__tab--active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Keyed so switching tabs starts the pane clean rather than carrying the
          other mode's filters, exam selection and half-finished WhatsApp queue. */}
      {active.id === "tests" ? (
        <TestReports allowedPrograms={allowedPrograms} />
      ) : active.id === "accounts" ? (
        <Accounts adminProfile={adminProfile} />
      ) : (
        <ReportsPane
          key={active.id}
          mode={active.id}
          allowedPrograms={allowedPrograms}
          adminProfile={adminProfile}
        />
      )}
    </div>
  );
}
