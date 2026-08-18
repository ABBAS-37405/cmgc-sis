/**
 * The half of storage cleanup that talks to Supabase.
 *
 * `storageCleanup.js` decides what should go; this fetches the candidates and
 * does the deleting. Split that way so the deciding half can be driven from
 * plain Node — see the note at the top of that file.
 *
 * Everything here obeys three rules:
 *
 * - **A delete that frees nothing must not be reported as freeing something.**
 *   Storage delete policies did not exist on these buckets until
 *   supabase_storage_cleanup.sql; a refused delete comes back as a plain
 *   success, exactly like the update case in WRITE_BLOCKED_HINT. So every sweep
 *   counts what `remove()` actually returned, never what it asked for.
 * - **Never delete on the strength of a failed read.** The orphan sweep reasons
 *   from absence — "nothing points at this file" — and a students query that
 *   errored looks identical to a college with no profile pictures. Every one of
 *   those reads is checked, and the sweep abandons rather than guesses.
 * - **The paths come from the database, not from the bucket listing**, wherever
 *   that is possible. Deriving a path from the row that owns it cannot delete
 *   something nobody accounted for.
 */

import { supabase } from "./supabaseClient";
import {
  MIN_AGE_MS,
  bytesToFree,
  orphansIn,
  pathFromPublicUrl,
  planSweep,
  totalBytes,
} from "./storageCleanup";

export const LMS_BUCKET = "lms-materials";
export const DOCS_BUCKET = "admission-documents";
export const PROFILES_BUCKET = "student-profiles";

// The six document columns an application carries. Kept here rather than
// imported so a change to the admission form cannot quietly widen what a sweep
// deletes.
const APPLICATION_DOC_COLUMNS = [
  "photo_url",
  "bform_doc_url",
  "father_id_doc_url",
  "marksheet_url",
  "noc_url",
  "verified_marksheet_url",
];

// supabase-js will take a long list, but a refusal or a network error loses the
// whole batch, so they go up in chunks small enough to lose cheaply.
const CHUNK = 50;

const chunked = (list, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Deletes and reports what actually went. `remove()` answers with the objects it
 * removed, so an RLS refusal (or a path that was already gone) shows up as a
 * shorter list rather than as an error — which is the only way to tell the
 * difference between a sweep that worked and one that was silently ignored.
 */
async function removeObjects(bucket, paths) {
  const removed = [];
  let error = null;

  for (const batch of chunked([...new Set(paths.filter(Boolean))])) {
    const { data, error: err } = await supabase.storage.from(bucket).remove(batch);
    if (err) {
      error = err.message;
      break;
    }
    (data || []).forEach((o) => removed.push(o.name));
  }

  return { removed, error };
}

/** How full storage is, per bucket and in total. */
export async function fetchUsage() {
  const { data, error } = await supabase.rpc("storage_usage");
  if (error) return { rows: [], bytes: 0, error: error.message };

  const rows = (data || []).map((r) => ({ bucket: r.bucket_id, bytes: Number(r.bytes) || 0, files: Number(r.files) || 0 }));
  return { rows, bytes: totalBytes(rows), error: null };
}

/** Every object in one bucket, with its size and age. */
export async function fetchObjects(bucket) {
  const { data, error } = await supabase.rpc("storage_objects_in", { bucket });
  if (error) return { objects: null, error: error.message };
  return {
    objects: (data || []).map((r) => ({ path: r.path, bytes: Number(r.bytes) || 0, createdAt: r.created_at })),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// The three safe sweeps. Nothing here is visible to anybody: the LMS rows are
// already soft-deleted, the applications are already rejected or deleted, and
// an orphan picture is one no student record points at.
// ---------------------------------------------------------------------------

/**
 * Files belonging to LMS material that was already removed.
 *
 * `removeMaterial` only ever stamped `deleted_at` — the file stayed in the
 * bucket forever. This is the largest genuinely free win in the project.
 */
export async function sweepDeletedLmsFiles() {
  const { data, error } = await supabase
    .from("lms_materials")
    .select("id, file_url")
    .not("deleted_at", "is", null)
    .not("file_url", "is", null);

  if (error) return { label: "Removed LMS material", removed: 0, error: error.message };

  const byPath = new Map();
  (data || []).forEach((row) => {
    const path = pathFromPublicUrl(row.file_url, LMS_BUCKET);
    if (path) byPath.set(path, row.id);
  });

  if (byPath.size === 0) return { label: "Removed LMS material", removed: 0, error: null };

  const { removed, error: rmErr } = await removeObjects(LMS_BUCKET, [...byPath.keys()]);
  if (removed.length > 0) {
    // The row is already hidden from everyone; clearing file_url is what stops
    // the same paths being offered to the next sweep.
    const ids = removed.map((p) => byPath.get(p)).filter(Boolean);
    await supabase
      .from("lms_materials")
      .update({ file_url: null, file_archived_at: new Date().toISOString(), file_archived_reason: "Removed material — file swept" })
      .in("id", ids);
  }

  return { label: "Removed LMS material", removed: removed.length, error: rmErr };
}

/**
 * The documents of applications that were rejected or deleted.
 *
 * Six files per application, and the biggest single consumer in the project:
 * a rejected applicant's B-Form, father's NIC and marksheet are of no use to
 * anybody, and her record keeps every other field.
 */
export async function sweepRejectedApplicationDocs() {
  const { data, error } = await supabase
    .from("applications")
    .select(`id, status, deleted_at, ${APPLICATION_DOC_COLUMNS.join(", ")}`)
    .or("status.eq.Rejected,deleted_at.not.is.null");

  if (error) return { label: "Rejected / deleted applications", removed: 0, error: error.message };

  const paths = [];
  const rowsTouched = [];
  (data || []).forEach((row) => {
    const mine = APPLICATION_DOC_COLUMNS
      .map((col) => pathFromPublicUrl(row[col], DOCS_BUCKET))
      .filter(Boolean);
    if (mine.length > 0) {
      paths.push(...mine);
      rowsTouched.push(row.id);
    }
  });

  if (paths.length === 0) return { label: "Rejected / deleted applications", removed: 0, error: null };

  const { removed, error: rmErr } = await removeObjects(DOCS_BUCKET, paths);
  if (removed.length > 0) {
    const cleared = Object.fromEntries(APPLICATION_DOC_COLUMNS.map((c) => [c, null]));
    await supabase.from("applications").update(cleared).in("id", rowsTouched);
  }

  return { label: "Rejected / deleted applications", removed: removed.length, error: rmErr };
}

/**
 * Profile pictures nothing points at.
 *
 * The upload path carries `Date.now()`, so changing a girl's picture writes a
 * *new* file and orphans the old one for good. This is the one sweep that
 * reasons from absence, so it is the one that must refuse to act on a failed
 * read — and it leaves anything younger than MIN_AGE_MS alone, because a file
 * is written before the row that points at it.
 */
export async function sweepOrphanProfilePictures() {
  const label = "Orphaned profile pictures";

  const { objects, error: listErr } = await fetchObjects(PROFILES_BUCKET);
  if (listErr) return { label, removed: 0, error: listErr };

  // Every student, soft-deleted ones included: her row still names her picture,
  // and a deleted record is not licence to destroy it.
  const { data, error } = await supabase.from("students").select("profile_picture_url");
  if (error) return { label, removed: 0, error: `${error.message} — nothing deleted` };

  const referenced = new Set(
    (data || [])
      .map((s) => pathFromPublicUrl(s.profile_picture_url, PROFILES_BUCKET))
      .filter(Boolean)
  );

  const orphans = orphansIn(objects, referenced);
  if (orphans.length === 0) return { label, removed: 0, error: null };

  const { removed, error: rmErr } = await removeObjects(PROFILES_BUCKET, orphans.map((o) => o.path));
  return { label, removed: removed.length, error: rmErr };
}

/**
 * All three, and the usage either side of them.
 *
 * Runs whatever it can: one sweep failing does not stop the others, and each
 * reports its own error so the screen can say which part did not work rather
 * than failing as a whole.
 */
export async function runSafeSweep() {
  const before = await fetchUsage();

  const results = [];
  results.push(await sweepDeletedLmsFiles());
  results.push(await sweepRejectedApplicationDocs());
  results.push(await sweepOrphanProfilePictures());

  const after = await fetchUsage();

  return {
    results,
    before: before.bytes,
    after: after.bytes,
    freed: Math.max(0, before.bytes - after.bytes),
    usage: after,
  };
}

// ---------------------------------------------------------------------------
// Live teacher material — never swept without a human saying so
// ---------------------------------------------------------------------------

/**
 * Teachers' live LMS files, oldest first, with what each one would free.
 *
 * This is the list the admin is shown and asked about. It is not swept
 * automatically, and the reason is worth keeping: oldest is a proxy for least
 * valuable and it is often wrong — the paper scheme goes up in the first week of
 * the year and is wanted in the last.
 *
 * `teacher_id is not null` is the college's own rule: what a teacher uploaded,
 * not what the office published.
 */
export async function fetchLiveLmsCandidates() {
  const { data, error } = await supabase
    .from("lms_materials")
    .select("id, title, subject, category, file_url, file_name, created_at, teacher_id, teachers(name)")
    .is("deleted_at", null)
    .not("file_url", "is", null)
    .not("teacher_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) return { candidates: [], error: error.message };

  const { objects } = await fetchObjects(LMS_BUCKET);
  const sizeOf = new Map((objects || []).map((o) => [o.path, o.bytes]));

  const candidates = (data || [])
    .map((row) => {
      const path = pathFromPublicUrl(row.file_url, LMS_BUCKET);
      if (!path) return null;
      return {
        id: row.id,
        path,
        title: row.title,
        subject: row.subject,
        category: row.category,
        fileName: row.file_name,
        teacher: row.teachers?.name || "—",
        createdAt: row.created_at,
        // Unknown rather than zero when the object is not in the listing: it is
        // the size that is missing, not the file.
        bytes: sizeOf.has(path) ? sizeOf.get(path) : null,
      };
    })
    .filter(Boolean);

  return { candidates, error: null };
}

/** What the sweep would pick, if the admin let it run to the low-water mark. */
export function suggestLmsSweep(candidates, currentBytes) {
  const needed = bytesToFree(currentBytes);
  if (needed === 0) return { picked: [], freed: 0, shortfall: 0, needed: 0, skippedTooNew: 0 };
  return { ...planSweep(candidates.map((c) => ({ ...c, bytes: c.bytes || 0 })), needed), needed };
}

/**
 * Takes the file and keeps everything else.
 *
 * The row survives with its title, description, link and YouTube video intact,
 * so what the student loses is the attachment and not the material. Her LMS tab
 * says the file was removed to save space and to ask her teacher for it again.
 */
export async function archiveLmsFiles(rows, reason = "Swept to free storage") {
  if (!rows || rows.length === 0) return { archived: 0, error: null };

  const { removed, error } = await removeObjects(LMS_BUCKET, rows.map((r) => r.path));
  if (removed.length === 0) {
    return { archived: 0, error: error || "Nothing was removed — the delete was refused." };
  }

  const byPath = new Map(rows.map((r) => [r.path, r.id]));
  const ids = removed.map((p) => byPath.get(p)).filter(Boolean);

  const { data, error: dbErr } = await supabase
    .from("lms_materials")
    .update({
      file_url: null,
      file_archived_at: new Date().toISOString(),
      file_archived_reason: reason,
    })
    .in("id", ids)
    .select("id");

  if (dbErr) return { archived: removed.length, error: dbErr.message };
  // The files are already gone; a row that did not update would point at
  // nothing, so this is worth saying out loud rather than counting as success.
  if (!data || data.length < ids.length) {
    return { archived: data?.length || 0, error: "Some records could not be marked as archived." };
  }

  return { archived: data.length, error: null };
}

export { MIN_AGE_MS };
