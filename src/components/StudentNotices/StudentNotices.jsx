import { useState, useEffect } from "react";
import { Paperclip } from "lucide-react";
import { CATEGORY_ICON, longDate, fetchNotices } from "../../lib/notices";
import "./StudentNotices.css";

/**
 * The notice board inside a portal — the student's and the teacher's.
 *
 * One component with a `reader` prop, the same arrangement as `ClassTestEntry`
 * and `LmsManage` serving two portals: the screen is identical, only the audience
 * differs. A student is shown what was posted to the college; a teacher is shown
 * that plus the instructions addressed to the staff.
 *
 *   reader="public"   -> student portal (and what the landing page shows)
 *   reader="teacher"  -> teacher portal: college notices + staff instructions
 *
 * The filter here decides what the screen *asks* for. What a student is actually
 * *allowed* is decided in the database — the anon select policy in
 * supabase_notices_upgrade.sql returns `audience = 'all'` and nothing else, so a
 * staff instruction is refused rather than merely unrequested. Both halves are
 * wanted: RLS drops rows as silently as it drops writes, so a screen that asked
 * for everything and trusted the refusal would look identical whether the policy
 * was doing its job or not.
 */

const FILTERS = ["All", "Exam", "Fee", "Holiday", "Event", "Academic", "Staff", "General"];

export default function StudentNotices({ reader = "public" }) {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    let live = true;
    const load = async () => {
      const { notices: rows } = await fetchNotices(reader);
      if (!live) return;
      setNotices(rows);
      setLoading(false);
    };
    load();
    return () => { live = false; };
  }, [reader]);

  const filtered = filter === "All" ? notices : notices.filter((n) => n.category === filter);

  return (
    <div className="student-notices">
      <div className="student-notices__head">
        <h3>Notice Board</h3>
        <p className="student-notices__sub">
          {reader === "teacher"
            ? "College announcements and instructions from the office"
            : "Announcements from the college office"}
        </p>
      </div>

      {/* Only the categories that were actually posted, plus All — a filter that
          can only ever return nothing is a dead button. */}
      <div className="student-notices__filters">
        {FILTERS.filter((f) => f === "All" || notices.some((n) => n.category === f)).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`student-notices__filter ${filter === f ? "student-notices__filter--active" : ""}`}
          >
            {CATEGORY_ICON[f] || "🔍"} {f}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="student-notices__empty">Loading notices...</p>
      ) : filtered.length === 0 ? (
        <p className="student-notices__empty">
          {notices.length === 0 ? "No notices have been posted yet." : `No ${filter} notices.`}
        </p>
      ) : (
        <div className="student-notices__list">
          {filtered.map((n, i) => (
            <div key={n.id} className={`student-notices__item ${i === 0 ? "student-notices__item--latest" : ""}`}>
              <span className="student-notices__icon">{CATEGORY_ICON[n.category] || "📢"}</span>
              <div className="student-notices__content">
                <p className="student-notices__title">{n.title}</p>
                {n.body && <p className="student-notices__body">{n.body}</p>}
                <p className="student-notices__date">
                  {longDate(n.created_at)}
                  {/* Only a teacher ever sees one of these, but she should know
                      which notices her students can also read and which are hers. */}
                  {n.audience === "teachers" && (
                    <span className="student-notices__audience-tag">For teachers</span>
                  )}
                </p>
                {n.file_url && (
                  <a
                    className="student-notices__attachment"
                    href={n.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Paperclip size={12} /> {n.file_name || "Open attachment"}
                  </a>
                )}
              </div>
              <span className="student-notices__tag">{n.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
