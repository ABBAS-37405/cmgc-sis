import { useState, useEffect } from "react";
import { ChevronUp } from "lucide-react";
import PhotoRail from "../PhotoRail/PhotoRail";
import { GALLERY_IMAGES } from "../../lib/galleryImages";
import "./Hero.css";

// The rails start half the set apart and tick at slightly different speeds, so
// they never show the same photo or swap in lockstep.
const LEFT_RAIL_START = 0;
const RIGHT_RAIL_START = Math.floor(GALLERY_IMAGES.length / 2);

// Qualification-level names, not group names: FSc covers Pre-Engineering,
// Pre-Medical and General Science; FA covers Humanities and FA-IT.
const PHRASES = ["Empowering Girls Through Education", "Excellence in FSc, FA and ICS", "Admissions Open 2026"];

export default function Hero({ scrollTo, onPortalClick, onAdmissionClick }) {
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
      <PhotoRail images={GALLERY_IMAGES} side="left" startIndex={LEFT_RAIL_START} interval={4500} />
      <PhotoRail images={GALLERY_IMAGES} side="right" startIndex={RIGHT_RAIL_START} interval={5300} />

      <div className="hero__content">
        <h1 className="hero__title">Community Model<br />Girls College</h1>
        <p className="hero__typed">{display}<span className="hero__cursor">|</span></p>
        <p className="hero__location">Gulzar-e-Quaid, Rawalpindi, Punjab — Affiliated with BISE Rawalpindi</p>
        <div className="hero__actions">
          <button className="hero__btn hero__btn--primary" onClick={onAdmissionClick}>Apply for Admission</button>
          <button className="hero__btn hero__btn--outline" onClick={onPortalClick}>Go to Portal</button>
        </div>
      </div>
      <button className="hero__scroll-down" onClick={() => scrollTo("about")}>
        <ChevronUp size={28} style={{ transform: "rotate(180deg)" }} />
      </button>
    </section>
  );
}