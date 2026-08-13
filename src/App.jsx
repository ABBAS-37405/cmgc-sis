import { useState, useEffect, useRef, lazy, Suspense } from "react";
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
import BackGuard from "./components/BackGuard/BackGuard";
// Demo build only; `__DEMO__` folds to false everywhere else and this goes with it.
import { DemoBanner } from "./demo/DemoUi";
import { pushStep, truncate } from "./lib/backStack";
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

  /*
   * Two booleans off the scroll position: the navbar's shadow and the
   * back-to-top button.
   *
   * Read inside one animation frame and written only when a boolean actually
   * flips. The listener used to call both setters on every scroll event —
   * dozens of times a second — and each crossing re-renders this component,
   * which is the whole app: React only bails on an unchanged value *after* the
   * call, and the flip re-renders every child. That is what was reloading the
   * Student Report list mid-scroll, and it is why the effect sits above the
   * early returns: it runs inside the portals too, where neither of these
   * booleans is used at all.
   *
   * `passive: true` also tells the browser it never has to wait for this
   * handler before painting the next frame.
   */
  useEffect(() => {
    let queued = false;
    let lastScrolled = false;
    let lastShowTop = false;

    const read = () => {
      queued = false;
      const y = window.scrollY;
      const nextScrolled = y > 60;
      const nextShowTop = y > 400;
      if (nextScrolled !== lastScrolled) { lastScrolled = nextScrolled; setScrolled(nextScrolled); }
      if (nextShowTop !== lastShowTop) { lastShowTop = nextShowTop; setShowTop(nextShowTop); }
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(read);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  // Leaving the landing page is the first thing Back has to be able to undo.
  // The token is what lets an in-app Back button collapse the portal and every
  // screen opened inside it in one move — see backStack.js.
  const portalStep = useRef(null);
  const admissionStep = useRef(null);

  const openPortal = () => {
    portalStep.current = pushStep(() => setShowPortal(false));
    setShowPortal(true);
  };
  const closePortal = () => {
    truncate(portalStep.current);
    portalStep.current = null;
    setShowPortal(false);
  };

  const openAdmission = () => {
    admissionStep.current = pushStep(() => setShowAdmission(false));
    setShowAdmission(true);
  };
  const closeAdmission = () => {
    truncate(admissionStep.current);
    admissionStep.current = null;
    setShowAdmission(false);
  };

  if (showPortal) {
    return (
      <>
        <Suspense fallback={<div className="app-loading">Loading portal…</div>}>
          <Portal onExit={closePortal} />
        </Suspense>
        <BackGuard />
        {__DEMO__ && <DemoBanner />}
      </>
    );
  }
  if (showAdmission) {
    return (
      <>
        <Suspense fallback={<div className="app-loading">Loading admission form…</div>}>
          <AdmissionPage onBack={closeAdmission} />
        </Suspense>
        <BackGuard />
        {__DEMO__ && <DemoBanner />}
      </>
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
        onAdmissionClick={openAdmission}
      />
      <Hero scrollTo={scrollTo} onPortalClick={openPortal} onAdmissionClick={openAdmission} />
      <Stats />
      <About />
      <Programs />
      <Gallery />
      <NoticeBoard />
      <Admission onAdmissionClick={openAdmission} />
      <PortalTeaser onPortalClick={openPortal} />
      <Footer />
      {showTop && (
        <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <ChevronUp size={20} />
        </button>
      )}
      <BackGuard />
      {__DEMO__ && <DemoBanner />}
    </div>
  );
}