import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    // livekit-client is by far the biggest dependency and is only needed once
    // someone actually joins a call — keeping it out of the entry chunk means the
    // landing page paints without waiting on it.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('/node_modules/')) {
            if (id.includes('livekit-client') || id.includes('@livekit')) return 'livekit'
            if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react'
            return 'vendor'
          }
        },
      },
    },
  },
})
