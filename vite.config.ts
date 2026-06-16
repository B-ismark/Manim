import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Token server runs on :3001; proxy /api to it during dev.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Build guard. RoomView is rendered only inside `token && LIVEKIT_URL`; if
  // VITE_LIVEKIT_URL is empty at build time, LIVEKIT_URL folds to a falsy
  // constant, the whole in-call tree becomes dead code, and Rollup tree-shakes
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
      rollupOptions: {
        output: {
          // Split the heavy, rarely-changing vendor code into long-lived cacheable
          // chunks so app edits don't bust the whole bundle. livekit is the biggest
          // dependency by far; React + Radix are stable too.
          manualChunks: {
            livekit: ['livekit-client', '@livekit/components-react', '@livekit/track-processors'],
            react: ['react', 'react-dom', 'react-router-dom'],
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
