import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import "./StudentNotices.css";

/**
 * Everything the admin has posted, in her own portal.
 *
 * `notices` carries no audience column — a notice is posted to the college, not
 * to a group — so this is the same query the public board runs, and a girl sees
 * exactly what is on the board without leaving the portal.
 */

// Must stay in step with CATEGORIES in Notices.jsx, same as NoticeBoard.jsx:
// a category the admin can post but this file does not know renders with no
// icon and an unstyled tag.
const CATEGORY_ICON = {
  General: "📢", Exam: "📝", Fee: "💰", Holiday: "🎉", Event: "🎭", Academic: "📚",
};

const FILTERS = ["All", "Exam", "Fee", "Holiday", "Event", "Academic", "General"];

const longDate = (value) =>
  new Date(value).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

export default function StudentNotices() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    const fetchNotices = async () => {
      const { data } = await supabase
        .from("notices")
        .select("*")
        .order("created_at", { ascending: false });
      if (data) setNotices(data);
      setLoading(false);
    };
    fetchNotices();
  }, []);

  const filtered = filter === "All" ? notices : notices.filter((n) => n.category === filter);

  return (
    <div className="student-notices">
      <div className="student-notices__head">
        <h3>Notice Board</h3>
        <p className="student-notices__sub">Announcements from the college office</p>
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
                <p className="student-notices__date">{longDate(n.created_at)}</p>
              </div>
              <span className="student-notices__tag">{n.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
