/**
 * Opening WhatsApp chats from the portal.
 *
 * IMPORTANT, and worth understanding before blaming the code: these are
 * "click to chat" links. They open a chat with the message already typed — a
 * human still has to press Send. Nothing here can deliver a message on its own.
 * Actually sending without a human requires the WhatsApp Business API (Twilio or
 * Meta), which `server.js` is already wired for but has no credentials.
 *
 * On a phone the link hands off to the WhatsApp app and is reliable. On a laptop
 * it goes to WhatsApp Web, which only works if that browser has an active linked
 * session — and the generic wa.me link adds a redirect hop that frequently loses
 * the message on the way. Sending straight to web.whatsapp.com avoids that hop,
 * which is the single biggest improvement available without the paid API.
 *
 * One laptop failure is NOT fixable from here: WhatsApp shows "Your account on
 * linked devices is restricted. You can't start new chats right now" and blocks
 * the chat. That is an account-level limit on the linked device — it only bites
 * numbers with no existing conversation, and only the phone (or the Business
 * API) can start those. Every message is copied to the clipboard so the admin
 * can still paste it wherever the chat does open.
 */

const isMobile = () =>
  typeof navigator !== "undefined" && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

/**
 * The demo build never opens a real chat. Callers that reserve a window or drive
 * a queue need to know this *before* they start, otherwise the demo pops a blank
 * tab and then stalls waiting for a tab switch that never happens.
 */
export function isDemoMode() {
  return (
    (typeof __DEMO__ !== "undefined" && !!__DEMO__) ||
    (typeof window !== "undefined" && !!window.__DEMO__)
  );
}

/** 03001234567 / +923001234567 / 923001234567 -> 923001234567 */
export function normalizeWhatsAppNumber(value) {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  return digits;
}

/** A number is usable if it looks like a Pakistani mobile: 92 + 10 digits. */
export function isValidWhatsAppNumber(value) {
  const n = normalizeWhatsAppNumber(value);
  return /^92\d{10}$/.test(n);
}

/**
 * The number to message: her WhatsApp field first, her phone only as a fallback.
 * A landline-style phone may have no WhatsApp on it at all, which is exactly why
 * students now carry a separate whatsapp column.
 */
export function whatsappNumberFor(person) {
  const wa = (person?.whatsapp || "").trim();
  if (wa) return wa;
  return (person?.phone || person?.phone1 || "").trim();
}

export function whatsappUrl(number, message) {
  const n = normalizeWhatsAppNumber(number);
  const text = encodeURIComponent(message);
  return isMobile()
    ? `https://wa.me/${n}?text=${text}`
    : `https://web.whatsapp.com/send?phone=${n}&text=${text}`;
}

/**
 * Puts the message on the clipboard so it can be pasted straight into the chat.
 *
 * This is the safety net for the two things WhatsApp Web does that no link can
 * work around: dropping the prefilled text, and refusing to start a new chat
 * while a linked device is restricted. In both cases the chat is open and empty,
 * and Ctrl+V finishes the job. Best effort — a browser that denies clipboard
 * access must not stop the chat from opening.
 */
export function copyMessage(message) {
  try {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(message).catch(() => {});
      return true;
    }
  } catch {
    // ignore — opening the chat matters more than the convenience copy
  }
  return false;
}

/**
 * Opens one chat. Returns false when there is no usable number, so callers can
 * tell the admin instead of silently opening a broken tab.
 */
export function openWhatsApp(number, message, windowRef) {
  // Demo mode: do not attempt to open real chats. Inform the user instead
  // and copy a demo notice to the clipboard so they can paste it.
  const demoNotice = "This is a demo version — please add a WhatsApp number to send messages.";
  if (isDemoMode()) {
    try { copyMessage(demoNotice); } catch { /* ignore */ }
    try {
      if (typeof window !== "undefined" && window.alert) window.alert(demoNotice);
    } catch {
      // ignore
    }
    return true;
  }

  const n = normalizeWhatsAppNumber(number);
  if (!n) return false;
  const url = whatsappUrl(n, message);

  // Copy first, while we are still inside the click gesture the clipboard
  // permission depends on — after window.open focus has already left.
  copyMessage(message);

  // A window reserved inside the click gesture (so the popup blocker allows it)
  // is reused rather than opening a second tab.
  if (windowRef && !windowRef.closed) {
    windowRef.location.href = url;
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return true;
}

/**
 * Opens several chats one at a time rather than firing N tabs at once.
 *
 * Browsers block most of a rapid burst of window.open calls, and WhatsApp Web
 * cannot cope with several chats being pushed at it in the same second — which
 * is why "notify all absentees" often delivered only the first message. This
 * walks the list, letting the caller confirm each step.
 */
export function openWhatsAppQueue(entries, { onStep } = {}) {
  let index = 0;

  const next = () => {
    if (index >= entries.length) return { done: true, sent: index };
    const entry = entries[index];
    index += 1;
    openWhatsApp(entry.number, entry.message);
    if (onStep) onStep(index, entries.length, entry);
    return { done: index >= entries.length, sent: index };
  };

  return { next, total: entries.length };
}
