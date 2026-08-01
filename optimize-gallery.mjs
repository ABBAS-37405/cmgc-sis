/**
 * Rebuilds public/images/gallery from the full-size camera originals.
 *
 * Two things decide how much data a visitor actually spends here, and this
 * script exists to get both right:
 *
 *   Format — WebP is roughly a third smaller than JPEG at the same quality.
 *            One JPEG per photo is still written as a fallback for a browser
 *            too old to know WebP; nothing modern will ever download it.
 *
 *   Width  — a phone painting a photo 360px wide has no use for a 1600px file.
 *            Four widths are written and offered through `srcset`, so the
 *            browser picks by viewport and screen density instead of always
 *            taking the largest. The hero rails, which paint into a 420px box,
 *            were the worst offender: 25 photos at 1600px, all decorative.
 *
 * Output, per photo N:
 *   g<N>-320.webp   thumbnail strip
 *   g<N>-640.webp   hero rails, phones
 *   g<N>-1200.webp  featured photo on a laptop
 *   g<N>-1600.webp  lightbox, large and high-density screens
 *   g<N>-1200.jpg   fallback for browsers without WebP
 *
 * Names are lowercase. The originals are a mix of `.jpg` and `.JPG`, which is
 * invisible on Windows but 404s on a case-sensitive host.
 *
 * Run:  npm run optimize:images
 * Add photos to _original-photos/, re-run, and bump COUNT in
 * src/lib/galleryImages.js.
 */
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const SRC = "_original-photos";
const OUT = "public/images/gallery";

/** Every width written as WebP, smallest first — this is also the srcset. */
export const WIDTHS = [320, 640, 1200, 1600];

/** The one width also written as JPEG, and the `src` a bare <img> falls back to. */
const FALLBACK_WIDTH = 1200;

// Bigger renditions carry more detail per pixel, so they can afford a lower
// quality number than the thumbnail without looking worse.
const webpQuality = (width) => (width <= 320 ? 68 : width <= 640 ? 72 : 76);

const mb = (bytes) => (bytes / 1048576).toFixed(2);

// g2 before g10: a plain sort() compares these as strings and scrambles the set.
const numericOrder = (a, b) =>
  Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0);

/** Clears previously generated files so a shrinking set cannot leave orphans. */
async function clean(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await fs.rm(full, { recursive: true, force: true });
    } else if (/\.(jpe?g|webp)$/i.test(entry.name)) {
      await fs.rm(full, { force: true });
    }
  }
}

async function main() {
  const files = (await fs.readdir(SRC)).filter((f) => /\.jpe?g$/i.test(f)).sort(numericOrder);
  if (files.length === 0) {
    console.error(`No source images found in ${SRC}/`);
    process.exit(1);
  }

  await fs.mkdir(OUT, { recursive: true });
  await clean(OUT);

  let srcBytes = 0;
  const perWidth = Object.fromEntries(WIDTHS.map((w) => [w, 0]));
  let fallbackBytes = 0;

  for (const [i, file] of files.entries()) {
    const srcPath = path.join(SRC, file);
    const stem = `g${i + 1}`;
    srcBytes += (await fs.stat(srcPath)).size;

    // `rotate()` with no argument applies the EXIF orientation, so portrait
    // shots do not come out sideways once metadata is stripped.
    // `withoutEnlargement` stops a small original being upscaled into a bigger
    // file for no visual gain.
    for (const width of WIDTHS) {
      const out = path.join(OUT, `${stem}-${width}.webp`);
      await sharp(srcPath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: webpQuality(width), effort: 5 })
        .toFile(out);
      perWidth[width] += (await fs.stat(out)).size;
    }

    const fallback = path.join(OUT, `${stem}-${FALLBACK_WIDTH}.jpg`);
    await sharp(srcPath)
      .rotate()
      .resize({ width: FALLBACK_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 76, mozjpeg: true })
      .toFile(fallback);
    fallbackBytes += (await fs.stat(fallback)).size;

    process.stdout.write(`\r  ${i + 1}/${files.length} photos processed`);
  }

  const webpTotal = Object.values(perWidth).reduce((a, b) => a + b, 0);

  console.log(`\n\n${files.length} photos from ${mb(srcBytes)} MB of originals\n`);
  for (const width of WIDTHS) {
    const avg = perWidth[width] / files.length / 1024;
    console.log(`  ${String(width).padStart(4)}px webp   ${mb(perWidth[width]).padStart(5)} MB   avg ${avg.toFixed(0).padStart(3)} kB`);
  }
  console.log(`  1200px jpg    ${mb(fallbackBytes).padStart(5)} MB   (fallback, rarely downloaded)`);
  console.log(`\n  on disk       ${mb(webpTotal + fallbackBytes)} MB`);
  console.log(
    "\nWhat a visitor actually downloads is one width per photo, not all of them —\n" +
    `a phone takes the 640px (~${(perWidth[640] / files.length / 1024).toFixed(0)} kB each), a laptop the 1200px ` +
    `(~${(perWidth[1200] / files.length / 1024).toFixed(0)} kB each).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
