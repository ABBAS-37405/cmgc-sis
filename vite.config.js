import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo'

  return {
    plugins: [
      react(),

      // `define` below is not applied by this version of Vite on the dev server,
      // so `__DEMO__` reached the browser as an undefined global and
      // `npm run dev:demo` threw before it painted. This puts the same value on
      // `window` for dev only; the build never needs it, because `define` has
      // already replaced every occurrence by then.
      {
        name: 'cmgc-demo-flag',
        apply: 'serve',
        transformIndexHtml: () => [
          { tag: 'script', children: `window.__DEMO__ = ${demo};`, injectTo: 'head-prepend' },
        ],
      },
    ],

    // The demo build: `npm run build:demo` passes --mode demo, and this is what
    // swaps the Supabase client for the in-memory one in src/demo.
    //
    // A `define` rather than an env var, and the difference is measured, not
    // stylistic: a `define` becomes a literal `true`/`false`, so a production
    // build folds the branch and Rollup drops the whole demo folder. An
    // `import.meta.env` comparison survives as a runtime property lookup even
    // with the variable set, and left 4.4 kB of the demo in the real bundle.
    define: {
      __DEMO__: JSON.stringify(demo),
    },

    /*
     * Two chunks pulled out by hand, both measured rather than guessed at.
     *
     * `supabase` — everything `createClient` drags in: auth-js (93 kB), realtime
     * (29 kB), phoenix (25 kB), storage (26 kB), postgrest (15 kB). **201 kB
     * raw, ~51 kB gzipped.** It used to sit in the landing chunk, so a
     * first-time visitor downloaded and parsed all of it before the hero could
     * paint — to run one REST select for the notice board. It is reached from
     * the landing page only through an `import()` in notices.js, but every lazy
     * portal imports it statically too, so without this the bundler hoists it
     * back into the common parent and says so: INEFFECTIVE_DYNAMIC_IMPORT.
     *
     * **`src/lib/supabaseClient.js` is deliberately NOT in this group.** Putting
     * our own module in it makes the bundler add a bare `import "./supabase…"`
     * to the entry — a side-effect edge that preloads the whole 201 kB again and
     * undoes the split silently. Left out, the client is its own 0.6 kB chunk
     * that pulls the big one in when it is actually loaded. So: after touching
     * any of this, check `dist/index.html` — the supabase chunk must **not**
     * appear in a `modulepreload`. That single line is the whole test.
     *
     * `react` — react + react-dom, 182 kB that changes only when the dependency
     * does. Split out so a deploy of the college's own code does not invalidate
     * it in everybody's browser cache; a phone that has been on the site before
     * then re-downloads ~50 kB instead of ~240.
     *
     * Nothing else is worth naming: the portals, the admission form, the PDF
     * engine and the zip library are already split by `import()`, which is the
     * better tool because it says *when* the code is needed rather than only
     * where it lives.
     */
    build: {
      rollupOptions: {
        output: {
          advancedChunks: {
            groups: [
              {
                name: "supabase",
                test: /node_modules[\\/]@supabase[\\/]/,
              },
              {
                name: "react",
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              },
              /*
               * `academics.js` is shared between the public Programs section and
               * every marks screen in the portals, and left to itself the bundler
               * folded those 2 kB **into the supabase group** — which put a
               * static edge from the landing chunk to 209 kB it is not supposed
               * to need, and the whole split above would have bought nothing.
               * Naming it keeps it where the landing page can reach it on its
               * own. Check `dist/index.html` after touching any of this: the
               * supabase chunk must not be in a `modulepreload`.
               */
              {
                name: "academics",
                test: /src[\\/]lib[\\/]academics\.js$/,
                priority: 10,
              },
              /*
               * Vite's own `__vitePreload` helper. Every chunk that lazy-loads
               * anything calls it, so it is shared — and being a few lines long
               * it was absorbed into the supabase group as well, which put the
               * static edge back all by itself.
               */
              {
                name: "preload-helper",
                test: /preload-helper/,
                priority: 20,
              },
            ],
          },
        },
      },
    },

    // Dev server only — this has no effect on `npm run build`.
    //
    // These three are reached ONLY through `import()` inside a handler
    // (`loadPdfLib()` in reportPdf.js/payslipPdf.js, `buildReportsZip()`), which
    // is deliberate: they are ~500 kB together and must not sit in the portal
    // chunks. But Vite's startup scanner only follows static imports, so it does
    // not pre-bundle them — it discovers them the first time someone clicks
    // "Download", re-runs the optimizer, and the page that is already open then
    // fails that very import with "Failed to fetch dynamically imported module:
    // .../deps/jspdf.js?v=<old hash>", because the hash it asked for has just
    // been replaced.
    //
    // Naming them here pre-bundles them at server start, so the first click
    // works instead of costing a reload.
    optimizeDeps: {
      include: ['jspdf', 'jspdf-autotable', 'jszip'],
    },
  }
})
