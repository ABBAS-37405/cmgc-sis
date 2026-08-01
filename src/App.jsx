import { useState, useEffect, lazy, Suspense } from "react";
import { ChevronUp } from "lucide-react";
import Navbar from "./components/Navbar/Navbar";
import Hero from "./components/Hero/Hero";
import Stats from "./components/Stats/Stats";
import About from "./components/About/About";
import Programs from "./components/Programs/Programs";
import Admission from "./components/Admission/Admission";
import PortalTeaser from "./components/PortalTeaser/PortalTeaser";
import Footer from "./components/Footer/Footer";
import Gallery from "./components/Gallery/Gallery";
// Split out of the landing bundle. A visitor reading the home page was
// downloading the whole portal — every admin tab, the fee tables, the teacher
// screens — before anything appeared. These load only when someone actually
// opens them, which is the single biggest thing keeping first paint quick.
const Portal = lazy(() => import("./components/Portal/Portal"));
const AdmissionPage = lazy(() => import("./components/AdmissionPage/AdmissionPage"));
import { applyAccent, storedAccent, ACCENT_KEY } from "./lib/accent";
import "./styles/themes.css";
import "./App.css";
import NoticeBoard from "./components/NoticeBoard/NoticeBoard";

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("cmgc-theme") || "light");
  // null means "use whatever accent this theme ships with" — the state every
  // visitor starts in, and what the reset button returns to.
  const [accentHue, setAccentHue] = useState(storedAccent);
  const [scrolled, setScrolled] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [showPortal, setShowPortal] = useState(false);
  const [showAdmission, setShowAdmission] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cmgc-theme", theme);
  }, [theme]);

  // Re-runs on a theme change too: the same hue is rendered darker or lighter
  // depending on which palette it has to sit in.
  useEffect(() => {
    applyAccent(accentHue, theme);
    if (accentHue === null) localStorage.removeItem(ACCENT_KEY);
    else localStorage.setItem(ACCENT_KEY, String(accentHue));
  }, [accentHue, theme]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 60);
      setShowTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  if (showPortal) {
    return (
      <Suspense fallback={<div className="app-loading">Loading portal…</div>}>
        <Portal onExit={() => setShowPortal(false)} />
      </Suspense>
    );
  }
  if (showAdmission) {
    return (
      <Suspense fallback={<div className="app-loading">Loading admission form…</div>}>
        <AdmissionPage onBack={() => setShowAdmission(false)} />
      </Suspense>
    );
  }

  return (
    <div className="app">
      <Navbar
        theme={theme}
        setTheme={setTheme}
        accentHue={accentHue}
        setAccentHue={setAccentHue}
        scrolled={scrolled}
        onAdmissionClick={() => setShowAdmission(true)}
      />
      <Hero scrollTo={scrollTo} onPortalClick={() => setShowPortal(true)} onAdmissionClick={() => setShowAdmission(true)} />
      <Stats />
      <About />
      <Programs />
      <Gallery />
      <NoticeBoard />
      <Admission onAdmissionClick={() => setShowAdmission(true)} />
      <PortalTeaser onPortalClick={() => setShowPortal(true)} />
      <Footer />
      {showTop && (
        <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <ChevronUp size={20} />
        </button>
      )}
    </div>
  );
}