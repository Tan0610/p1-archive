import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(root, 'web'),
  plugins: [react()],
  server: {
    port: 5173,
    // the browser only ever talks to our local Node API; it never sees the feed key
    proxy: { '/api': 'http://127.0.0.1:4173' },
    fs: { allow: [root] },
  },
  build: {
    outDir: path.join(root, 'web', 'dist'),
    emptyOutDir: true,
  },
})
