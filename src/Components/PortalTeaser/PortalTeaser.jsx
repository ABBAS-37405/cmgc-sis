import WorkingOnIt from "../WorkingOnIt/WorkingOnIt";
import "./PortalTeaser.css";

export default function PortalTeaser({ onPortalClick }) {
  return (
    <section id="portal" className="portal-teaser">
      <h2>Student / Parent / Admin Portal</h2>
      <p>Login and view your dashboard, attendance, results, and fee status.</p>
      <button onClick={onPortalClick} className="portal-teaser__btn">Go to Portal</button>
      <div style={{ marginTop: "12px" }}>
        <WorkingOnIt text="Admin panel — coming in Phase 3" />
      </div>
    </section>
  );
}