import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import "./NoticeBoard.css";

const CATEGORY_ICON = {
  General: "📢", Exam: "📝", Holiday: "🎉", Event: "🎭",
};

const CATEGORY_COLOR = {
  General: "noticeboard__tag--general",
  Exam: "noticeboard__tag--exam",
  Holiday: "noticeboard__tag--holiday",
  Event: "noticeboard__tag--event",
};

export default function NoticeBoard() {
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
    <section id="notices" className="noticeboard">
      <div className="noticeboard__container">
        <h2 className="noticeboard__heading">Notice Board</h2>
        <p className="noticeboard__subheading">Latest announcements from CMGC</p>

        <div className="noticeboard__filters">
          {["All", "Exam", "Holiday", "Event", "General"].map((f) => (
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
                  <p className="noticeboard__date">{new Date(n.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}</p>
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