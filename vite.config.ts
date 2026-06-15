import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Token server runs on :3001; proxy /api to it during dev.
export default defineConfig({
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
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
