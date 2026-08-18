/**
 * Every file this app puts in a bucket goes through here — the admission form, a
 * fee proof, a profile picture, an assignment question and its submissions, LMS
 * material, and the documents on a student's record.
 *
 * It exists because the college is on Supabase's free 1 GB and was spending it on
 * files nobody had looked at closely. A B-Form photographed on a phone arrives at
 * 4–8 MB, there are five such documents per applicant, and the admission form put
 * them in the bucket exactly as the camera wrote them — around forty applications
 * to fill the entire quota. Redrawing that scan at 2000px and re-encoding it takes
 * it to roughly 250 KB, and nobody reading it on screen can tell the difference.
 *
 * Three rules, and each one is the answer to a way this goes wrong:
 *
 * - **The cap is measured after compression, never before.** Turning away an 8 MB
 *   camera photo at the file picker refuses a file that was about to become
 *   250 KB, and the mother filling in the form has no way to shrink it herself.
 *   Only a source so large that decoding it would hang the tab is refused up
 *   front, which is what `SOURCE_IMAGE_LIMIT` is for.
 * - **If it cannot compress, it hands the original back.** A PDF, a HEIC on a
 *   browser that cannot decode one, a canvas that failed: the file is uploaded as
 *   it came and only the size cap applies. Uploading a blank canvas, or nothing,
 *   would be far worse than uploading a big file.
 * - **Whichever is smaller wins.** Re-encoding an already-optimised JPEG can make
 *   it bigger, so the result is compared against the original and the original is
 *   kept when it was already the better file.
 *
 * It imports nothing, same discipline as session.js. It does reach the DOM for the
 * canvas, so it cannot be driven from plain Node — but every DOM path is guarded
 * and falls back to the original file, so nothing here can fail an upload.
 */

const KB = 1024;
const MB = 1024 * KB;

/**
 * Refused before it is decoded. A camera photo is nowhere near this; something
 * that is has been picked by mistake, and drawing it to a canvas would lock the
 * tab on the cheap Android phones most of these forms are filled on.
 */
export const SOURCE_IMAGE_LIMIT = 25 * MB;

/**
 * `maxBytes` is the ceiling on what is actually uploaded — after compression for
 * an image, as-is for anything else. They are set at what each kind is worth
 * rather than at one number: a passport photo has no business being 5 MB, while a
 * scanned PDF prospectus legitimately is.
 */
export const UPLOAD_KINDS = {
  photo: { maxWidth: 1200, quality: 0.82, maxBytes: 2 * MB },
  document: { maxWidth: 2000, quality: 0.8, maxBytes: 5 * MB },
  submission: { maxWidth: 2000, quality: 0.8, maxBytes: 10 * MB },
  material: { maxWidth: 2000, quality: 0.8, maxBytes: 20 * MB },
};

const specFor = (kind) => UPLOAD_KINDS[kind] || UPLOAD_KINDS.document;

export const describeSize = (bytes) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / KB))} KB`;

const isImageFile = (file) => typeof file?.type === "string" && file.type.startsWith("image/");

/**
 * The cheap synchronous half, for a file picker's onChange: it says no only to
 * what compression could not have rescued anyway. An oversized *image* is not an
 * error here — that is the whole point of the module.
 */
export function selectionError(file, kind = "document") {
  if (!file) return null;
  const spec = specFor(kind);

  if (isImageFile(file)) {
    if (file.size > SOURCE_IMAGE_LIMIT) {
      return `That image is ${describeSize(file.size)} — too large to open here. ` +
        `The most we can take is ${describeSize(SOURCE_IMAGE_LIMIT)}.`;
    }
    return null;
  }

  if (file.size > spec.maxBytes) {
    return `That file is ${describeSize(file.size)}. The largest we can accept is ` +
      `${describeSize(spec.maxBytes)} — please upload a smaller one.`;
  }
  return null;
}

// A phone writes its rotation into EXIF rather than into the pixels, so a canvas
// that ignores it saves every portrait photo on its side. The retry is for the
// browsers that reject the options argument outright.
const decode = async (file) => {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
};

const jpegName = (name) => `${String(name || "upload").replace(/\.[^.]+$/, "")}.jpg`;

// Returns null whenever the original should be kept — a format that would not
// decode, no canvas, or a result that came out no smaller than what we started
// with. Never throws for a caller to handle.
async function compressImage(file, { maxWidth, quality }) {
  if (typeof document === "undefined") return null;

  const bitmap = await decode(file);
  if (!bitmap) return null;

  // Only ever shrinks. Blowing a small photo up to maxWidth would cost bytes and
  // add nothing a reader can see.
  const scale = Math.min(1, maxWidth / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return null;
  }

  // JPEG carries no transparency, so a PNG scan with a clear corner would come
  // out black without this.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob || blob.size >= file.size) return null;

  return new File([blob], jpegName(file.name), { type: "image/jpeg" });
}

/**
 * Call this immediately before uploading, not when the file is chosen: it is the
 * async half, and every screen that uploads already has a spinner running by then.
 *
 * Returns `{ file }` with whatever should actually go in the bucket, or `{ error }`
 * with a sentence to show. `compressed`, `originalSize` and `size` are there for a
 * caller that wants to say what it did; nothing is required to render them.
 */
export async function prepareUpload(file, kind = "document") {
  if (!file) return { error: "No file was selected." };
  const spec = specFor(kind);

  const early = selectionError(file, kind);
  if (early) return { error: early };

  let out = file;
  if (isImageFile(file)) {
    try {
      const smaller = await compressImage(file, spec);
      if (smaller) out = smaller;
    } catch {
      // Keep the original: an upload that happens beats one that was clever.
    }
  }

  if (out.size > spec.maxBytes) {
    return {
      error: out === file
        ? `That file is ${describeSize(file.size)}. The largest we can accept is ` +
          `${describeSize(spec.maxBytes)} — please upload a smaller one.`
        : `Even after compressing, this is ${describeSize(out.size)} and the limit is ` +
          `${describeSize(spec.maxBytes)}. Please upload a smaller one.`,
    };
  }

  return { file: out, originalSize: file.size, size: out.size, compressed: out !== file };
}
