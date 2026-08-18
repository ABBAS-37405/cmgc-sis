import { useState, useEffect, useCallback } from "react";
import { HardDrive, Trash2, RefreshCw, AlertTriangle, Check } from "lucide-react";
import {
  STORAGE_QUOTA_BYTES, SWEEP_ABOVE, SWEEP_DOWN_TO,
  describeBytes, percentFull, needsSweep, bytesToFree,
} from "../../lib/storageCleanup";
import {
  fetchUsage, runSafeSweep, fetchLiveLmsCandidates, suggestLmsSweep, archiveLmsFiles,
} from "../../lib/storageSweep";
import "./StorageCleanup.css";

const when = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * Storage, and the two ways space is reclaimed.
 *
 * The college is on Supabase's free 1 GB, and until this screen existed nothing
 * in the app had ever deleted a file. Two halves, and the split is the whole
 * design:
 *
 * - **The safe sweep runs by itself** at SWEEP_ABOVE and needs no permission
 *   from anybody, because nothing it deletes is visible to anybody: files whose
 *   LMS material was already removed, documents of rejected or deleted
 *   applications, and profile pictures no student record points at.
 * - **A teacher's live material is never swept automatically.** Oldest-first is
 *   what the college asked for and it is what this offers, but oldest is a proxy
 *   for least valuable and it is often wrong — the paper scheme goes up in the
 *   first week of the year and is wanted in the last. So the list is shown, the
 *   sweep's own picks are ticked, and an admin presses the button.
 *
 * Archiving keeps the record and takes only the file: the title, the notes, the
 * link and any YouTube video survive, and the student is told the attachment was
 * removed to save space.
 */
export default function StorageCleanup() {
  const [usage, setUsage] = useState({ rows: [], bytes: 0, error: null });
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [sweepReport, setSweepReport] = useState(null);

  const [candidates, setCandidates] = useState([]);
  const [ticked, setTicked] = useState(() => new Set());
  const [archiving, setArchiving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const next = await fetchUsage();
    setUsage(next);

    const { candidates: list } = await fetchLiveLmsCandidates();
    setCandidates(list);
    // Pre-tick exactly what the sweep would have chosen, so the admin is
    // agreeing to a proposal rather than building one from scratch.
    const suggestion = suggestLmsSweep(list, next.bytes);
    setTicked(new Set(suggestion.picked.map((c) => c.id)));

    setLoading(false);
  }, []);

  // Loading the screen's own data is the point of this effect; the spinner it
  // raises first is deliberate, not a cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const sweep = async () => {
    setSweeping(true);
    setMessage("");
    const report = await runSafeSweep();
    setSweepReport(report);
    setSweeping(false);
    await load();
  };

  const toggle = (id) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const chosen = candidates.filter((c) => ticked.has(c.id));
  const chosenBytes = chosen.reduce((sum, c) => sum + (c.bytes || 0), 0);

  const archive = async () => {
    if (chosen.length === 0) return;
    const ok = window.confirm(
      `Remove the attached file from ${chosen.length} ${chosen.length === 1 ? "item" : "items"}, ` +
      `freeing about ${describeBytes(chosenBytes)}?\n\n` +
      "Each item keeps its title, its notes, its link and any YouTube video — only the uploaded " +
      "file goes, and students are told it was removed to save space.\n\n" +
      "This cannot be undone. The teacher would have to upload the file again."
    );
    if (!ok) return;

    setArchiving(true);
    const { archived, error } = await archiveLmsFiles(chosen);
    setArchiving(false);
    setMessage(error
      ? `${archived} archived, but: ${error}`
      : `Archived ${archived} ${archived === 1 ? "file" : "files"}.`);
    await load();
  };

  const percent = percentFull(usage.bytes);
  const over = needsSweep(usage.bytes);
  const stillNeeded = bytesToFree(usage.bytes);

  if (loading) return <div className="stor"><p className="stor__loading">Reading storage…</p></div>;

  if (usage.error) {
    return (
      <div className="stor">
        <div className="stor__warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Storage usage could not be read.</strong>
            <p>{usage.error}</p>
            <p>If this says the function does not exist, <code>supabase_storage_cleanup.sql</code> has not been run in the Supabase SQL editor yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stor">
      <div className="stor__head">
        <div>
          <h3><HardDrive size={18} /> Storage</h3>
          <p>
            Cleanup starts on its own once storage passes {Math.round(SWEEP_ABOVE * 100)}%, and frees back
            down to {Math.round(SWEEP_DOWN_TO * 100)}%.
          </p>
        </div>
        <button type="button" className="stor__btn" onClick={sweep} disabled={sweeping}>
          <RefreshCw size={14} /> {sweeping ? "Cleaning…" : "Run cleanup now"}
        </button>
      </div>

      <div className={"stor__meter " + (over ? "stor__meter--over" : "")}>
        <div className="stor__bar"><span style={{ width: `${Math.min(100, percent)}%` }} /></div>
        <p className="stor__figure">
          <strong>{describeBytes(usage.bytes)}</strong> of {describeBytes(STORAGE_QUOTA_BYTES)} used — {percent}%
        </p>
      </div>

      <table className="stor__table">
        <thead><tr><th>Bucket</th><th>Files</th><th>Size</th></tr></thead>
        <tbody>
          {usage.rows.map((r) => (
            <tr key={r.bucket}><td>{r.bucket}</td><td>{r.files}</td><td>{describeBytes(r.bytes)}</td></tr>
          ))}
        </tbody>
      </table>

      {sweepReport && (
        <div className="stor__report">
          <p className="stor__report-head">
            <Check size={14} /> Freed {describeBytes(sweepReport.freed)} — now {describeBytes(sweepReport.after)}.
          </p>
          <ul>
            {sweepReport.results.map((r) => (
              <li key={r.label}>
                {r.label}: {r.removed} {r.removed === 1 ? "file" : "files"} removed
                {r.error ? <span className="stor__err"> — {r.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="stor__message">{message}</p>}

      {/* Live teacher material. Shown always so the admin can free space before
          it is urgent, but only pre-ticked when the sweep is actually due. */}
      <div className="stor__section">
        <h4>Teachers' uploaded files</h4>
        <p className="stor__hint">
          Oldest first. Removing one keeps its title, notes, link and video — only the attached file goes,
          and the student is told it was removed to save space.
          {over
            ? ` About ${describeBytes(stillNeeded)} still needs to go; the ticked rows are what the cleanup would have picked.`
            : " Nothing is ticked, because storage is not full enough for the cleanup to be due."}
        </p>

        {candidates.length === 0 ? (
          <p className="stor__empty">No teacher has an uploaded file on the LMS.</p>
        ) : (
          <>
            <table className="stor__table stor__table--files">
              <thead>
                <tr><th /><th>Uploaded</th><th>Title</th><th>Subject</th><th>Teacher</th><th>Size</th></tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id} className={ticked.has(c.id) ? "stor__row--ticked" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={ticked.has(c.id)}
                        onChange={() => toggle(c.id)}
                        aria-label={`Remove the file attached to ${c.title}`}
                      />
                    </td>
                    <td>{when(c.createdAt)}</td>
                    <td>{c.title}</td>
                    <td>{c.subject}</td>
                    <td>{c.teacher}</td>
                    {/* Unknown, not zero: the row points at a file the bucket
                        listing did not return. */}
                    <td>{c.bytes === null ? "—" : describeBytes(c.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              type="button"
              className="stor__btn stor__btn--danger"
              onClick={archive}
              disabled={archiving || chosen.length === 0}>
              <Trash2 size={14} />
              {archiving
                ? "Removing…"
                : `Remove ${chosen.length} ${chosen.length === 1 ? "file" : "files"} (${describeBytes(chosenBytes)})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
