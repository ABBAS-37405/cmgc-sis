import { useState, useEffect } from "react";
import { ChevronUp } from "lucide-react";
import Navbar from "./components/Navbar/Navbar";
import Hero from "./components/Hero/Hero";
import Stats from "./components/Stats/Stats";
import About from "./components/About/About";
import Programs from "./components/Programs/Programs";
import Admission from "./components/Admission/Admission";
import PortalTeaser from "./components/PortalTeaser/PortalTeaser";
import Footer from "./components/Footer/Footer";
import Portal from "./components/Portal/Portal";
import "./styles/themes.css";
import "./App.css";
import Gallery from "./components/Gallery/Gallery";

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("cmgc-theme") || "light");
  const [scrolled, setScrolled] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [showPortal, setShowPortal] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cmgc-theme", theme);
  }, [theme]);

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
    return <Portal onExit={() => setShowPortal(false)} />;
  }

  return (
    <div className="app">
      <Navbar theme={theme} setTheme={setTheme} scrolled={scrolled} />
      <Hero scrollTo={scrollTo} onPortalClick={() => setShowPortal(true)} />
      <main className="content-with-bg">
        <Stats />
        <About />
        <Programs />
        <Gallery />
        <Admission />
        <PortalTeaser onPortalClick={() => setShowPortal(true)} />
        <Footer />
      </main>
      {showTop && (
        <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <ChevronUp size={20} />
        </button>
      )}
    </div>
  );
}