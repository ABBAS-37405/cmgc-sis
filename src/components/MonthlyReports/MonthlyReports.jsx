import { useState } from "react";
import ReportsPane from "./ReportsPane";
import TestReports from "./TestReports";
import "./MonthlyReports.css";

/**
 * The Reports tab: three screens over the same student data.
 *
 *   Monthly    per girl, per month — attendance, class tests, assignments, fee
 *   Exam       per girl, for one term exam — its marksheet, plus the same context
 *   Test       per class, for one class test — a result sheet and slips
 *
 * Monthly and Exam are the same screen (`ReportsPane`) with a different `mode`;
 * they differ only in whether an examination is part of the report. Test Reports
 * is genuinely different — it runs across a class rather than down a student —
 * so it is its own component.
 */
const TABS = [
  { id: "monthly", label: "Monthly Reports", sub: "One PDF per student for a month — attendance, class tests, assignments and fee position. Send it on WhatsApp, or download the whole class at once." },
  { id: "exam", label: "Exam Reports", sub: "One PDF per student for a term exam — its marksheet, with the same attendance, assignments and fee context. Same sending and downloads as monthly." },
  { id: "tests", label: "Test Reports", sub: "One class test at a time: the result sheet for the notice board, and a page per student to send home." },
];

export default function MonthlyReports({ allowedPrograms = [], adminProfile }) {
  const [tab, setTab] = useState("monthly");
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="mrep">
      <div className="mrep__head">
        <div>
          <h2 className="mrep__title">Reports</h2>
          <p className="mrep__sub">{active.sub}</p>
        </div>
      </div>

      <div className="mrep__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`mrep__tab ${tab === t.id ? "mrep__tab--active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Keyed so switching tabs starts the pane clean rather than carrying the
          other mode's filters, exam selection and half-finished WhatsApp queue. */}
      {tab === "tests" ? (
        <TestReports allowedPrograms={allowedPrograms} />
      ) : (
        <ReportsPane
          key={tab}
          mode={tab}
          allowedPrograms={allowedPrograms}
          adminProfile={adminProfile}
        />
      )}
    </div>
  );
}
