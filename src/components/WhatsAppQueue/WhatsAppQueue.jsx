import "./WhatsAppQueue.css";

export function WhatsappIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.46 0 .09 5.37.09 11.95c0 2.11.55 4.09 1.51 5.81L0 24l6.4-1.68a11.86 11.86 0 0 0 5.64 1.43h.01c6.58 0 11.95-5.37 11.95-11.95 0-3.19-1.24-6.19-3.48-8.32ZM12.05 21.3h-.01a9.3 9.3 0 0 1-4.74-1.3l-.34-.2-3.53.93.94-3.44-.22-.35a9.3 9.3 0 0 1-1.43-4.99c0-5.14 4.19-9.33 9.34-9.33 2.49 0 4.83.97 6.59 2.73a9.26 9.26 0 0 1 2.73 6.6c0 5.15-4.19 9.35-9.33 9.35Zm5.34-6.98c-.29-.15-1.72-.85-1.99-.94-.27-.1-.46-.15-.66.15-.2.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.3-.36.45-.54.15-.18.2-.31.3-.51.1-.2.05-.37-.03-.51-.08-.15-.6-1.46-.82-2-.22-.53-.44-.46-.6-.47-.16-.01-.34-.01-.52-.01-.18 0-.47.07-.72.34-.25.27-.96.94-.96 2.3 0 1.36.99 2.67 1.13 2.86.14.18 1.86 2.84 4.5 3.87 2.65 1.03 2.65.69 3.12.64.47-.05 1.5-.61 1.71-1.2.21-.59.21-1.1.15-1.2-.06-.1-.24-.16-.53-.31Z" />
    </svg>
  );
}

/**
 * The panel a running `useWhatsAppQueue` shows. Renders nothing when no run is
 * in progress, so it can sit unconditionally in a screen's markup.
 *
 * `Skip` is a fallback, not the main path — the queue normally advances by
 * itself when she comes back from WhatsApp. It exists for the case where a
 * number turns out to be wrong and she wants to move on without sending, and
 * for the demo build, where there is no real tab to switch to.
 */
export default function WhatsAppQueue({ queue, onNext, onStop }) {
  if (!queue) return null;

  if (queue.finished) {
    return (
      <div className="waq">
        <div className="waq__text">
          <strong>All {queue.list.length} chat{queue.list.length === 1 ? "" : "s"} opened</strong>
          {queue.skipped.length > 0 && (
            <span className="waq__tip">
              Skipped, no usable WhatsApp number: {queue.skipped.map((s) => s.name).join(", ")}.
              Add one from the Students tab, or message them individually.
            </span>
          )}
        </div>
        <div className="waq__actions">
          <button type="button" className="waq__stop" onClick={onStop}>Done</button>
        </div>
      </div>
    );
  }

  const current = queue.list[queue.index];
  const atLast = queue.index + 1 >= queue.list.length;

  return (
    <div className="waq">
      <div className="waq__text">
        <strong>{current?.name}</strong>
        <span>
          {" "}— chat {queue.index + 1} of {queue.list.length} is open. Press <b>Send</b> in WhatsApp,
          then switch back here and the next one loads by itself.
        </span>
        <span className="waq__tip">
          The message is also copied to your clipboard — if WhatsApp opens the chat empty, just press Ctrl+V.
          Coming back from <em>any</em> other window or tab moves the queue on, so press Stop before you go elsewhere.
        </span>
      </div>
      <div className="waq__actions">
        <button type="button" className="waq__next" onClick={onNext}>
          <WhatsappIcon /> Skip to {atLast ? "finish" : `chat ${queue.index + 2}`}
        </button>
        <button type="button" className="waq__stop" onClick={onStop}>Stop</button>
      </div>
    </div>
  );
}
