import { useState, useEffect } from "react";
import { ChevronUp } from "lucide-react";
import "./Hero.css";

const PHRASES = ["Empowering Girls Through Education", "Excellence in FSc, FA, ICS, ICOM", "Admissions Open 2026"];

export default function Hero({ scrollTo, onPortalClick }) {
  const [idx, setIdx] = useState(0);
  const [display, setDisplay] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = PHRASES[idx];
    const speed = deleting ? 30 : 60;
    const timeout = setTimeout(() => {
      if (!deleting) {
        if (display.length < current.length) setDisplay(current.slice(0, display.length + 1));
        else setTimeout(() => setDeleting(true), 1200);
      } else {
        if (display.length > 0) setDisplay(display.slice(0, -1));
        else { setDeleting(false); setIdx((idx + 1) % PHRASES.length); }
      }
    }, speed);
    return () => clearTimeout(timeout);
  }, [display, deleting, idx]);

  return (
    <section id="home" className="hero">
      <div className="hero__overlay"></div>
      <div className="hero__shapes">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="hero__shape" style={{ width: `${60 + i * 30}px`, height: `${60 + i * 30}px`, top: `${10 + i * 15}%`, left: `${(i * 17) % 90}%`, animationDuration: `${3 + i}s` }} />
        ))}
      </div>
      <div className="hero__content">
        <h1 className="hero__title">Community Model<br />Girls College</h1>
        <p className="hero__typed">{display}<span className="hero__cursor">|</span></p>
        <p className="hero__location">Gulzar-e-Quaid, Rawalpindi, Punjab — Affiliated with BISE Rawalpindi</p>
        <div className="hero__actions">
          <button className="hero__btn hero__btn--primary" onClick={() => scrollTo("admission")}>Apply for Admission</button>
          <button className="hero__btn hero__btn--outline" onClick={onPortalClick}>Go to Portal</button>
        </div>
      </div>
      <button className="hero__scroll-down" onClick={() => scrollTo("about")}>
        <ChevronUp size={28} style={{ transform: "rotate(180deg)" }} />
      </button>
    </section>
  );
}