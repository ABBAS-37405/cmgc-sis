/**
 * The half of the notice board that writes — posting one and taking one down.
 *
 * Split out of `notices.js` purely to keep the landing bundle honest: the public
 * `NoticeBoard` renders on the home page and reads through that file, so anything
 * it can reach ships to every first-time visitor. This half pulls in `uploads.js`
 * (compression) and `storageCleanup.js` (the bucket-path helper), neither of which
 * a visitor reading the notice board has any use for. Only `Notices.jsx` imports
 * this, and that lives in the admin chunk.
 *
 * Same arrangement, and the same reason, as `session.js` / `sessionRestore.js`.
 */

import { supabase } from "./supabaseClient";
import { prepareUpload } from "./uploads";
import { pathFromPublicUrl } from "./storageCleanup";
import { NOTICE_BUCKET } from "./notices";

/**
 * Posts one notice, uploading its attachment first.
 *
 * The file goes up before the row is inserted, which is the order every upload in
 * this app uses and the reason `MIN_AGE_MS` exists in the sweep: for a moment
 * there is a file in the bucket that nothing points at. The alternative — insert,
 * then upload, then update — leaves a notice on every student's screen announcing
 * an attachment that is not there yet, which is worse.
 *
 * Returns `{ notice }` or `{ error }`. Never throws.
 */
export async function postNotice({ title, body, category, audience, file }) {
  const clean = (title || "").trim();
  if (!clean) return { error: "A notice needs a title." };

  let fileUrl = null;
  let fileName = null;

  if (file) {
    // `document` rather than `material`: a date sheet or a fee schedule is a page
    // or two, and the 20 MB material ceiling is for a recorded lecture's slides.
    const ready = await prepareUpload(file, "document");
    if (ready.error) return { error: ready.error };

    // Date.now() keeps two notices with the same attachment name apart. The
    // original name is stored separately so the student downloads
    // "Date Sheet.pdf" rather than the timestamped path.
    const safe = ready.file.name.replace(/[^\w.-]+/g, "_");
    const path = `${Date.now()}-${safe}`;

    const { error: uploadError } = await supabase.storage
      .from(NOTICE_BUCKET)
      .upload(path, ready.file, { cacheControl: "3600", upsert: false });

    if (uploadError) {
      return {
        error: uploadError.message?.includes("Bucket not found")
          ? "The notice-files bucket does not exist yet. Run supabase_notices_upgrade.sql in the Supabase SQL editor."
          : `The attachment could not be uploaded: ${uploadError.message}`,
      };
    }

    fileUrl = supabase.storage.from(NOTICE_BUCKET).getPublicUrl(path).data.publicUrl;
    // Whichever name the file actually went up under — a compressed scan is
    // re-encoded as .jpg, and labelling it .png misnames her download.
    fileName = ready.file.name;
  }

  const { data, error } = await supabase
    .from("notices")
    .insert({
      title: clean,
      body: (body || "").trim() || null,
      category,
      audience: audience === "teachers" ? "teachers" : "all",
      file_url: fileUrl,
      file_name: fileName,
    })
    .select()
    .single();

  if (error) {
    // The row failed, so the file it would have pointed at is already an orphan.
    if (fileUrl) await removeNoticeFile(fileUrl);
    // 42703 is "column does not exist" — the migration has not been run.
    if (error.code === "42703") {
      return { error: "This needs supabase_notices_upgrade.sql to be run in the Supabase SQL editor first." };
    }
    return { error: error.message };
  }

  return { error: null, notice: data };
}

/** Best effort, like removeMaterial's: a wasted byte is not worth an error message. */
async function removeNoticeFile(fileUrl) {
  const path = pathFromPublicUrl(fileUrl, NOTICE_BUCKET);
  if (path) await supabase.storage.from(NOTICE_BUCKET).remove([path]);
}

/**
 * Deletes a notice and the file with it.
 *
 * The row goes first and the file second: a notice whose attachment 404s is a
 * broken screen, while a file nobody points at is only a wasted byte that the
 * sweep would have taken anyway. Returns an error string, or null.
 */
export async function removeNotice(id, fileUrl) {
  const { data, error } = await supabase.from("notices").delete().eq("id", id).select("id");

  if (error) return error.message;
  // A delete RLS refuses comes back as a plain success with zero rows.
  if (!data || data.length === 0) return "BLOCKED";

  if (fileUrl) await removeNoticeFile(fileUrl);
  return null;
}
