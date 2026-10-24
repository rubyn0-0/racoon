import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The backend allows this origin (FRONTEND_ORIGINS in api.py), so keep the two in step.
const DEV_PORT = 5173

// https://vite.dev/config/
export default defineConfig({
  // '/' locally; the Pages build sets VITE_BASE=/racoon/ (the repo name) so assets resolve under that path.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: DEV_PORT },
})
