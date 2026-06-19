/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVEKIT_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_GIPHY_KEY?: string
  /** Sentry DSN. When set, the Sentry Loader is injected at startup and error
   *  reports/breadcrumbs forward to it; absent (local/test) → console-only. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
