import { preloadPortal } from "../../lib/preload";
import "./PortalTeaser.css";

export default function PortalTeaser({ onPortalClick }) {
  return (
    <section id="portal" className="portal-teaser">
      <h2>Student / Parent / Teacher / Admin Portal</h2>
      <p>Login and view your dashboard, attendance, class tests, results, and fee status.</p>
      {/* Fetched on the way to the click, not after it — see lib/preload.js. */}
      <button
        onClick={onPortalClick}
        onMouseEnter={preloadPortal}
        onFocus={preloadPortal}
        onTouchStart={preloadPortal}
        className="portal-teaser__btn">
        Go to Portal
      </button>
    </section>
  );
}
