import { useState, useEffect } from "react";
import "./PhotoRail.css";

/**
 * A tall box that cross-fades through campus photos.
 *
 * Only two <img> elements exist at a time — the outgoing photo and the incoming
 * one fading over it — so the browser never holds 25 full-size images in memory.
 * The next photo is warmed in the background and the rail waits for it, which
 * keeps the fade from flashing an empty box on a slow connection.
 */
export default function PhotoRail({ images, side = "left", startIndex = 0, interval = 4500 }) {
  const [pair, setPair] = useState({ curr: startIndex % images.length, prev: null });
  // Holds the src that finished warming, rather than a boolean that would have to
  // be reset synchronously on every index change.
  const [readySrc, setReadySrc] = useState(null);

  const nextIndex = (pair.curr + 1) % images.length;
  const nextSrc = images[nextIndex];

  useEffect(() => {
    if (images.length < 2) return;
    let cancelled = false;
    const img = new Image();
    // A photo that fails to load must not stall the rail — mark it ready and move on.
    const done = () => { if (!cancelled) setReadySrc(nextSrc); };
    img.onload = done;
    img.onerror = done;
    img.src = nextSrc;
    return () => { cancelled = true; };
  }, [images.length, nextSrc]);

  useEffect(() => {
    if (images.length < 2 || readySrc !== nextSrc) return;
    const id = setTimeout(() => {
      setPair(({ curr }) => ({ curr: (curr + 1) % images.length, prev: curr }));
    }, interval);
    return () => clearTimeout(id);
  }, [images.length, interval, readySrc, nextSrc]);

  return (
    <div className={`photo-rail photo-rail--${side}`} aria-hidden="true">
      <div className="photo-rail__frame">
        {pair.prev !== null && (
          <img key={`prev-${pair.prev}`} src={images[pair.prev]} alt="" className="photo-rail__img" decoding="async" />
        )}
        <img
          key={`curr-${pair.curr}`}
          src={images[pair.curr]}
          alt=""
          className="photo-rail__img photo-rail__img--in"
        />
        <span className="photo-rail__sheen" />
      </div>
    </div>
  );
}
