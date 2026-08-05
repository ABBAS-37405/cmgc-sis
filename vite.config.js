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
  }
})
