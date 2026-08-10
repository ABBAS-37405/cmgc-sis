import { useState, useEffect } from "react";
import { Check, X, Clock, Inbox } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import { reviewRequest, windowIsOpen, EDIT_WINDOW_HOURS } from "../../lib/profileEdit";
import "./EditRequests.css";

const when = (iso) =>
  iso ? new Date(iso).toLocaleString("en-PK", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/**
 * Students asking to correct their own admission form.
 *
 * Approving does not change her record — it opens a window on it. The database
 * policy in `supabase_profile_edit_requests.sql` is what actually lets her
 * write, and only to the columns granted there.
 */
export default function EditRequests({ allowedPrograms = [], onCountChange }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [noteFor, setNoteFor] = useState(null);   // { request, decision }
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("Pending");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profile_edit_requests")
      .select("*, students(id, name, roll_no, program, year_of_study)")
      .order("created_at", { ascending: false });

    // A sub-admin's RLS already filters these, but her own programs list is
    // applied here too so the count on the tab matches what she can act on.
    const scoped = (data || []).filter((r) => {
      if (!r.students) return false;
      if (allowedPrograms.length === 0) return true;
      return allowedPrograms.includes(r.students.program);
    });

    setRequests(scoped);
    setLoading(false);
    if (onCountChange) onCountChange(scoped.filter((r) => r.status === "Pending").length);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (request, decision, adminNote) => {
    setBusyId(request.id);
    const message = await reviewRequest(request, decision, adminNote);
    setBusyId(null);
    setNoteFor(null);
    setNote("");

    if (message === "BLOCKED") { alert(WRITE_BLOCKED_HINT); return; }
    if (message) { alert("Could not save: " + message); return; }
    await load();
  };

  const shown = requests.filter((r) => (filter === "All" ? true : r.status === filter));

  return (
    <div className="er">
      <div className="er__head">
        <div>
          <h3>Form Edit Requests</h3>
          <p>
            Approving opens her form for {EDIT_WINDOW_HOURS} hours. She can correct her contact,
            personal and family details only — never her roll number, password, group, marks or documents.
          </p>
        </div>
        <div className="er__filters" role="group" aria-label="Filter requests by status">
          {["Pending", "Approved", "Rejected", "All"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={"er__filter " + (filter === f ? "er__filter--active" : "")}>
              {f}
              {f === "Pending" && requests.filter((r) => r.status === "Pending").length > 0 &&
                ` (${requests.filter((r) => r.status === "Pending").length})`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="er__empty">Loading requests...</p>
      ) : shown.length === 0 ? (
        <div className="er__empty er__empty--box">
          <Inbox size={30} />
          <p>{filter === "Pending" ? "No requests waiting for you." : `No ${filter.toLowerCase()} requests.`}</p>
        </div>
      ) : (
        <div className="er__list">
          {shown.map((r) => {
            const open = windowIsOpen(r);
            return (
              <div key={r.id} className="er__card">
                <div className="er__card-head">
                  <div>
                    <strong>{r.students?.name}</strong>
                    <span className="er__meta">
                      {r.students?.roll_no} · {r.students?.program} · {r.students?.year_of_study || "1st Year"}
                    </span>
                  </div>
                  <span className={"er__status er__status--" + r.status.toLowerCase()}>
                    {r.status === "Approved" && !open ? "Expired" : r.status}
                  </span>
                </div>

                <p className="er__reason">“{r.reason}”</p>

                <div className="er__foot">
                  <span className="er__when"><Clock size={12} /> Asked {when(r.created_at)}</span>
                  {r.status === "Approved" && (
                    <span className="er__when">
                      {open ? `Can edit until ${when(r.approved_until)}` : `Window closed ${when(r.approved_until)}`}
                    </span>
                  )}
                  {r.admin_note && <span className="er__note">Your note: “{r.admin_note}”</span>}
                </div>

                {noteFor?.request.id === r.id ? (
                  <div className="er__note-box">
                    <label htmlFor={"note-" + r.id}>
                      {noteFor.decision === "Rejected"
                        ? "Tell her why (she will see this):"
                        : "Note for her (optional):"}
                    </label>
                    <input id={"note-" + r.id} value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={noteFor.decision === "Rejected" ? "e.g. Bring your B-Form to the office instead." : ""} />
                    <div className="er__actions">
                      <button className="er__btn er__btn--primary" disabled={busyId === r.id}
                        onClick={() => decide(r, noteFor.decision, note)}>
                        {busyId === r.id ? "Saving..." : `Confirm ${noteFor.decision}`}
                      </button>
                      <button className="er__btn" onClick={() => { setNoteFor(null); setNote(""); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  (r.status === "Pending" || (r.status === "Approved" && !open)) && (
                    <div className="er__actions">
                      <button className="er__btn er__btn--approve" disabled={busyId === r.id}
                        onClick={() => { setNoteFor({ request: r, decision: "Approved" }); setNote(""); }}>
                        <Check size={13} /> {r.status === "Approved" ? "Re-open Editing" : "Approve"}
                      </button>
                      {r.status === "Pending" && (
                        <button className="er__btn er__btn--reject" disabled={busyId === r.id}
                          onClick={() => { setNoteFor({ request: r, decision: "Rejected" }); setNote(""); }}>
                          <X size={13} /> Reject
                        </button>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
