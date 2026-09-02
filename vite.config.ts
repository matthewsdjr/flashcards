import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `base` se controla por variable de entorno para poder servir la app desde
// la raiz o desde un subdirectorio sin tocar el codigo.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    // En desarrollo el cliente corre en 5173 y la API en 3000.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
})
