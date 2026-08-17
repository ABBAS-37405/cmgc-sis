/**
 * Fetching a screen's code before it is asked for.
 *
 * The portals are lazy — that is what keeps the landing bundle at 419 kB instead
 * of 652 — but "lazy" made the download strictly serial: nothing was fetched until
 * React rendered the screen, and React could not render it until the sign-in and
 * the profile lookup had both come back. Against this Supabase project that is two
 * round trips of roughly 200ms each *before* 293 kB of admin portal even starts
 * downloading, on top of whatever the auth check itself costs.
 *
 * Every one of these is called from a point where the answer is already known —
 * the pointer is on the Portal button, the admin has picked her role, a remembered
 * session says which portal is coming — so the code downloads while the network is
 * busy with something else. Nothing here changes what renders; it only moves the
 * fetch earlier.
 *
 * `import()` is idempotent: the module registry returns the same promise, so
 * calling these twice (hover, then click) costs nothing, and `lazy()` rendering the
 * same specifier afterwards resolves from cache. Failures are swallowed on purpose
 * — this is a head start, and a network that drops it must not produce an unhandled
 * rejection when the real render is about to ask for it again anyway.
 */

const warm = (load) => { load().catch(() => {}); };

export const preloadPortal = () => warm(() => import("../components/Portal/Portal"));
export const preloadAdminPortal = () => warm(() => import("../components/AdminPortal/AdminPortal"));
export const preloadTeacherPortal = () => warm(() => import("../components/TeacherPortal/TeacherPortal"));

/** The two portals that are a separate chunk; a student's screens are in Portal itself. */
export function preloadPortalFor(role) {
  if (role === "admin") preloadAdminPortal();
  else if (role === "teacher") preloadTeacherPortal();
}
