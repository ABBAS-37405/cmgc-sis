/**
 * The notice board — everything the four screens that read or write it must agree on.
 *
 * Those screens are `Notices` (admin posts), `NoticeBoard` (the public landing
 * page), and `StudentNotices`, which serves both the student portal and the
 * teacher portal off one `audience` prop. Same arrangement as `whatsapp.js` being
 * the only place a chat link is built, and for the same reason: the category list
 * used to be copied into three files with a comment in each begging the next
 * person to keep them in step, and it had already drifted once — "Fee" and
 * "Academic" were being posted before either was in the admin's own list, so they
 * rendered on the board with no icon and an unstyled tag.
 *
 * It imports the Supabase client, unlike `academics.js`, because a notice is not
 * arithmetic — there is nothing here to drive from Node against a fixture. But it
 * imports **nothing else**, and that is load-bearing rather than tidy: the public
 * `NoticeBoard` is on the landing page, so anything reachable from here is in the
 * landing bundle. Posting a notice needs `uploads.js` and `storageCleanup.js`,
 * which have no business being downloaded by a visitor reading the home page, so
 * that half lives in `noticesAdmin.js` and is imported only from the admin screen.
 * Keeping them together measured +5.8 kB on a bundle held at ~430 kB — the same
 * split, for the same reason, as `session.js` and `sessionRestore.js`.
 */

/**
 * The client is `import()`ed, not imported — and that is the single biggest
 * thing keeping the landing page quick.
 *
 * `createClient` drags in the whole of supabase-js: auth-js (93 kB), realtime
 * (29 kB), phoenix (25 kB), storage (26 kB), postgrest (15 kB) — **202 kB raw,
 * ~55 kB gzipped**, of which the notice board uses one REST select. Statically
 * imported here it was in the landing chunk, so every first-time visitor
 * downloaded and parsed all of it before the hero could paint, on a phone, on
 * a Pakistani mobile connection.
 *
 * Fetching it inside the call moves it off the critical path entirely: the page
 * paints, then the effect runs and the client arrives alongside the images. The
 * `preconnect` in index.html is what keeps the query itself quick once it does.
 *
 * `import()` is idempotent — the module registry hands back the same promise —
 * so the second reader costs nothing, and the portals, which import the client
 * statically, are unaffected.
 */
const client = async () => (await import("./supabaseClient")).supabase;

export const NOTICE_BUCKET = "notice-files";

/** Stored in `notices.category`, so these strings are not free to rename. */
export const NOTICE_CATEGORIES = ["General", "Exam", "Fee", "Holiday", "Event", "Academic", "Staff"];

export const CATEGORY_ICON = {
  General: "📢",
  Exam: "📝",
  Fee: "💰",
  Holiday: "🎉",
  Event: "🎭",
  Academic: "📚",
  Staff: "🧑‍🏫",
};

/** The class the public board tints a tag with. Portal screens use one flat tag. */
export const CATEGORY_COLOR = {
  General: "noticeboard__tag--general",
  Exam: "noticeboard__tag--exam",
  Fee: "noticeboard__tag--fee",
  Holiday: "noticeboard__tag--holiday",
  Event: "noticeboard__tag--event",
  Academic: "noticeboard__tag--academic",
  Staff: "noticeboard__tag--academic",
};

/**
 * Who a notice is addressed to. `all` is the college — the public board, every
 * student's portal and every teacher's — and it is the default in the database, so
 * every row posted before this existed is one.
 *
 * `teachers` is an instruction to the staff: a meeting, a marks deadline, an
 * invigilation duty. It never reaches a student and never reaches the public board,
 * and the scoping for that is the anon select policy in
 * supabase_notices_upgrade.sql, not the filters below — the filters only decide
 * what a screen asks for.
 */
export const NOTICE_AUDIENCES = [
  {
    id: "all",
    label: "Everyone",
    hint: "Public notice board, every student's portal, and every teacher's portal.",
  },
  {
    id: "teachers",
    label: "Teachers only",
    hint: "Only the teacher portal. Not on the public board and not in any student's portal.",
  },
];

export const audienceLabel = (id) =>
  NOTICE_AUDIENCES.find((a) => a.id === id)?.label || "Everyone";

export const longDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" }) : "";

/**
 * What each reader asks the database for.
 *
 * - `public`  — the landing page and a student's portal: notices to the college.
 * - `teacher` — a teacher's portal: those, plus the ones addressed to the staff.
 * - `admin`   — everything, because she is the one who posted it.
 *
 * A student's request is anonymous and the policy already refuses her the staff
 * rows, so the `public` filter is not what keeps her out of them. It is here so
 * that a screen asks for what it means to show, rather than relying on a refusal
 * it cannot see — RLS drops rows as silently as it drops writes.
 */
const AUDIENCE_FILTER = {
  public: ["all"],
  teacher: ["all", "teachers"],
  admin: null,
};

/**
 * Requests that have gone out and not come back yet, one per reader.
 *
 * The landing page now reads this table twice in the same tick — `NoticeBoard`
 * for the board itself and `TestAlert` for the next test date — and both want
 * exactly the same rows. Sharing the in-flight promise makes that one request
 * instead of two on the slowest connection in the college.
 *
 * The entry is dropped the moment it settles, so this is a dedupe and **not a
 * cache**: nothing is ever served stale, and the admin screen still re-reads the
 * table on every mount the way it always did.
 */
const inFlight = new Map();

export async function fetchNotices(reader = "public") {
  const pending = inFlight.get(reader);
  if (pending) return pending;

  const request = readNotices(reader).finally(() => inFlight.delete(reader));
  inFlight.set(reader, request);
  return request;
}

async function readNotices(reader) {
  const supabase = await client();

  const build = (withAudience) => {
    let query = supabase.from("notices").select("*").order("created_at", { ascending: false });
    const wanted = withAudience ? AUDIENCE_FILTER[reader] : null;
    if (wanted) query = query.in("audience", wanted);
    return query;
  };

  const { data, error } = await build(true);

  // 42703 is "column does not exist": the frontend is deployed and
  // supabase_notices_upgrade.sql has not been pasted into the dashboard yet. The
  // same retry `fetchRoster` makes, for the same reason — a deploy landing before
  // the SQL is normal here, and a notice board that has silently gone empty is a
  // far worse failure than one showing rows that predate the column. Every one of
  // those rows is a college notice; the staff-only kind cannot exist yet.
  if (error?.code === "42703") {
    const retry = await build(false);
    if (!retry.error) return { error: null, notices: retry.data || [] };
  }

  if (error) return { error: error.message, notices: [] };
  return { error: null, notices: data || [] };
}
