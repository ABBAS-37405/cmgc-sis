/**
 * The browser's Back button, for an app that has no routes.
 *
 * Navigation here is React state, not URLs (see CLAUDE.md), so without this the
 * back button did the only thing it could: leave the site entirely, mid-form or
 * mid-portal. This gives it the behaviour a visitor expects — one press walks
 * back one screen inside the site, and only a press with nothing left to walk
 * back to offers to leave.
 *
 * How it works, and why it looks the way it does:
 *
 * - **One guard entry, not one entry per screen.** `arm()` keeps exactly one
 *   extra history entry above the one the visitor arrived on, so a back press
 *   fires `popstate` instead of unloading the page. What that press *means* is
 *   decided by our own stack, which is the real record of where she is. Pushing
 *   a browser entry per tab would put a URL in the address bar that reloads to
 *   the wrong screen — state is lost on reload, so the URL would be a lie.
 *
 * - **A step is an undo, registered by whoever navigated forward.** `pushStep`
 *   is called at the click, so the closure captures the screen being left.
 *
 * - **Backward navigation the UI does itself must call `truncate`.** A Logout
 *   button or a "Back to Website" button collapses several screens at once;
 *   without truncating, those dead steps would sit on the stack and the next
 *   back press would appear to do nothing.
 *
 * - **`confirm` on a step asks first.** Used for signing out of a portal, where
 *   the cost of a stray back press is a lost Supabase session.
 *
 * Reload is handled by the marker on the entry rather than by counting: an entry
 * that survives a refresh still carries it, so `arm()` knows not to stack a
 * second guard. Forward presses land back on a marked entry and are ignored.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

const GUARD = "cmgcBack";

/** Undo handlers, innermost last. Empty means "she is on the first screen". */
let steps = [];
/** The question currently on screen, or null. Read through useSyncExternalStore. */
let pending = null;
const listeners = new Set();
let installed = false;

const emit = () => listeners.forEach((l) => l());

const isArmed = () => !!window.history.state?.[GUARD];

/** Puts the trap entry back on top of the browser's history, if it isn't already. */
function arm() {
  if (isArmed()) return;
  // Same URL on purpose: the address bar must keep pointing at something that
  // actually loads, because nothing in this app is addressable.
  window.history.pushState({ ...(window.history.state || {}), [GUARD]: true }, "");
}

/**
 * Registers what one press of Back should undo, and returns a token for
 * `truncate()`. `step` is either a plain undo function or
 * `{ undo, confirm: { title, body, confirmLabel, cancelLabel } }`.
 */
export function pushStep(step) {
  arm();
  steps.push(typeof step === "function" ? { undo: step } : step);
  return steps.length - 1;
}

/**
 * Forgets the step at `token` and everything pushed after it, running nothing.
 *
 * For when the UI performed the same move itself — a Back button, a Logout —
 * and the screens above it are gone with it.
 */
export function truncate(token) {
  if (typeof token !== "number" || token < 0) return;
  if (token < steps.length) steps = steps.slice(0, token);
}

function ask(question) {
  pending = question;
  emit();
}

/** Called by the dialog. Answering is the only way a question is cleared. */
export function answerPending(yes) {
  const q = pending;
  pending = null;
  emit();
  if (!q) return;
  if (yes) q.onConfirm();
  else q.onCancel();
}

function onPopState(event) {
  // She pressed Forward, or landed on a guard entry a refresh left behind.
  // Either way the trap is still set and there is nothing to undo.
  if (event.state?.[GUARD]) return;

  const step = steps.pop();

  if (!step) {
    // Nothing left inside the site: this is a real request to leave it.
    // Deliberately not re-armed until she answers — a second back press while
    // the question is open is an unambiguous "yes, I meant it".
    ask({
      title: "Leave the CMGC website?",
      body: "You are about to go back to the page you came from. Anything you have filled in but not submitted will be lost.",
      confirmLabel: "Yes, leave",
      cancelLabel: "Stay here",
      onConfirm: () => window.history.back(),
      onCancel: arm,
    });
    return;
  }

  if (step.confirm) {
    // She stays put until she answers, so the trap goes back immediately.
    arm();
    ask({
      ...step.confirm,
      onConfirm: () => step.undo(),
      onCancel: () => steps.push(step),
    });
    return;
  }

  step.undo();
  arm();
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

/** The question on screen, or null. Exported for the Node harness. */
export const getPending = () => pending;

/**
 * Arms the back button and starts listening. Idempotent — the flag is what keeps
 * React's double-mount in development from installing two listeners.
 *
 * Deliberately callable without React: the stack machine is the part of this
 * that is easy to get wrong, and this is what lets it be driven from plain Node
 * against a stubbed `window`, which is the only test this repo can run.
 */
export function installBackGuard() {
  if (installed) return;
  installed = true;
  arm();
  window.addEventListener("popstate", onPopState);
}

/** Test seam: forget every step and any open question. */
export function resetBackGuard() {
  steps = [];
  pending = null;
}

/**
 * Installs the guard and subscribes to the current question.
 *
 * Called once, by `BackGuard`, which App renders outside every screen branch so
 * the listener is never torn down.
 */
export function useBackGuard() {
  useEffect(installBackGuard, []);
  return useSyncExternalStore(subscribe, getPending, getPending);
}

/**
 * Wraps a portal's `setActive` so moving between tabs is walkable with Back.
 *
 * The undo captures `active` as it was at the click, which is exactly the tab to
 * return to. Nothing is pushed on the way back, because the undo sets the state
 * directly rather than going through here.
 */
export function useTabHistory(active, setActive) {
  return useCallback(
    (next) => {
      if (next === active) return;
      pushStep(() => setActive(active));
      setActive(next);
    },
    [active, setActive]
  );
}
