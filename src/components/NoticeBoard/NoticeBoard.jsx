import { useState, useEffect } from "react";
import { Paperclip } from "lucide-react";
import { CATEGORY_ICON, CATEGORY_COLOR, fetchNotices } from "../../lib/notices";
import "./NoticeBoard.css";

/**
 * The public notice board on the landing page.
 *
 * It reads as `public`, which is the college's own notices and never the ones
 * addressed to the teaching staff. That is enforced by the anon select policy in
 * supabase_notices_upgrade.sql — this filter only states the intent, since RLS
 * refuses a read as silently as it refuses a write.
 *
 * The category list and icons come from lib/notices.js, shared with the three
 * other screens that render a notice.
 */

export default function NoticeBoard() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    let live = true;
    const load = async () => {
      const { notices: rows } = await fetchNotices("public");
      if (!live) return;
      setNotices(rows);
      setLoading(false);
    };
    load();
    return () => { live = false; };
  }, []);

  const filtered = filter === "All" ? notices : notices.filter((n) => n.category === filter);

  return (
    <section id="notices" className="noticeboard">
      <div className="noticeboard__container">
        <h2 className="noticeboard__heading">Notice Board</h2>
        <p className="noticeboard__subheading">Latest announcements from CMGC</p>

        <div className="noticeboard__filters">
          {["All", "Exam", "Fee", "Holiday", "Event", "Academic", "General"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`noticeboard__filter ${filter === f ? "noticeboard__filter--active" : ""}`}>
              {CATEGORY_ICON[f] || "🔍"} {f}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="noticeboard__empty">Loading notices...</p>
        ) : filtered.length === 0 ? (
          <p className="noticeboard__empty">No notices available</p>
        ) : (
          <div className="noticeboard__list">
            {filtered.map((n, i) => (
              <div key={n.id} className={`noticeboard__item ${i === 0 ? "noticeboard__item--pinned" : ""}`}>
                <span className="noticeboard__icon">{CATEGORY_ICON[n.category] || "📢"}</span>
                <div className="noticeboard__content">
                  <p className="noticeboard__title">{i === 0 && "📌 "}{n.title}</p>
                  {n.body && <p className="noticeboard__body">{n.body}</p>}
                  <p className="noticeboard__date">{new Date(n.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}</p>
                  {n.file_url && (
                    <a className="noticeboard__attachment" href={n.file_url} target="_blank" rel="noopener noreferrer">
                      <Paperclip size={12} /> {n.file_name || "Open attachment"}
                    </a>
                  )}
                </div>
                <span className={`noticeboard__tag ${CATEGORY_COLOR[n.category]}`}>{n.category}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}