import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_API_URL is read at build/dev time via import.meta.env in src/api.ts.
// It is NOT hardcoded here; see src/api.ts (API_BASE).
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
