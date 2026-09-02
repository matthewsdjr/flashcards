import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` se controla por variable de entorno para poder servir la misma app
// desde GitHub Pages (/<repo>/) y desde un servidor propio en la raíz (/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
