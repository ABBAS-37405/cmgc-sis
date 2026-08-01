// Campus photos, generated from the camera originals in _original-photos/ by
// `npm run optimize:images`.
//
// Each photo exists as WebP at four widths plus one JPEG. Nothing here picks a
// width — `srcSet` hands the browser all four and it takes the one that suits
// the viewport and screen density, which is what stops a phone downloading a
// 1600px file to paint it 360px wide.
//
// The JPEG is only ever fetched by a browser too old to know WebP; `<picture>`
// in `Photo.jsx` is what makes that choice safely, so use that component rather
// than reaching for these URLs directly.
//
// To add photos: drop them in _original-photos/, re-run the script, bump COUNT.
const COUNT = 25;

/** Must match WIDTHS in optimize-gallery.mjs. */
const WIDTHS = [320, 640, 1200, 1600];
const FALLBACK_WIDTH = 1200;

const stem = (i) => `/images/gallery/g${i + 1}`;

export const GALLERY_PHOTOS = Array.from({ length: COUNT }, (_, i) => ({
  webpSrcSet: WIDTHS.map((w) => `${stem(i)}-${w}.webp ${w}w`).join(", "),
  jpg: `${stem(i)}-${FALLBACK_WIDTH}.jpg`,
  // The exact file the hero rail paints, so its warm-up fetches what the rail
  // will actually use instead of pulling a second, larger copy.
  rail: `${stem(i)}-640.webp`,
}));

/**
 * How wide the photo will actually be painted, per screen. The browser needs
 * this to choose from srcSet before any layout has happened, so it cannot be
 * worked out for us — a wrong value here means the wrong file is downloaded.
 */
export const PHOTO_SIZES = {
  // Gallery container caps at 1100px, full-bleed below that.
  feature: "(min-width: 1140px) 1100px, 100vw",
  // Fixed 420px rails, and they are display:none below 1080px.
  rail: "(min-width: 1080px) 420px, 1px",
  thumb: "120px",
  lightbox: "90vw",
};
