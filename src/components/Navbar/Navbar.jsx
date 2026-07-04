import { useState } from "react";
import { Menu, X, GraduationCap } from "lucide-react";
import "./Navbar.css";

const NAV_LINKS = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "programs", label: "Programs" },
  { id: "gallery", label: "Gallery" },
  { id: "notices", label: "Notices" },
  { id: "admission", label: "Admission" },
  { id: "contact", label: "Contact" },
];

const THEME_NAMES = ["light", "dark", "soft", "academic"];

export default function Navbar({ theme, setTheme, scrolled, onAdmissionClick }) {
  const [open, setOpen] = useState(false);

  const scrollTo = (id) => {
    setOpen(false);
    if (id === "admission") {
      onAdmissionClick && onAdmissionClick();
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className={`navbar ${scrolled ? "navbar--scrolled" : ""}`}>
      <div className="navbar__inner">
        <button className="navbar__brand" onClick={() => scrollTo("home")}>
          <span className="navbar__logo"><GraduationCap size={20} /></span>
          <span className="navbar__title">CMGC Rawalpindi</span>
        </button>

        <div className="navbar__links">
          {NAV_LINKS.map((l) => (
            <button key={l.id} className="navbar__link" onClick={() => scrollTo(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="navbar__actions">
          <div className="navbar__themes">
            {THEME_NAMES.map((name) => (
              <button
                key={name}
                title={name}
                className={`navbar__theme-dot navbar__theme-dot--${name} ${theme === name ? "navbar__theme-dot--active" : ""}`}
                onClick={() => setTheme(name)}
              />
            ))}
          </div>
          <button className="navbar__cta" onClick={() => onAdmissionClick && onAdmissionClick()}>Apply Now</button>
        </div>

        <button className="navbar__hamburger" onClick={() => setOpen(!open)}>
          {open ? <X size={26} /> : <Menu size={26} />}
        </button>
      </div>

      {open && (
        <div className="navbar__mobile">
          {NAV_LINKS.map((l) => (
            <button key={l.id} className="navbar__mobile-link" onClick={() => scrollTo(l.id)}>
              {l.label}
            </button>
          ))}
          <div className="navbar__themes">
            {THEME_NAMES.map((name) => (
              <button key={name} className={`navbar__theme-dot navbar__theme-dot--${name} ${theme === name ? "navbar__theme-dot--active" : ""}`} onClick={() => setTheme(name)} />
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}