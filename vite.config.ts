import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs let the same build run at the site root or under a
  // sub-path such as GitHub Pages' /sql-land/.
  base: './',
  // Progress lives in localStorage, which is tied to the exact address. A fixed
  // port keeps it from appearing lost when Vite would otherwise pick another one.
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  // PGlite loads its .wasm and .data files relative to its own module. Pre-bundling
  // moves it into .vite/deps, where those files are missing, and discovering it the
  // first time the worker starts makes Vite reload the page mid-exercise.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
})
