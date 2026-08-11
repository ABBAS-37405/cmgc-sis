import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Trash2, Send, X, Copy, Users } from "lucide-react";
import { PROGRAMS, YEARS } from "../../lib/academics";
import { whatsappNumberFor, isValidWhatsAppNumber, copyMessage } from "../../lib/whatsapp";
import WhatsAppQueue, { WhatsappIcon } from "../WhatsAppQueue/WhatsAppQueue";
import { useWhatsAppQueue } from "../WhatsAppQueue/useWhatsAppQueue";
import "./Notices.css";

const ALL_PROGRAMS = "All Programs";
const BOTH_YEARS = "Both";

// "Fee" and "Academic" were already being posted — the demo college seeds both —
// but neither was in this list, so they could not be chosen here and rendered
// without an icon on the public board. The two lists must agree: NoticeBoard.jsx
// has the matching pair.
const CATEGORIES = ["General", "Exam", "Fee", "Holiday", "Event", "Academic"];

const CATEGORY_ICON = {
  General: "📢",
  Exam: "📝",
  Fee: "💰",
  Holiday: "🎉",
  Event: "🎭",
  Academic: "📚",
};

const longDate = (value) =>
  new Date(value).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

/**
 * The message a parent receives.
 *
 * `body` is whatever the admin left in the textarea — the notice title by
 * default, but she may rewrite it before sending, because a board headline and
 * a message to a parent are not always the same sentence. Everything around it
 * is the frame, so a notice cannot go out unsigned or undated.
 *
 * `student` is optional: with one, the message names the girl it concerns; with
 * none it is the generic version, which is what the Copy button hands over for
 * pasting into a class group.
 */
function buildNoticeMessage({ body, category, date, student }) {
  return [
    "Assalamualaikum,",
    "",
    `CMGC Notice — ${category} (${longDate(date)})`,
    "",
    body.trim(),
    "",
    student
      ? `This message is for the parents/guardian of ${student.name} (Roll No: ${student.roll_no}).`
      : null,
    student ? "" : null,
    "Regards,",
    "CMGC Administration",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export default function Notices({ allowedPrograms = [] }) {
  const isRestricted = allowedPrograms.length > 0;
  const visiblePrograms = isRestricted ? PROGRAMS.filter((p) => allowedPrograms.includes(p)) : PROGRAMS;

  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [posting, setPosting] = useState(false);

  // The notice currently being forwarded, or null. Everything below it belongs
  // to that one send.
  const [sendFor, setSendFor] = useState(null);
  const [year, setYear] = useState(BOTH_YEARS);
  const [program, setProgram] = useState(ALL_PROGRAMS);
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [copied, setCopied] = useState(false);

  const wa = useWhatsAppQueue();

  const fetchNotices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notices")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setNotices(data);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotices();
  }, []);

  /**
   * Who the notice is going to.
   *
   * "All Programs" means all of *hers*, never the whole college — a clerk
   * assigned two groups must not be able to message the rest, the same rule
   * MarkAttendance follows.
   */
  const fetchRecipients = async () => {
    setLoadingRecipients(true);
    let query = supabase
      .from("students")
      .select("id, name, roll_no, program, year_of_study, phone, whatsapp")
      .is("deleted_at", null)
      .order("program")
      .order("name");

    if (program !== ALL_PROGRAMS) query = query.eq("program", program);
    else if (isRestricted) query = query.in("program", visiblePrograms);

    if (year !== BOTH_YEARS) query = query.eq("year_of_study", year);

    const { data } = await query;
    setRecipients(data || []);
    setLoadingRecipients(false);
  };

  useEffect(() => {
    if (!sendFor) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendFor, year, program]);

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
    if (sendFor?.id === id) closeSendPanel();
  };

  const openSendPanel = (notice) => {
    setSendFor(notice);
    setBody(notice.title);
    setYear(BOTH_YEARS);
    setProgram(isRestricted ? (visiblePrograms[0] || ALL_PROGRAMS) : ALL_PROGRAMS);
    setRecipients([]);
    setCopied(false);
    wa.stop();
  };

  /*
   * Closing the panel has to stop the run, not just hide it. The queue lives in
   * this component but its banner lives inside the panel, so an open run would
   * otherwise keep advancing on every tab switch with nothing on screen saying
   * so — chats opening at a parent she never chose.
   */
  const closeSendPanel = () => {
    wa.stop();
    setSendFor(null);
  };

  const withNumbers = recipients.filter((s) => isValidWhatsAppNumber(whatsappNumberFor(s)));
  const withoutNumbers = recipients.filter((s) => !isValidWhatsAppNumber(whatsappNumberFor(s)));

  const audienceLabel = `${year === BOTH_YEARS ? "Both years" : year}, ${program === ALL_PROGRAMS ? (isRestricted ? "all your groups" : "all groups") : program}`;

  const genericMessage = sendFor
    ? buildNoticeMessage({ body, category: sendFor.category, date: sendFor.created_at })
    : "";

  const send = () => {
    if (!body.trim()) {
      alert("The message is empty. Write what the parents should be told.");
      return;
    }

    // Screened before the run, never during it: the queue must not stop on a
    // prompt, so anyone without a usable number is set aside and named at the end.
    const entries = withNumbers.map((s) => ({
      id: s.id,
      name: s.name,
      number: whatsappNumberFor(s),
      message: buildNoticeMessage({ body, category: sendFor.category, date: sendFor.created_at, student: s }),
    }));

    wa.start({ entries, skipped: withoutNumbers, what: "this notice", recipientNoun: "student" });
  };

  const copyGeneric = () => {
    copyMessage(genericMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
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
        <p className="notices__form-hint">
          Posting puts it on the public notice board and every student's portal. To send it to parents on
          WhatsApp as well, use the <WhatsappIcon size={11} /> button on the notice below.
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
            <div key={n.id} className={`notices__row ${sendFor?.id === n.id ? "notices__row--active" : ""}`}>
              <div className="notices__row-left">
                <span className="notices__icon">{CATEGORY_ICON[n.category] || "📢"}</span>
                <div>
                  <p className="notices__title">{n.title}</p>
                  <p className="notices__date">{longDate(n.created_at)}</p>
                </div>
              </div>
              <div className="notices__row-right">
                <span className="notices__cat">{n.category}</span>
                <button
                  onClick={() => (sendFor?.id === n.id ? closeSendPanel() : openSendPanel(n))}
                  className="notices__send"
                  title="Forward this notice to students on WhatsApp"
                >
                  <WhatsappIcon />
                </button>
                <button onClick={() => deleteNotice(n.id)} className="notices__delete"><Trash2 size={14} /></button>
              </div>
            </div>
          ))
        )}
      </div>

      {sendFor && (
        <div className="notices__send-panel">
          <div className="notices__send-head">
            <h3><Send size={15} /> Send on WhatsApp</h3>
            <button className="notices__close" onClick={closeSendPanel} title="Close">
              <X size={16} />
            </button>
          </div>

          <div className="notices__filters">
            <label className="notices__field">
              <span>Year</span>
              <select value={year} onChange={(e) => setYear(e.target.value)}>
                <option value={BOTH_YEARS}>Both years</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>

            <label className="notices__field">
              <span>Group</span>
              <select value={program} onChange={(e) => setProgram(e.target.value)}>
                <option value={ALL_PROGRAMS}>{isRestricted ? "All my groups" : "All groups"}</option>
                {visiblePrograms.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <div className="notices__count">
              <Users size={14} />
              {loadingRecipients ? (
                <span>Counting…</span>
              ) : (
                <span>
                  <strong>{withNumbers.length}</strong> will be messaged
                  {withoutNumbers.length > 0 && (
                    <em> · {withoutNumbers.length} have no WhatsApp number</em>
                  )}
                </span>
              )}
            </div>
          </div>

          <label className="notices__field notices__field--full">
            <span>Message to send — edit it if the board headline is not what a parent should read</span>
            <textarea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What should the parents be told?"
            />
          </label>

          <details className="notices__preview">
            <summary>Preview the full message</summary>
            <pre>{genericMessage}</pre>
            <p className="notices__preview-note">
              Each parent's copy also names their own daughter and her roll number. The copied version above does
              not, so it is safe to paste into a class group.
            </p>
          </details>

          {withoutNumbers.length > 0 && (
            <p className="notices__missing">
              No usable WhatsApp number, so they will be skipped:{" "}
              {withoutNumbers.slice(0, 8).map((s) => s.name).join(", ")}
              {withoutNumbers.length > 8 && ` and ${withoutNumbers.length - 8} more`}.
            </p>
          )}

          <div className="notices__send-actions">
            <button className="notices__go" onClick={send} disabled={withNumbers.length === 0 || loadingRecipients}>
              <WhatsappIcon /> Send to {withNumbers.length} student{withNumbers.length === 1 ? "" : "s"}
            </button>
            <button className="notices__copy" onClick={copyGeneric}>
              <Copy size={14} /> {copied ? "Copied" : "Copy message"}
            </button>
            <span className="notices__audience">{audienceLabel}</span>
          </div>

          <p className="notices__hint">
            One chat at a time — you press <b>Send</b> in WhatsApp, then come back here and the next one loads by
            itself. WhatsApp does not let any website send on your behalf. For a whole class at once, use
            <b> Copy message</b> and paste it into the class group instead.
          </p>

          <WhatsAppQueue queue={wa.queue} onNext={wa.next} onStop={wa.stop} />
        </div>
      )}
    </div>
  );
}
