/*
  The Content-Security-Policy, in one place. Two routes serve pages: the Worker
  (worker/index.js — `/`, `/r/*`, `/api/*`, see run_worker_first in wrangler.toml)
  and Cloudflare's asset server for everything else, which reads public/_headers.
  headers.test.mjs keeps _headers' copy identical to this one.

  Defense-in-depth. The app has no known injection sink (chat renders React
  nodes, not HTML; remote images are click-to-load), so CSP is a safety net.
  connect/img/style are kept permissive enough not to break LiveKit (wss),
  Supabase (https+wss), Giphy, or Tailwind's injected styles; the strict bits
  (frame-ancestors, object-src, base-uri) block clickjacking + base-tag/object
  injection. script-src allows the MediaPipe CDN + wasm (blur), and Sentry's
  loader (js.sentry-cdn.com) plus the SDK bundle it pulls in
  (browser.sentry-cdn.com) for crash reports when VITE_SENTRY_DSN is set; the
  reports themselves go to *.ingest.sentry.io, already inside connect-src.
  NOTE: verify against the DEPLOYED artifact — tune if a console CSP violation
  appears (neither path runs under the local vite dev server).
*/
export const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@mediapipe/ https://js.sentry-cdn.com https://browser.sentry-cdn.com",
  "worker-src 'self' blob:",
  "connect-src 'self' https: wss:",
].join('; ')
