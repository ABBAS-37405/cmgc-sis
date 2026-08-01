/**
 * Turns the supplied logo artwork into the files the site actually serves.
 *
 * The original is a seal floating in a large sheet of near-white — the emblem
 * itself covers about a seventh of the canvas. Dropped into a 36px navbar box
 * unchanged, the visible mark would render at roughly 14px, and every visitor
 * would download a megabyte to see it.
 *
 * So: find where the ink actually is, crop to it, and write the two sizes the
 * site uses. Run with `npm run optimize:logo` after replacing the source.
 *
 *   _original-photos/logo-original.png   source, kept out of git
 *   public/logo.png                      256px, the navbar / footer / login mark
 *   public/favicon.png                   180px, browser tab and mobile home screen
 */

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SOURCE = path.resolve("_original-photos/logo-original.png");
const PAD = 8;      // a little breathing room around the seal
const MARK = 256;
const FAVICON = 180;

if (!fs.existsSync(SOURCE)) {
  console.error(`No source at ${SOURCE} — put the full-size logo there first.`);
  process.exit(1);
}

/**
 * The background carries a faint radial gradient, so sharp's own .trim() sees
 * it as content and removes nothing. Looking for genuinely dark pixels instead
 * finds the seal regardless of how the backdrop is shaded.
 */
async function inkBounds(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 150) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("Found no dark pixels — is the source blank?");

  // Squared off, so a border-radius renders it as a clean circular badge.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const size = Math.max(maxX - minX, maxY - minY) + PAD * 2;
  return {
    left: Math.max(0, Math.round(cx - size / 2)),
    top: Math.max(0, Math.round(cy - size / 2)),
    width: Math.min(width, Math.round(size)),
    height: Math.min(height, Math.round(size)),
  };
}

const kb = (file) => (fs.statSync(file).size / 1024).toFixed(0);

const box = await inkBounds(SOURCE);
console.log(`source ${kb(SOURCE)} kB -> cropping to ${box.width}x${box.height} at ${box.left},${box.top}`);

for (const [out, size] of [["public/logo.png", MARK], ["public/favicon.png", FAVICON]]) {
  await sharp(SOURCE)
    .extract(box)
    .resize(size, size, { fit: "cover" })
    .png({ quality: 90, compressionLevel: 9, palette: true })
    .toFile(out);
  console.log(`  ${out.padEnd(20)} ${size}x${size}  ${kb(out)} kB`);
}
