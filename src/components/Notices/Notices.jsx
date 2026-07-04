import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Trash2 } from "lucide-react";
import "./Notices.css";

const CATEGORIES = ["General", "Exam", "Holiday", "Event"];

const CATEGORY_ICON = {
  General: "📢",
  Exam: "📝",
  Holiday: "🎉",
  Event: "🎭",
};

export default function Notices() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchNotices();
  }, []);

  const fetchNotices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notices")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setNotices(data);
    setLoading(false);
  };

  const addNotice = async () => {
    if (!newTitle.trim()) return;
    setPosting(true);
    const { data, error } = await supabase
      .from("notices")
      .insert({ title: newTitle, category })
      .select()
      .single();
    if (!error) setNotices((p) => [data, ...p]);
    setNewTitle("");
    setPosting(false);
  };

  const deleteNotice = async (id) => {
    await supabase.from("notices").delete().eq("id", id);
    setNotices((p) => p.filter((n) => n.id !== id));
  };

  return (
    <div className="notices">
      <div className="notices__form">
        <h3>Post New Notice</h3>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNotice()}
          placeholder="Notice title..."
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={addNotice} disabled={posting}>
          {posting ? "Posting..." : "Post Notice"}
        </button>
      </div>

      <div className="notices__list">
        <h3>All Notices</h3>
        {loading ? (
          <p className="notices__empty">Loading...</p>
        ) : notices.length === 0 ? (
          <p className="notices__empty">No notices posted yet</p>
        ) : (
          notices.map((n) => (
            <div key={n.id} className="notices__row">
              <div className="notices__row-left">
                <span className="notices__icon">{CATEGORY_ICON[n.category] || "📢"}</span>
                <div>
                  <p className="notices__title">{n.title}</p>
                  <p className="notices__date">{new Date(n.created_at).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
              </div>
              <div className="notices__row-right">
                <span className="notices__cat">{n.category}</span>
                <button onClick={() => deleteNotice(n.id)} className="notices__delete"><Trash2 size={14} /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}