import "./PortalTeaser.css";

export default function PortalTeaser({ onPortalClick }) {
  return (
    <section id="portal" className="portal-teaser">
      <h2>Student / Parent / Teacher / Admin Portal</h2>
      <p>Login and view your dashboard, attendance, class tests, results, and fee status.</p>
      <button onClick={onPortalClick} className="portal-teaser__btn">Go to Portal</button>
    </section>
  );
}