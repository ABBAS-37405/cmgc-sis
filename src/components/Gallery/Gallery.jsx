import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { GALLERY_IMAGES as IMAGES, GALLERY_THUMBS as THUMBS } from "../../lib/galleryImages";
import "./Gallery.css";

export default function Gallery() {
  // `active` drives the large featured photo; the lightbox is a separate overlay
  // opened from it, so picking a thumbnail never forces fullscreen on the visitor.
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    document.body.style.overflow = lightbox ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [lightbox]);

  const step = (delta) => setActive((i) => (i + delta + IMAGES.length) % IMAGES.length);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(false);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <section id="gallery" className="gallery">
      <div className="gallery__container">
        <h2 className="gallery__heading">Campus Gallery</h2>
        <p className="gallery__subheading">A glimpse into life at CMGC</p>

        {/* Featured photo — click to view it fullscreen */}
        <button className="gallery__feature" onClick={() => setLightbox(true)} aria-label="View this photo fullscreen">
          <img key={active} src={IMAGES[active]} alt="" className="gallery__feature-img" loading="lazy" decoding="async" />
          <span className="gallery__feature-hint"><Maximize2 size={14} /> Click to enlarge</span>
          <span className="gallery__feature-count">{active + 1} / {IMAGES.length}</span>
          <span
            className="gallery__feature-nav gallery__feature-nav--left"
            role="button"
            tabIndex={0}
            aria-label="Previous photo"
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); step(-1); } }}
          >
            <ChevronLeft size={22} />
          </span>
          <span
            className="gallery__feature-nav gallery__feature-nav--right"
            role="button"
            tabIndex={0}
            aria-label="Next photo"
            onClick={(e) => { e.stopPropagation(); step(1); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); step(1); } }}
          >
            <ChevronRight size={22} />
          </span>
        </button>

        {/* Thumbnail strip — picking one swaps the featured photo above */}
        <div className="gallery__thumbs">
          {IMAGES.map((img, i) => (
            <button
              key={img}
              onClick={() => setActive(i)}
              className={`gallery__thumb ${i === active ? "gallery__thumb--active" : ""}`}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
            >
              {/* 320px thumb, not the 1600px original — the strip is 25 images
                  wide, so this is where the byte savings actually land. */}
              <img src={THUMBS[i]} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      </div>

      {lightbox && (
        <div className="gallery__lightbox" onClick={() => setLightbox(false)}>
          <button
            className="gallery__lightbox-nav gallery__lightbox-nav--left"
            onClick={(e) => { e.stopPropagation(); step(-1); }}
          >
            <ChevronLeft size={26} />
          </button>
          <img src={IMAGES[active]} alt="" className="gallery__lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button
            className="gallery__lightbox-nav gallery__lightbox-nav--right"
            onClick={(e) => { e.stopPropagation(); step(1); }}
          >
            <ChevronRight size={26} />
          </button>

          <button className="gallery__lightbox-close-bar" onClick={(e) => { e.stopPropagation(); setLightbox(false); }}>
            <X size={18} /> Close
          </button>
        </div>
      )}
    </section>
  );
}
