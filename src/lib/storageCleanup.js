/**
 * What is worth deleting, in what order, and when to stop.
 *
 * The college is on Supabase's free 1 GB and every bucket in this project only
 * ever grew — nothing had ever called `storage.remove()`. This decides what the
 * sweep does; `storageSweep.js` is the half that talks to the database.
 *
 * It **imports nothing** — same discipline as `payroll.js`, `accounts.js` and
 * `reportPdf.js`, and for the same reason: deciding which of a teacher's files
 * to destroy is exactly the kind of arithmetic that quietly goes wrong, and this
 * repo has no test runner, so it has to be drivable from plain Node against
 * fixtures.
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/**
 * Supabase's free tier. Postgres cannot know which plan the project is on, so
 * this is the one number to change if the college ever pays for storage.
 */
export const STORAGE_QUOTA_BYTES = 1 * GB;

/** Sweeping starts here — the threshold the college asked for. */
export const SWEEP_ABOVE = 0.7;

/**
 * ...and runs down to here, not back to 0.699.
 *
 * Without the gap a sweep would free a single file, drop under the line, and
 * then run again on the very next upload — deleting one more teacher's work
 * every few minutes for the rest of the term. Freeing down to 60% buys real
 * headroom for one visible action.
 */
export const SWEEP_DOWN_TO = 0.6;

/**
 * Nothing newer than this is ever touched, by any sweep.
 *
 * A file is written to the bucket *before* the row that points at it, so a file
 * uploaded seconds ago legitimately looks like an orphan. This is the window in
 * which "nothing references it" means "the insert has not landed yet" rather
 * than "nobody wants it", and it is the difference between housekeeping and
 * deleting an admission document out from under the applicant submitting it.
 */
export const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export const describeBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (n >= GB) return `${(n / GB).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(n / KB))} KB`;
};

export const totalBytes = (rows) =>
  (rows || []).reduce((sum, r) => sum + (Number(r.bytes) || 0), 0);

export const ratioOf = (bytes, quota = STORAGE_QUOTA_BYTES) =>
  quota > 0 ? (Number(bytes) || 0) / quota : 0;

export const percentFull = (bytes, quota = STORAGE_QUOTA_BYTES) =>
  Math.round(ratioOf(bytes, quota) * 1000) / 10;

export const needsSweep = (bytes, quota = STORAGE_QUOTA_BYTES) =>
  ratioOf(bytes, quota) >= SWEEP_ABOVE;

/**
 * How much has to go to get back to the low-water mark. Zero when the sweep is
 * not due at all — callers use that as "there is nothing to do".
 */
export const bytesToFree = (bytes, quota = STORAGE_QUOTA_BYTES) => {
  if (!needsSweep(bytes, quota)) return 0;
  return Math.max(0, Math.round((Number(bytes) || 0) - quota * SWEEP_DOWN_TO));
};

const ageOf = (candidate, now) => now - new Date(candidate.createdAt || 0).getTime();

/**
 * Oldest first, until enough has been picked — the rule the college asked for.
 *
 * `shortfall` is not an error, it is the honest answer when everything eligible
 * still is not enough: the screen says so instead of implying the problem is
 * solved. Anything inside MIN_AGE_MS is skipped rather than counted, because a
 * file that new may be mid-upload.
 */
export function planSweep(candidates, bytesNeeded, now = Date.now()) {
  const eligible = (candidates || [])
    .filter((c) => ageOf(c, now) >= MIN_AGE_MS)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

  const picked = [];
  let freed = 0;

  for (const candidate of eligible) {
    if (freed >= bytesNeeded) break;
    picked.push(candidate);
    freed += Number(candidate.bytes) || 0;
  }

  return {
    picked,
    freed,
    shortfall: Math.max(0, bytesNeeded - freed),
    skippedTooNew: (candidates || []).length - eligible.length,
  };
}

/**
 * The storage path inside a bucket, read back out of a public URL.
 *
 * Supabase public URLs are `<project>/storage/v1/object/public/<bucket>/<path>`,
 * and `path` is what `remove()` wants. Every URL in the database was built by
 * `getPublicUrl`, so this is a parse rather than a guess — but it returns null
 * rather than something approximate whenever the shape is not what it expects,
 * because the caller's next move is a delete.
 */
export function pathFromPublicUrl(url, bucket) {
  if (typeof url !== "string" || !bucket) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;

  const raw = url.slice(at + marker.length).split("?")[0];
  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Everything in the bucket that nothing in the database points at any more.
 *
 * `referenced` is the set of paths still in use. The age guard matters most
 * here: this is the only sweep that reasons from absence, and absence is what a
 * half-finished upload looks like.
 */
export function orphansIn(objects, referenced, now = Date.now()) {
  const keep = referenced instanceof Set ? referenced : new Set(referenced || []);
  return (objects || []).filter(
    (o) => !keep.has(o.path) && ageOf({ createdAt: o.created_at || o.createdAt }, now) >= MIN_AGE_MS
  );
}
