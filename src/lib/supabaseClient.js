import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "../demo/demoClient";

/**
 * The one Supabase client the whole app shares.
 *
 * `__DEMO__` is a build-time literal from vite.config.js — true only under
 * `--mode demo`. In every other build it folds to `false`, this branch
 * disappears, and Rollup drops `src/demo` entirely, so the real site never ships
 * a byte of the seeded college.
 *
 * Neither half of that is theoretical. Run `npm run build` after touching this:
 * the landing bundle must stay at ~423 kB, and `grep demo-banner` over
 * `dist/assets/index-*.js` must find nothing.
 */
export const supabase = __DEMO__
  ? createDemoClient()
  : createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
