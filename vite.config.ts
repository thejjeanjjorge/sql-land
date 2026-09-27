import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // PGlite loads its .wasm and .data files relative to its own module. Pre-bundling
  // moves it into .vite/deps, where those files are missing, and discovering it the
  // first time the worker starts makes Vite reload the page mid-exercise.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
})
