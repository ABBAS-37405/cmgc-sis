import { useState, useEffect, useRef } from "react";
import { Trash2, Paperclip, X } from "lucide-react";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import {
  NOTICE_CATEGORIES, CATEGORY_ICON, NOTICE_AUDIENCES, longDate, fetchNotices,
} from "../../lib/notices";
// The writing half lives apart so the public notice board — and with it the
// landing bundle — never reaches uploads.js. See noticesAdmin.js.
import { postNotice, removeNotice } from "../../lib/noticesAdmin";
import { selectionError, describeSize } from "../../lib/uploads";
import "./Notices.css";

/**
 * Posting notices.
 *
 * The category list, the icons and the audiences all live in `lib/notices.js`
 * now, shared with the public board and the two portals — they used to be copied
 * into each file with a comment asking the next person to keep them in step, and
 * they had already drifted.
 *
 * Two things this screen can do that it could not before: attach a file (a date
 * sheet, a fee schedule, a syllabus) and address a notice to the teaching staff
 * instead of to the college.
 */
export default function Notices() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("General");
  const [audience, setAudience] = useState("all");
  const [file, setFile] = useState(null);
  const [posting, setPosting] = useState(false);
  const fileInput = useRef(null);

  const load = async () => {
    setLoading(true);
    // The admin reads every audience: she is the one who posted the staff ones.
    const { error: dbError, notices: rows } = await fetchNotices("admin");
    if (dbError) setError(dbError);
    else setNotices(rows);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const pickFile = (e) => {
    const chosen = e.target.files?.[0] || null;
    if (!chosen) return setFile(null);

    // Only what compression could not have rescued is refused here — an oversized
    // photo of a notice board is about to become 250 KB. See uploads.js.
    const problem = selectionError(chosen, "document");
    if (problem) {
      setError(problem);
      e.target.value = "";
      return setFile(null);
    }
    setError("");
    setFile(chosen);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const addNotice = async () => {
    if (!newTitle.trim() || posting) return;
    setPosting(true);
    setError("");

    const { error: postError, notice } = await postNotice({
      title: newTitle, body, category, audience, file,
    });

    setPosting(false);
    if (postError) return setError(postError);

    setNotices((p) => [notice, ...p]);
    setNewTitle("");
    setBody("");
    clearFile();
  };

  const deleteNotice = async (notice) => {
    if (!window.confirm(
      `Delete "${notice.title}"?` +
      (notice.file_url ? "\n\nThe attachment goes with it." : "")
    )) return;

    const problem = await removeNotice(notice.id, notice.file_url);
    if (problem) return setError(problem === "BLOCKED" ? WRITE_BLOCKED_HINT : problem);
    setNotices((p) => p.filter((n) => n.id !== notice.id));
  };

  const audienceHint = NOTICE_AUDIENCES.find((a) => a.id === audience)?.hint || "";

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

        <textarea
          className="notices__body-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Details (optional) — dates, timings, what is expected..."
        />

        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {NOTICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_ICON[c]} {c}</option>
          ))}
        </select>

        <select
          className="notices__audience-select"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          {NOTICE_AUDIENCES.map((a) => (
            <option key={a.id} value={a.id}>Send to: {a.label}</option>
          ))}
        </select>
        <p className="notices__audience-hint">{audienceHint}</p>

        <div className="notices__file-row">
          <label className="notices__file-btn">
            <Paperclip size={14} /> {file ? "Change file" : "Attach a file"}
            <input
              ref={fileInput}
              type="file"
              onChange={pickFile}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            />
          </label>
          {file && (
            <span className="notices__file-chosen">
              {file.name} ({describeSize(file.size)})
              <button type="button" onClick={clearFile} aria-label="Remove attachment"><X size={12} /></button>
            </span>
          )}
        </div>

        <button onClick={addNotice} disabled={posting || !newTitle.trim()}>
          {posting ? (file ? "Uploading..." : "Posting...") : "Post Notice"}
        </button>

        {error && <p className="notices__error">{error}</p>}

        <p className="notices__form-hint">
          {audience === "teachers"
            ? "Staff instructions appear in every teacher's Notices tab straight away. They are never shown on the public board or in a student's portal."
            : "Posting puts it on the public notice board and in the Notices tab of every student's and every teacher's portal straight away."}
        </p>
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
                  {n.body && <p className="notices__body">{n.body}</p>}
                  <p className="notices__date">
                    {longDate(n.created_at)}
                    {n.audience === "teachers" && (
                      <span className="notices__audience-tag">Teachers only</span>
                    )}
                  </p>
                  {n.file_url && (
                    <a
                      className="notices__attachment"
                      href={n.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Paperclip size={12} /> {n.file_name || "Attachment"}
                    </a>
                  )}
                </div>
              </div>
              <div className="notices__row-right">
                <span className="notices__cat">{n.category}</span>
                <button
                  onClick={() => deleteNotice(n)}
                  className="notices__delete"
                  aria-label={`Delete ${n.title}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
