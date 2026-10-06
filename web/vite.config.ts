import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port: the API only accepts writes from allowed origins (CSRF
    // protection), so the dev server must not silently move to another port.
    port: 5173,
    strictPort: true,
    // The API runs separately (npm run dev in server/); proxying keeps the
    // session cookie same-origin in development.
    proxy: { '/api': 'http://localhost:3001' },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
})
