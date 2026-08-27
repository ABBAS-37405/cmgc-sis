import { useState } from "react";
import PostNotices from "./PostNotices";
import TestScheduleAdmin from "./TestScheduleAdmin";
import "./Notices.css";

/**
 * The Notices tab: what the office announces to the college.
 *
 *   Notices        the board itself — post, attach a file, address the staff
 *   Test Schedule  the weekly class tests every portal announces on open
 *
 * The schedule sits here rather than in a tab of its own because it is the same
 * act by the same person: it has always been published as a notice with the
 * spreadsheet attached, and `test_schedule` is written under the very same
 * `admin_can_notices()` policy the board is. A separate tab would have needed a
 * permission key nobody would ever hold separately.
 */
const TABS = [
  {
    id: "board",
    label: "Notices",
    sub: "Post to the public notice board and to every student's and teacher's portal. Attach a file, or address it to the teaching staff only.",
  },
  {
    id: "schedule",
    label: "Test Schedule",
    sub: "The weekly class tests. Every portal opens with a box naming the next one and its papers, and moves on to the one after it by itself.",
  },
];

export default function Notices() {
  const [tab, setTab] = useState("board");
  const active = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div className="notices-tab">
      <div className="notices-tab__head">
        <h2 className="notices-tab__title">Notices</h2>
        <p className="notices-tab__sub">{active.sub}</p>
      </div>

      <div className="notices-tab__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active.id === t.id}
            onClick={() => setTab(t.id)}
            className={`notices-tab__tab ${active.id === t.id ? "notices-tab__tab--active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active.id === "schedule" ? <TestScheduleAdmin /> : <PostNotices />}
    </div>
  );
}
