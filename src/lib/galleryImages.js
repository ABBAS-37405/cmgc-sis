// Campus photos, generated from the camera originals in _original-photos/ by
// `node scripts/optimize-gallery.mjs`. Two sizes per photo:
//
//   GALLERY_IMAGES  1600px wide — featured photo, lightbox, hero rails
//   GALLERY_THUMBS   320px wide — the gallery thumbnail strip
//
// Names are uniformly lowercase `.jpg`. The originals were a mix of `.jpg` and
// `.JPG`, which Windows serves either way but a case-sensitive host does not;
// the optimize script normalises the case so that trap cannot come back.
//
// To add photos: drop them in _original-photos/, re-run the script, and extend
// COUNT below.
const COUNT = 25;

export const GALLERY_IMAGES = Array.from(
  { length: COUNT },
  (_, i) => `/images/gallery/g${i + 1}.jpg`,
);

export const GALLERY_THUMBS = Array.from(
  { length: COUNT },
  (_, i) => `/images/gallery/thumbs/g${i + 1}.jpg`,
);
