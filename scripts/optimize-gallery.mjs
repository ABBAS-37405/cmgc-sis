/**
 * Rebuilds public/images/gallery from the full-size camera originals.
 *
 * The originals are ~4 MB each straight off a camera. Serving those to a browser
 * that paints them at 86px (thumbnail) or 900px (featured) wastes tens of
 * megabytes per visitor, so this produces two derived sets:
 *
 *   g<N>.jpg        1600px long edge, q78  — featured photo, lightbox, hero rails
 *   thumbs/g<N>.jpg  320px long edge, q70  — the gallery thumbnail strip
 *
 * Output names are always lowercase `.jpg`. The originals are a mix of `.jpg`
 * and `.JPG`, which is invisible on Windows but 404s on a case-sensitive host —
 * normalising here removes that trap for good.
 *
 * Run:  node scripts/optimize-gallery.mjs
 * Add new photos to _original-photos/ and re-run; nothing else needs editing
 * except the count in src/lib/galleryImages.js.
 */
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const SRC = "_original-photos";
const OUT = "public/images/gallery";
const THUMBS = path.join(OUT, "thumbs");

const FULL = { width: 1600, quality: 78 };
const THUMB = { width: 320, quality: 70 };

const mb = (bytes) => (bytes / 1048576).toFixed(1);

// g2 before g10: plain sort() would order these as strings and scramble the set.
const numericOrder = (a, b) =>
  Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0);

async function main() {
  const files = (await fs.readdir(SRC)).filter((f) => /\.jpe?g$/i.test(f)).sort(numericOrder);
  if (files.length === 0) {
    console.error(`No source images found in ${SRC}/`);
    process.exit(1);
  }

  await fs.mkdir(THUMBS, { recursive: true });

  let srcBytes = 0;
  let fullBytes = 0;
  let thumbBytes = 0;

  for (const file of files) {
    const srcPath = path.join(SRC, file);
    const name = `${path.basename(file, path.extname(file)).toLowerCase()}.jpg`;

    srcBytes += (await fs.stat(srcPath)).size;

    // `withoutEnlargement` keeps a photo that is already small from being upscaled
    // (which would add bytes for no visual gain). `rotate()` with no argument
    // applies the EXIF orientation, so portrait shots don't come out sideways
    // once the metadata is stripped.
    await sharp(srcPath)
      .rotate()
      .resize({ width: FULL.width, withoutEnlargement: true })
      .jpeg({ quality: FULL.quality, mozjpeg: true })
      .toFile(path.join(OUT, name));

    await sharp(srcPath)
      .rotate()
      .resize({ width: THUMB.width, withoutEnlargement: true })
      .jpeg({ quality: THUMB.quality, mozjpeg: true })
      .toFile(path.join(THUMBS, name));

    const f = (await fs.stat(path.join(OUT, name))).size;
    const t = (await fs.stat(path.join(THUMBS, name))).size;
    fullBytes += f;
    thumbBytes += t;

    console.log(`${file.padEnd(11)} -> ${name.padEnd(11)} ${mb(f).padStart(5)} MB full, ${(t / 1024).toFixed(0).padStart(4)} KB thumb`);
  }

  console.log(`\n${files.length} photos`);
  console.log(`  originals : ${mb(srcBytes)} MB`);
  console.log(`  full      : ${mb(fullBytes)} MB`);
  console.log(`  thumbs    : ${mb(thumbBytes)} MB`);
  console.log(`  served    : ${mb(fullBytes + thumbBytes)} MB  (${(srcBytes / (fullBytes + thumbBytes)).toFixed(1)}x smaller)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
