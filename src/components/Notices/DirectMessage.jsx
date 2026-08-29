import { useState, useEffect } from "react";
import { Trash2, Send } from "lucide-react";
import { WRITE_BLOCKED_HINT } from "../../lib/adminAuth";
import {
  MESSAGE_AUDIENCES, SHOW_FOR_DAYS, audienceLabelFor, isStillShowing,
  fetchPortalMessages, sendPortalMessage, removePortalMessage,
} from "../../lib/portalMessages";
import { longDate } from "../../lib/notices";
import "./DirectMessage.css";

/**
 * Sending a message that opens in front of students, teachers, or both.
 *
 * The sub-tab beside the notice board, and the difference between them is worth
 * keeping straight: a notice waits on a board until somebody goes and looks at
 * it, and this opens as a dialog the next time the portal is opened. So it takes
 * no category, no attachment and no title of any weight — one paragraph, one
 * audience, and it is finished once it has been read.
 *
 * Three things it says out loud, because each is a way the office would
 * otherwise be misled by its own screen:
 *
 * - **Who it reaches**, under the chosen radio, in the same words the message
 *   itself is scoped by.
 * - **That a student message is not a private one.** Students have no auth
 *   account, so the database cannot tell a girl's portal from a stranger's
 *   browser — the whole reasoning is in supabase_portal_messages.sql. A teachers
 *   message is genuinely private, and the hint says which is which.
 * - **When a message has stopped opening itself.** After SHOW_FOR_DAYS it is no
 *   longer shown to anyone who has not already read it, and a row that has gone
 *   quiet must never look like a row that is still working.
 */
export default function DirectMessage() {
  const [messages, setMessages] = useState([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [audience, setAudience] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    // The admin reads every audience: she is the one who sent them.
    const { ready: tableReady, messages: rows } = await fetchPortalMessages("admin");
    setReady(tableReady);
    setMessages(rows);
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    setError("");

    const { error: sendError, message } = await sendPortalMessage({ title, body, audience });

    setSending(false);
    if (sendError) return setError(sendError);

    setMessages((p) => [message, ...p]);
    setReady(true);
    setTitle("");
    setBody("");
  };

  const remove = async (message) => {
    if (!window.confirm(
      "Delete this message?\n\nIt stops opening for anyone who has not read it yet. " +
      "Whoever has already seen it has already seen it."
    )) return;

    const problem = await removePortalMessage(message.id);
    if (problem) return setError(problem === "BLOCKED" ? WRITE_BLOCKED_HINT : problem);
    setMessages((p) => p.filter((m) => m.id !== message.id));
  };

  const chosen = MESSAGE_AUDIENCES.find((a) => a.id === audience);

  return (
    <div className="dmsg">
      <div className="dmsg__form">
        <h3>Send a Portal Message</h3>
        <p className="dmsg__intro">
          Opens as a dialog box in the portal, the next time it is opened. Use it for
          something that cannot wait on the notice board.
        </p>

        <fieldset className="dmsg__audience">
          <legend className="dmsg__legend">Who is it for?</legend>
          {MESSAGE_AUDIENCES.map((a) => (
            <label
              key={a.id}
              className={`dmsg__radio ${audience === a.id ? "dmsg__radio--on" : ""}`}
            >
              <input
                type="radio"
                name="portal-message-audience"
                value={a.id}
                checked={audience === a.id}
                onChange={() => setAudience(a.id)}
              />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>
        <p className="dmsg__hint">{chosen?.hint}</p>

        <input
          className="dmsg__title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Heading (optional)"
        />

        <textarea
          className="dmsg__body-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Type the message…"
        />

        <button onClick={send} disabled={sending || !body.trim()}>
          <Send size={14} /> {sending ? "Sending…" : "Send Message"}
        </button>

        {error && <p className="dmsg__error">{error}</p>}

        <p className="dmsg__note">
          {audience === "teachers"
            ? "Only signed-in teachers can read this one — the database refuses it to anyone else."
            : "Students have no login accounts, so a message to students is hidden from every screen on the website but is not secret. Keep anything about one named girl out of it."}
          {" "}It stops opening by itself after {SHOW_FOR_DAYS} days.
        </p>
      </div>

      <div className="dmsg__list">
        <h3>Sent Messages</h3>

        {!ready && (
          <p className="dmsg__setup">
            Run <code>supabase_portal_messages.sql</code> in the Supabase SQL editor
            first — the table it creates does not exist yet, so nothing can be sent.
          </p>
        )}

        {loading ? (
          <p className="dmsg__empty">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="dmsg__empty">{ready ? "No messages sent yet" : ""}</p>
        ) : (
          messages.map((m) => {
            const live = isStillShowing(m);
            return (
              <div key={m.id} className="dmsg__row">
                <div className="dmsg__row-left">
                  {m.title && <p className="dmsg__row-title">{m.title}</p>}
                  <p className="dmsg__row-body">{m.body}</p>
                  <p className="dmsg__row-meta">
                    {longDate(m.created_at)}
                    <span className="dmsg__tag">{audienceLabelFor(m.audience)}</span>
                    {!live && (
                      <span className="dmsg__tag dmsg__tag--done">
                        No longer opening — over {SHOW_FOR_DAYS} days old
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => remove(m)}
                  className="dmsg__delete"
                  aria-label="Delete this message"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
