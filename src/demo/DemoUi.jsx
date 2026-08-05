import { useState } from "react";
import { FlaskConical, RotateCcw, X, LogIn } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { resetDemoDatabase } from "./demoClient";
import { DEMO_LOGINS, DEMO_PASSWORD } from "./demoData";

/**
 * The two things the demo build adds to the screen, and nothing else.
 *
 * Both are rendered from behind a `__DEMO__` check, so Rollup removes this file
 * from the production bundle along with the rest of `src/demo`.
 *
 * **The styles are a string here rather than a `demo.css` next door, and that is
 * not a style preference.** A CSS import is a side effect Rollup may not remove,
 * and an earlier version of this file leaked 1.8 kB of demo styling into the
 * real site's stylesheet — same bytes, same hash, in both builds. As a string it
 * is ordinary module content and goes when the module goes. `npm run build` is
 * the check: neither the JS nor the CSS bundle may grow.
 */
const DEMO_CSS = `
.demo-logins { border: 1px dashed var(--accent); border-radius: 12px; padding: 12px; margin-bottom: 16px; background: var(--bg); }
.demo-logins__head { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--accent); margin-bottom: 9px; }
.demo-logins__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.demo-logins__btn { display: flex; align-items: center; gap: 7px; text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); cursor: pointer; font-family: inherit; }
.demo-logins__btn:disabled { opacity: 0.55; cursor: progress; }
.demo-logins__btn span { display: flex; flex-direction: column; min-width: 0; }
.demo-logins__btn strong { font-size: 12.5px; font-weight: 600; }
.demo-logins__btn em { font-size: 10.5px; font-style: normal; color: var(--subtext); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.demo-logins__note { font-size: 11px; color: var(--subtext); line-height: 1.5; margin-top: 9px; }
@media (max-width: 420px) { .demo-logins__grid { grid-template-columns: 1fr; } }

/* Above the portal sidebars (40), below the back-button dialog (200). */
.demo-banner { position: fixed; left: 14px; bottom: 14px; z-index: 60; display: flex; align-items: center; gap: 9px; padding: 8px 10px 8px 12px; border-radius: 999px; background: var(--card); border: 1px solid var(--accent); box-shadow: 0 6px 18px rgba(0,0,0,0.16); }
.demo-banner__icon { color: var(--accent); flex-shrink: 0; }
.demo-banner__text { font-size: 12px; color: var(--text); white-space: nowrap; }
.demo-banner__btn { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font-family: inherit; }
.demo-banner__close { display: inline-flex; color: var(--subtext); background: none; border: none; cursor: pointer; padding: 2px; }
.demo-banner--mini { padding: 8px; }

/* The student and teacher portals put a nav bar along the bottom on a phone. */
@media (max-width: 768px) {
  .demo-banner { bottom: 74px; left: 10px; }
  .demo-banner__text { display: none; }
}
`;

let styled = false;

/**
 * Called from render rather than an effect, so the first paint is already
 * styled. Idempotent, and only ever reached in the demo build.
 */
function ensureStyles() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const el = document.createElement("style");
  el.setAttribute("data-cmgc-demo", "");
  el.textContent = DEMO_CSS;
  document.head.appendChild(el);
}

/**
 * One-click sign-ins on the login card.
 *
 * The whole point of the demo is that nobody has to be given a password, so
 * these fill the form and submit it in one go. Students have no auth accounts in
 * this app — a roll number and a password column — so a roll number is looked up
 * from the seeded roster rather than written down here, which also keeps this
 * working if the seed changes.
 */
export function DemoLogins({ onPick }) {
  const [busy, setBusy] = useState("");
  ensureStyles();

  const enter = async (entry, index) => {
    setBusy(`${entry.role}-${index}`);
    let identifier = entry.email;

    if (!identifier) {
      const { data } = await supabase
        .from("students")
        .select("roll_no")
        .is("deleted_at", null)
        .order("roll_no")
        .limit(1);
      identifier = data?.[0]?.roll_no;
    }

    if (identifier) await onPick(entry.role, identifier, DEMO_PASSWORD);
    setBusy("");
  };

  return (
    <div className="demo-logins">
      <p className="demo-logins__head">
        <FlaskConical size={13} /> Demo — pick anyone and go in. No password needed.
      </p>
      <div className="demo-logins__grid">
        {DEMO_LOGINS.map((entry, i) => (
          <button
            key={`${entry.role}-${i}`}
            type="button"
            className="demo-logins__btn"
            onClick={() => enter(entry, i)}
            disabled={!!busy}
            title={entry.hint}
          >
            <LogIn size={13} />
            <span>
              <strong>{entry.label}</strong>
              <em>{busy === `${entry.role}-${i}` ? "Signing in…" : entry.hint}</em>
            </span>
          </button>
        ))}
      </div>
      <p className="demo-logins__note">
        Everything you see is invented sample data. Anything you change is kept in
        this browser tab only and disappears on refresh.
      </p>
    </div>
  );
}

/**
 * The permanent "this is a demo" marker.
 *
 * It has to be visible on every screen, including inside the portals, because
 * the whole risk of a convincing demo is somebody mistaking it for the real
 * college records. Reset rebuilds the seeded college and reloads, which is the
 * only cleanup a presenter should ever need.
 */
export function DemoBanner() {
  const [open, setOpen] = useState(true);
  ensureStyles();

  if (!open) {
    return (
      <button className="demo-banner demo-banner--mini" onClick={() => setOpen(true)} title="Demo mode">
        <FlaskConical size={15} />
      </button>
    );
  }

  return (
    <div className="demo-banner">
      <FlaskConical size={15} className="demo-banner__icon" />
      <span className="demo-banner__text">
        <strong>Demo</strong> — sample data, not real students
      </span>
      <button
        className="demo-banner__btn"
        onClick={() => { resetDemoDatabase(); window.location.reload(); }}
        title="Rebuild the sample college and start over"
      >
        <RotateCcw size={13} /> Reset
      </button>
      <button className="demo-banner__close" onClick={() => setOpen(false)} title="Hide">
        <X size={14} />
      </button>
    </div>
  );
}
