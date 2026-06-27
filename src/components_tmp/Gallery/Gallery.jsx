import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import "./Gallery.css";

const IMAGES = [
  "/images/gallery/g1.jpg",
  "/images/gallery/g2.jpg",
  "/images/gallery/g3.jpg",
  "/images/gallery/g4.jpg",
  "/images/gallery/g5.jpg",
  "/images/gallery/g6.jpg",
  "/images/gallery/g7.jpg",
];

export default function Gallery() {
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    document.body.style.overflow = openIndex !== null ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [openIndex]);

  const close = () => setOpenIndex(null);
  const prev = (e) => { e.stopPropagation(); setOpenIndex((i) => (i - 1 + IMAGES.length) % IMAGES.length); };
  const next = (e) => { e.stopPropagation(); setOpenIndex((i) => (i + 1) % IMAGES.length); };

  return (
    <section id="gallery" className="gallery">
      <div className="gallery__container">
        <h2 className="gallery__heading">Campus Gallery</h2>
        <p className="gallery__subheading">A glimpse into life at CMGC</p>
        <div className="gallery__grid">
          {IMAGES.map((img, i) => (
            <button key={img} className="gallery__item" onClick={() => setOpenIndex(i)}>
              <img src={img} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </div>

      {openIndex !== null && (
        <div className="gallery__lightbox" onClick={close}>
          <button className="gallery__lightbox-nav gallery__lightbox-nav--left" onClick={prev}><ChevronLeft size={26} /></button>
          <img src={IMAGES[openIndex]} alt="" className="gallery__lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button className="gallery__lightbox-nav gallery__lightbox-nav--right" onClick={next}><ChevronRight size={26} /></button>

          <button className="gallery__lightbox-close-bar" onClick={(e) => { e.stopPropagation(); close(); }}>
            <X size={18} /> Close
          </button>
        </div>
      )}
    </section>
  );
}