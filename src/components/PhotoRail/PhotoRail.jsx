import { useState, useEffect } from "react";
import Photo from "../Photo/Photo";
import { PHOTO_SIZES } from "../../lib/galleryImages";
import "./PhotoRail.css";

/**
 * A tall box that cross-fades through campus photos.
 *
 * Only two photos exist at a time — the outgoing one and the incoming one
 * fading over it — so the browser never holds 25 images in memory. Each is the
 * 640px WebP, not the 1600px file: the rail is 420px wide and decorative, and
 * cycling 25 full-size photos through it used to cost several megabytes.
 * The next photo is warmed in the background and the rail waits for it, which
 * keeps the fade from flashing an empty box on a slow connection.
 */
export default function PhotoRail({ photos, side = "left", startIndex = 0, interval = 4500 }) {
  const [pair, setPair] = useState({ curr: startIndex % photos.length, prev: null });
  // Holds the src that finished warming, rather than a boolean that would have to
  // be reset synchronously on every index change.
  const [readySrc, setReadySrc] = useState(null);

  const nextIndex = (pair.curr + 1) % photos.length;
  const nextSrc = photos[nextIndex].rail;

  useEffect(() => {
    if (photos.length < 2) return;
    let cancelled = false;
    const img = new Image();
    // A photo that fails to load must not stall the rail — mark it ready and move on.
    const done = () => { if (!cancelled) setReadySrc(nextSrc); };
    img.onload = done;
    img.onerror = done;
    img.src = nextSrc;
    return () => { cancelled = true; };
  }, [photos.length, nextSrc]);

  useEffect(() => {
    if (photos.length < 2 || readySrc !== nextSrc) return;
    const id = setTimeout(() => {
      setPair(({ curr }) => ({ curr: (curr + 1) % photos.length, prev: curr }));
    }, interval);
    return () => clearTimeout(id);
  }, [photos.length, interval, readySrc, nextSrc]);

  return (
    <div className={`photo-rail photo-rail--${side}`} aria-hidden="true">
      <div className="photo-rail__frame">
        {pair.prev !== null && (
          <Photo key={`prev-${pair.prev}`} photo={photos[pair.prev]} sizes={PHOTO_SIZES.rail}
            className="photo-rail__img" decoding="async" />
        )}
        <Photo
          key={`curr-${pair.curr}`}
          photo={photos[pair.curr]}
          sizes={PHOTO_SIZES.rail}
          className="photo-rail__img photo-rail__img--in"
        />
        <span className="photo-rail__sheen" />
      </div>
    </div>
  );
}
