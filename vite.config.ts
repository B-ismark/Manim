import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Token server runs on :3001; proxy /api to it during dev.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Build guard. RoomView is rendered only inside `token && LIVEKIT_URL`; if
  // VITE_LIVEKIT_URL is empty at build time, LIVEKIT_URL folds to a falsy
  // constant, the whole in-call tree becomes dead code, and the bundler tree-shakes
  // it out — producing a bundle that builds fine but can't run a call. That MUST
  // never ship. The VITE_* build vars live in Cloudflare → manim → Settings →
  // Build; a local `.env` is intentionally empty. So: do NOT build/deploy from a
  // dev machine — push to `main` and let Cloudflare build with the real vars.
  if (command === 'build' && !env.VITE_LIVEKIT_URL) {
    throw new Error(
      '\n\n[build aborted] VITE_LIVEKIT_URL is empty.\n' +
        'Building without it strips the entire in-call UI (dead-code elimination) and\n' +
        'ships a broken bundle. These vars only exist in Cloudflare Build settings —\n' +
        'never `wrangler deploy` a local build. Push to `main`; Cloudflare CI builds it.\n',
    )
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Split the heavy, rarely-changing vendor code into long-lived cacheable
          // chunks so app edits don't bust the whole bundle. livekit is the biggest
          // dependency by far; React + Radix are stable too.
          // Vite 8 bundles with Rolldown, which has no object-form `manualChunks`
          // (the Rollup shape this used to be): groups match module paths instead,
          // and pull each match's static dependencies in with it (the default).
          // The react group is broader than the old object form, which resolved
          // 'react-dom' to its index only: react-dom/client and scheduler now land
          // in the cacheable react chunk instead of the entry. React outranks
          // livekit so components-react's own `import 'react'` can't drag React
          // into the livekit chunk.
          // HAZARD: a dependency a livekit package shares with the landing page
          // (e.g. @floating-ui, via a components-core split back out of
          // components-react) would be pulled INTO the livekit chunk and make the
          // entry import it eagerly. Nothing fails when that happens, so the
          // lighthouse job asserts the entry never imports a livekit chunk.
          // NOTE: @livekit/track-processors is intentionally NOT matched — it (and
          // its ~160KB MediaPipe payload) is dynamically imported only when blur is
          // first enabled (see useBackgroundBlur). Capturing it here would force it
          // into the eagerly-loaded room chunk and defeat that lazy boundary. The
          // livekit pattern names its two packages exactly for that reason, so a
          // broader `@livekit/` match must never replace it.
          codeSplitting: {
            groups: [
              {
                name: 'react',
                test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
                priority: 20,
              },
              {
                name: 'livekit',
                test: /[\\/]node_modules[\\/](livekit-client|@livekit[\\/]components-react)[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      port: 5173,
      // Cross-origin isolation so SharedArrayBuffer exists in dev too — the Krisp
      // AI noise filter needs it (prod sets the same headers in worker/index.js).
      // `credentialless` keeps cross-origin assets (Giphy, MediaPipe wasm) working.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
