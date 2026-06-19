import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Unit tests for pure logic (mention encode/decode, markdown render, slugify,
// focus selection). These run in Node with no browser/LiveKit — fast and
// deterministic, complementing the Playwright E2E suite in tests/ (which owns
// everything that needs a real room). Kept separate: Playwright globs *.spec.ts
// under tests/, Vitest globs *.test.ts(x) under src/, so neither picks up the
// other's files.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
