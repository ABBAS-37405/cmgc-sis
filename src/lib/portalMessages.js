/**
 * The office's own message, opened as a dialog in front of whoever it is for.
 *
 * Everything the admin composer and the two portals must agree on lives here —
 * the three audiences, what each portal asks the database for, and what counts
 * as already read. Same arrangement as `notices.js`, and for the same reason:
 * the audience strings are stored in `portal_messages.audience`, so a second
 * copy of them somewhere would drift the first time one is renamed.
 *
 * Unlike `notices.js` this is **never reached from the landing page** — nothing
 * on the public site reads this table — so the writing half does not have to be
 * split out into a second file to keep the landing bundle honest.
 *
 * Read supabase_portal_messages.sql before changing the audiences: 'teachers' is
 * genuinely private, and 'students' is not private in the same sense, because a
 * student portal request is the `anon` role and so is a stranger's.
 */

import { supabase } from "./supabaseClient";

// The deciding half — what counts as unread, and how long a message keeps
// opening — lives in portalMessageAlerts.js, which imports nothing so it can be
// driven from plain Node. Re-exported here so a screen has one import.
export {
  SHOW_FOR_DAYS, isStillShowing, unreadFor, readSeenIds, writeSeenId,
} from "./portalMessageAlerts";

/**
 * The three the admin picks between. `id` values are stored, so they are not
 * free to rename once a message has been sent.
 */
export const MESSAGE_AUDIENCES = [
  {
    id: "all",
    label: "Students and teachers",
    hint: "Opens in every student's portal and every teacher's portal.",
  },
  {
    id: "students",
    label: "Students only",
    hint: "Opens in every student's portal. Teachers never see it.",
  },
  {
    id: "teachers",
    label: "Teachers only",
    hint: "Opens in every teacher's portal. Students never see it.",
  },
];

export const audienceLabelFor = (id) =>
  MESSAGE_AUDIENCES.find((a) => a.id === id)?.label || "Students and teachers";

/** What each portal asks for. The database enforces it too — see the SQL. */
const AUDIENCE_FILTER = {
  student: ["all", "students"],
  teacher: ["all", "teachers"],
  admin: null,
};

/**
 * Messages for one reader, newest first.
 *
 * Best effort, exactly like `fetchReportLog`: a portal running before
 * supabase_portal_messages.sql has been pasted into the dashboard should show no
 * dialog, not an error on a screen that has nothing to do with this. `ready`
 * says which of the two happened, so the admin screen can name the file to run
 * rather than reporting "no messages yet" about a table that does not exist.
 */
export async function fetchPortalMessages(reader = "student") {
  let query = supabase
    .from("portal_messages")
    .select("*")
    .order("created_at", { ascending: false });

  const wanted = AUDIENCE_FILTER[reader];
  if (wanted) query = query.in("audience", wanted);

  const { data, error } = await query;

  if (error) {
    // 42P01 is "relation does not exist"; a refusal is 42501. Either way there is
    // nothing to show, and only the admin screen has any use for the difference.
    return { ready: error.code !== "42P01", error: error.message, messages: [] };
  }
  return { ready: true, error: null, messages: data || [] };
}

/** Sends one. Returns `{ message }` or `{ error }`; never throws. */
export async function sendPortalMessage({ title, body, audience }) {
  const text = (body || "").trim();
  if (!text) return { error: "A message needs something to say." };
  if (!MESSAGE_AUDIENCES.some((a) => a.id === audience)) {
    return { error: "Choose who the message is for." };
  }

  const { data: auth } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("portal_messages")
    .insert({
      title: (title || "").trim() || null,
      body: text,
      audience,
      created_by: auth?.user?.id || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "42P01") {
      return { error: "This needs supabase_portal_messages.sql to be run in the Supabase SQL editor first." };
    }
    return { error: error.message };
  }
  return { error: null, message: data };
}

/**
 * Takes one down. Returns an error string, `"BLOCKED"`, or null.
 *
 * The delete asks for its row back, because a delete RLS refuses comes back as a
 * plain success with zero rows — the rule from `WRITE_BLOCKED_HINT`.
 */
export async function removePortalMessage(id) {
  const { data, error } = await supabase
    .from("portal_messages")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return error.message;
  if (!data || data.length === 0) return "BLOCKED";
  return null;
}
