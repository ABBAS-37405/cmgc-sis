/**
 * LMS — the material a teacher publishes for a subject.
 *
 * Two screens read this: `LmsManage` (teacher puts things up) and `Lms`
 * (student takes them down). Everything they need to agree on lives here.
 */

import { supabase } from "./supabaseClient";

export const LMS_BUCKET = "lms-materials";

/**
 * The kinds of thing that go up. `id` is what lands in the database, so these
 * strings are not free to change once material exists.
 */
export const LMS_CATEGORIES = [
  { id: "Recorded Lecture", label: "Recorded Lectures", hint: "YouTube video or playlist link" },
  { id: "Notes", label: "Notes & Handouts", hint: "Typed notes, or a PDF/Word file" },
  { id: "Old Paper", label: "Old Papers", hint: "Past papers, usually a PDF or photo" },
  { id: "Paper Scheme", label: "Paper Scheme", hint: "Pairing scheme / marks division" },
  { id: "Important Link", label: "Important Links", hint: "Any website worth keeping" },
  { id: "Syllabus", label: "Syllabus & Outline", hint: "What the course covers this year" },
  { id: "Announcement", label: "Announcements", hint: "A message for the class" },
];

export const categoryLabel = (id) =>
  LMS_CATEGORIES.find((c) => c.id === id)?.label || id;

export const YEAR_OPTIONS = ["Both Years", "1st Year", "2nd Year"];

// -------------------------------------------------------------------------
// YouTube
// -------------------------------------------------------------------------

/**
 * Pulls the video and/or playlist id out of any of the shapes a teacher is
 * likely to paste — a watch URL, a share link, a playlist, or a video that is
 * part of one. Returns null for anything that is not YouTube, which is how the
 * caller decides between an embedded player and a plain link.
 */
export function parseYouTube(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  const isYouTube = host === "youtube.com" || host === "m.youtube.com" ||
    host === "youtu.be" || host === "youtube-nocookie.com";
  if (!isYouTube) return null;

  const list = parsed.searchParams.get("list");
  let video = parsed.searchParams.get("v");

  if (host === "youtu.be") video = parsed.pathname.slice(1) || null;
  // /embed/ID, /shorts/ID and /live/ID all carry the id in the path.
  const pathMatch = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/);
  if (pathMatch) video = pathMatch[1];

  if (!video && !list) return null;
  return { video: video || null, list: list || null };
}

/**
 * The URL to put in the iframe. youtube-nocookie keeps YouTube from dropping
 * tracking cookies on a student who only wanted to watch a lecture.
 */
export function youTubeEmbedUrl(parsed) {
  if (!parsed) return null;
  const base = "https://www.youtube-nocookie.com/embed";
  if (parsed.video && parsed.list) return `${base}/${parsed.video}?list=${parsed.list}&rel=0`;
  if (parsed.video) return `${base}/${parsed.video}?rel=0`;
  return `${base}/videoseries?list=${parsed.list}&rel=0`;
}

/** Where "Open on YouTube" goes — the real site, playlist intact. */
export function youTubeWatchUrl(parsed, original) {
  if (!parsed) return original;
  if (parsed.video && parsed.list) {
    return `https://www.youtube.com/watch?v=${parsed.video}&list=${parsed.list}`;
  }
  if (parsed.video) return `https://www.youtube.com/watch?v=${parsed.video}`;
  return `https://www.youtube.com/playlist?list=${parsed.list}`;
}

export const isPlaylist = (parsed) => Boolean(parsed?.list);

// -------------------------------------------------------------------------
// Reading and writing
// -------------------------------------------------------------------------

/** The groups a row covers — `programs` first, falling back to the single one. */
export const programsCovered = (row) =>
  Array.isArray(row?.programs) && row.programs.length > 0 ? row.programs : [row?.program].filter(Boolean);

/**
 * Everything published for this student: her group, and either her year or an
 * item marked for both. Subject filtering happens in the component, which
 * groups by subject anyway.
 */
export async function fetchMaterialsForStudent(student) {
  if (!student?.program) return [];
  const { data, error } = await supabase
    .from("lms_materials")
    .select("*")
    .is("deleted_at", null)
    .contains("programs", [student.program])
    .order("created_at", { ascending: false });

  if (error) return [];
  const year = student.year_of_study || "1st Year";
  return (data || []).filter((row) => !row.year_of_study || row.year_of_study === year);
}

/** The teacher's own view: everything she is allowed to see, newest first. */
export async function fetchMaterialsForStaff({ programs = [], subjects = [] } = {}) {
  let query = supabase
    .from("lms_materials")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (programs.length > 0) query = query.overlaps("programs", programs);
  if (subjects.length > 0) query = query.in("subject", subjects);

  const { data } = await query;
  return data || [];
}

/** Soft delete, matching how students and applications are removed. */
export async function removeMaterial(id) {
  const { data, error } = await supabase
    .from("lms_materials")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (error) return error.message;
  // RLS refuses an update by returning success with no rows — see WRITE_BLOCKED_HINT.
  if (!data || data.length === 0) return "BLOCKED";
  return null;
}
